import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'

export class SoftwareCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const hdrArgs = buildHdrMetadataArgs(_analysis)
    const codec = options.targetCodec === 'av1' ? 'libsvtav1' : 'libx265'
    const crf = (options.crf ?? 22).toString()

    const args: string[] = [
      '-y',
      '-i', input,
      '-fps_mode', 'passthrough',
      '-c:v', codec,
      '-crf', crf,
      '-preset', options.preset || 'medium',
      '-pix_fmt', 'yuv420p10le'
    ]

    if (options.preserveAllAudio) {
      args.push('-c:a', 'copy')
    } else {
      args.push('-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'copy')
    }

    if (options.preserveSubtitles) {
      args.push('-map', '0:s?', '-c:s', 'copy')
    }

    args.push(...hdrArgs)

    args.push(output)
    return args
  }

  buildHandbrakeArgs(_input: string, _output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const encoder = options.targetCodec === 'av1' ? 'svt_av1_10bit' : 'x265_10bit'
    const args: string[] = [
      '--encoder', encoder,
      '--quality', (options.crf ?? 22).toString(),
      '--encoder-preset', options.preset || 'medium'
    ]

    if (options.preserveAllAudio) {
      args.push('--all-audio')
    } else {
      args.push('--audio', '1')
    }

    if (options.preserveSubtitles) {
      args.push('--all-subtitles')
    }

    return args
  }
}
