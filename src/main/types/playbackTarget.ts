import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import { normalizeVideoCodec, normalizeAudioCodec } from '@main/services/MediaNormalizer'

export type PlaybackSource = 'provided-baseline' | 'user-declared' | 'local-analysis' | 'plex-decision'
export type PlaybackFindingStatus = 'compatible' | 'incompatible' | 'not-applicable'

export interface PlaybackTargetProfile {
  id: string
  name: string
  definition: PlaybackTargetDefinition
  createdAt: string
  updatedAt: string
}

export interface PlaybackTargetDefinition {
  containers: string[]
  video: { codecs: string[]; profiles: string[]; levels: number[]; maxWidth: number; maxHeight: number; maxFrameRate: number; bitDepths: number[]; containerRules?: Array<{ containers: string[]; codecs?: string[]; profiles?: string[]; hdrFormats?: string[] }> }
  hdr: { formats: string[]; fallbackRequired: boolean }
  audio: { codecs: string[]; maxChannels: number; objectAudio: boolean; outputPath: 'device' | 'passthrough' | 'receiver' }
  subtitles: { formats: string[]; embedded: boolean; external: boolean; burnIn: boolean }
  network: { sustainableBitrate: number }
  client?: { product: string; platform: string; version: string }
}

export interface PlaybackFinding { status: PlaybackFindingStatus; rule: string; evidence: string; source: PlaybackSource }
export interface PlaybackTargetEvaluation { profileId: string; overall: 'compatible' | 'incompatible'; findings: Record<'container' | 'video' | 'hdr' | 'audio' | 'subtitle' | 'network', PlaybackFinding> }

export function getPlaybackTargetContainers(
  profile: PlaybackTargetProfile,
  video: { codec?: string; profile?: string; hdrFormat?: string }
): string[] {
  const matches = (value: string | undefined, expected: string[] | undefined): boolean =>
    !expected || expected.some(candidate => value?.toLowerCase().includes(candidate.toLowerCase()))
  const rule = profile.definition.video.containerRules?.find(candidate =>
    matches(video.codec, candidate.codecs) && matches(video.profile, candidate.profiles) && matches(video.hdrFormat, candidate.hdrFormats)
  )
  return rule?.containers ?? profile.definition.containers
}

export function recommendPlaybackTargetContainer(
  profile: PlaybackTargetProfile,
  video: { codec?: string; profile?: string; hdrFormat?: string },
  sourceContainer?: string
): 'mkv' | 'mp4' | '' {
  const allowed = getPlaybackTargetContainers(profile, video).map(container => container.toLowerCase())
  const source = sourceContainer?.split(',')[0].trim().toLowerCase()
  const normalizedSource = source === 'mkv' || source === 'matroska' ? 'matroska' : source === 'm4v' ? 'mp4' : source
  if (normalizedSource && allowed.includes(normalizedSource)) return normalizedSource === 'matroska' ? 'mkv' : normalizedSource === 'mp4' ? 'mp4' : ''
  if (allowed.includes('matroska')) return 'mkv'
  if (allowed.includes('mp4')) return 'mp4'
  return ''
}

export function evaluatePlaybackTarget(profile: PlaybackTargetProfile, analysis: FileAnalysisResult): PlaybackTargetEvaluation {
  if (!analysis.success) throw new Error(analysis.error || 'Media analysis failed')
  const video = analysis.video
  if (!video || !analysis.container || analysis.overallBitrateKbps == null) throw new Error('Complete media analysis is required')
  const finding = (ok: boolean, rule: string, evidence: string): PlaybackFinding => ({ status: ok ? 'compatible' : 'incompatible', rule, evidence, source: 'local-analysis' })
  const d = profile.definition
  const allowedContainers = getPlaybackTargetContainers(profile, video)
  const findings = {
    container: finding(analysis.container.split(',').some(container => allowedContainers.includes(container)), `container in [${allowedContainers.join(', ')}]`, analysis.container),
    video: finding(d.video.codecs.some(codec => normalizeVideoCodec(codec) === normalizeVideoCodec(video.codec)) && d.video.profiles.includes(video.profile || '') && video.level !== undefined && video.level <= Math.max(...d.video.levels) && (video.width || 0) <= d.video.maxWidth && (video.height || 0) <= d.video.maxHeight && d.video.bitDepths.includes(video.bitDepth || 0), 'video codec/profile/level/resolution/bit-depth supported', JSON.stringify(video)),
    hdr: finding(!video.hdrFormat || video.hdrFormat === 'SDR' || d.hdr.formats.includes(video.hdrFormat), 'HDR output format supported', video.hdrFormat || 'SDR'),
    audio: finding(analysis.audioTracks.every(t => d.audio.codecs.some(codec => normalizeAudioCodec(codec) === normalizeAudioCodec(t.codec)) && t.channels <= d.audio.maxChannels && (!t.hasObjectAudio || d.audio.objectAudio)), 'all audio tracks supported by codec/channel/object-audio policy', JSON.stringify(analysis.audioTracks)),
    subtitle: finding(analysis.subtitleTracks.every(track => d.subtitles.embedded && d.subtitles.formats.includes(track.codec === 'subrip' ? 'srt' : track.codec) && (!analysis.container!.split(',').includes('mp4') && !analysis.container!.split(',').includes('mov') || track.codec === 'mov_text')), 'subtitle delivery explicitly supported', JSON.stringify(analysis.subtitleTracks)),
    network: finding(analysis.overallBitrateKbps * 1000 <= d.network.sustainableBitrate, `bitrate <= ${d.network.sustainableBitrate}`, String(analysis.overallBitrateKbps * 1000)),
  }
  return { profileId: profile.id, overall: Object.values(findings).every(f => f.status !== 'incompatible') ? 'compatible' : 'incompatible', findings }
}
