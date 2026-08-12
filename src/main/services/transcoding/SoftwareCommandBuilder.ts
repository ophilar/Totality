import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'

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

    appendStreamMappingArgs(args, _analysis, options)

    args.push(...hdrArgs)

    args.push(output)
    return args
  }

}
