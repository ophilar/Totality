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
      '-fps_mode', 'cfr',
      ...(options.targetCodec === 'av1' ? ['-svtav1-params', 'tune=0'] : []),
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

}
