import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import type { TranscodeOptions } from '../TranscodingService'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import { buildStreamSelectionPlan } from './StreamSelectionPlan'
import { APP_CONFIG } from '@main/config'

export interface TargetTranscodePlan {
  container: 'mkv' | 'mp4'
  width: number
  height: number
  bitDepth: number
  profile: string
  level: number
  hdrFormat: string
  videoFilter: string
  inputArgs: string[]
  maximumVideoBitrate: number
  audio: Array<{ sourceIndex: number; codec: string; bitrateKbps?: number }>
  changes: string[]
}

export function buildTargetTranscodePlan(analysis: FileAnalysisResult, profile: PlaybackTargetProfile, options: TranscodeOptions): TargetTranscodePlan {
  const video = analysis.video!
  const definition = profile.definition
  const streams = buildStreamSelectionPlan(analysis, options)
  if (!definition.video.codecs.includes(options.targetCodec!)) throw new Error(`Select a video codec supported by ${profile.name}`)
  const container = options.targetContainer
  if (!container || !definition.containers.includes(container === 'mkv' ? 'matroska' : 'mp4')) throw new Error('Select a supported output container')
  const scale = Math.min(1, definition.video.maxWidth / video.width, definition.video.maxHeight / video.height)
  const width = Math.floor(video.width * scale / 2) * 2, height = Math.floor(video.height * scale / 2) * 2
  const bitDepth = definition.video.bitDepths.includes(video.bitDepth!) ? video.bitDepth! : definition.video.bitDepths.includes(10) ? 10 : 8
  const outputProfile = options.targetCodec === 'hevc' ? (bitDepth === 10 ? 'Main 10' : 'Main') : 'Main'
  if (!definition.video.profiles.includes(outputProfile)) throw new Error(`The target does not support ${outputProfile}`)
  const level = Math.max(...definition.video.levels)
  const sourceHdr = video.hdrFormat || 'SDR'
  const hdrFormat = sourceHdr === 'SDR' ? 'SDR' : options.targetHdrFormat ?? (definition.hdr.formats.includes(sourceHdr) ? sourceHdr : undefined)
  if (!hdrFormat || (hdrFormat !== 'SDR' && !definition.hdr.formats.includes(hdrFormat))) throw new Error('Select a supported output color format')
  const changes: string[] = []
  if (scale < 1) changes.push(`Resize ${video.width}×${video.height} to ${width}×${height}`)
  if (hdrFormat !== sourceHdr) changes.push(`Convert ${sourceHdr} to ${hdrFormat}${sourceHdr === 'Dolby Vision' || sourceHdr === 'HDR10+' ? '; dynamic HDR metadata will not be retained' : ''}`)
  const audio = analysis.audioTracks.filter(track => streams.audioStreamIndexes.includes(track.index)).map(track => {
    if (track.channels > definition.audio.maxChannels || (track.hasObjectAudio && !definition.audio.objectAudio)) throw new Error(`Audio stream ${track.index} is incompatible; channel count and object audio must be preserved`)
    if (definition.audio.codecs.includes(track.codec)) return { sourceIndex: track.index, codec: track.codec }
    if (track.hasObjectAudio || track.isCommentary || track.isAudioDescription || track.isAccessibility) throw new Error(`Protected audio stream ${track.index} requires codec preservation`)
    const codec = options.targetAudioCodec
    if (!codec || !definition.audio.codecs.includes(codec) || !['aac', 'ac3', 'eac3'].includes(codec)) throw new Error(`Select a supported audio codec for stream ${track.index}`)
    const bitrateKbps = track.channels >= 6 ? APP_CONFIG.transcoding.audioSurroundTargetBitrateKbps : APP_CONFIG.transcoding.audioStereoTargetBitrateKbps
    changes.push(`Convert audio stream ${track.index} from ${track.codec} to ${codec}, preserving ${track.channels} channels`)
    return { sourceIndex: track.index, codec, bitrateKbps }
  })
  for (const track of analysis.subtitleTracks.filter(track => streams.subtitleStreamIndexes.includes(track.index))) {
    const codec = track.codec === 'subrip' ? 'srt' : track.codec
    if (!definition.subtitles.embedded || !definition.subtitles.formats.includes(codec) || (container === 'mp4' && codec !== 'mov_text')) throw new Error(`Subtitle stream ${track.index} cannot be preserved in the selected target`)
  }
  const retainedBitrate = audio.reduce((sum, item) => sum + (item.bitrateKbps ?? analysis.audioTracks.find(track => track.index === item.sourceIndex)?.bitrate ?? 0) * 1000, 0)
  const outputCeiling = options.maxOutputBytes ?? analysis.fileSize!
  const maximumVideoBitrate = Math.floor(Math.min(definition.network.sustainableBitrate, outputCeiling * 8 / (analysis.duration! / 1000)) - retainedBitrate)
  if (maximumVideoBitrate <= 0) throw new Error('Retained audio exhausts the configured target bitrate')
  const convertHdr = sourceHdr !== 'SDR' && hdrFormat !== sourceHdr
  if ((sourceHdr === 'Dolby Vision' || sourceHdr === 'HDR10+') && !convertHdr) throw new Error('Dynamic HDR transcoding requires an explicitly selected HDR10 or SDR conversion')
  const pixelFormat = bitDepth === 10 ? 'yuv420p10le' : 'yuv420p'
  const videoFilter = convertHdr
    ? `format=yuv420p10le,hwupload,libplacebo=w=${width}:h=${height}:colorspace=${hdrFormat === 'SDR' ? 'bt709' : 'bt2020nc'}:color_primaries=${hdrFormat === 'SDR' ? 'bt709' : 'bt2020'}:color_trc=${hdrFormat === 'SDR' ? 'bt709' : 'smpte2084'}:apply_dolbyvision=true:tonemapping=bt.2390:format=${pixelFormat},hwdownload,format=${pixelFormat}`
    : `scale=${width}:${height},format=${pixelFormat}`
  return { container, width, height, bitDepth, profile: outputProfile, level, hdrFormat, videoFilter, inputArgs: convertHdr ? ['-init_hw_device', 'vulkan=target', '-filter_hw_device', 'target'] : [], maximumVideoBitrate, audio, changes }
}

export function applyTargetTranscodePlan(args: string[], options: TranscodeOptions): void {
  const plan = options.targetConversion
  if (!plan) return
  // Target conversion uses software decoding before explicit filter/encoder transfers.
  for (const flag of ['-hwaccel', '-hwaccel_output_format', '-extra_hw_frames', '-init_hw_device', '-filter_hw_device', '-vf', '-maxrate', '-bufsize', '-pix_fmt']) {
    let index: number
    while ((index = args.indexOf(flag)) >= 0) args.splice(index, 2)
  }
  args.unshift(...plan.inputArgs)
  args.splice(args.length - 1, 0, '-vf', plan.videoFilter, '-pix_fmt', plan.bitDepth === 10 ? 'yuv420p10le' : 'yuv420p', '-maxrate', String(plan.maximumVideoBitrate), '-bufsize', String(plan.maximumVideoBitrate * 2))
  if (options.targetCodec === 'hevc') args.splice(args.length - 1, 0, '-profile:v', plan.profile === 'Main 10' ? 'main10' : 'main')
  const encoderLevel = options.targetCodec === 'av1' && options.encoder?.startsWith('nvenc') ? (Math.floor(plan.level / 10) - 2) * 4 + plan.level % 10 : options.encoder?.startsWith('qsv') || options.encoder === 'svt_av1' ? plan.level : plan.level / 10
  args.splice(args.length - 1, 0, '-level:v', String(encoderLevel))
  for (const [index, track] of plan.audio.entries()) {
    if (track.bitrateKbps !== undefined) args.splice(args.length - 1, 0, `-c:a:${index}`, track.codec, `-b:a:${index}`, `${track.bitrateKbps}k`)
  }
  if (plan.container === 'mp4') args.splice(args.length - 1, 0, '-movflags', '+faststart')
}
