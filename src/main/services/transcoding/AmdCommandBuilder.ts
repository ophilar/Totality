import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'
import { applyTargetTranscodePlan } from './TargetTranscodePlan'
import { APP_CONFIG } from '@main/config'

export class AmdCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const codec = options.targetCodec === 'av1' ? 'av1_amf' : 'hevc_amf'
    const quality = String(options.crf ?? APP_CONFIG.transcoding.defaultCrf)
    const args = [
      '-y', '-i', input, '-fps_mode', 'passthrough',
      '-c:v', codec, '-rc', 'cqp', '-qp_i', quality, '-qp_p', quality,
      '-quality', options.preset || APP_CONFIG.transcoding.defaultAmdPreset
    ]

    appendStreamMappingArgs(args, analysis, options)
    args.push(...buildHdrMetadataArgs(analysis, options))
    if (!options.targetConversion && output.toLowerCase().endsWith('.mp4')) args.push('-movflags', '+faststart')
    args.push(output)
    applyTargetTranscodePlan(args, options)
    return args
  }
}
