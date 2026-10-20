import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'
import { applyTargetTranscodePlan } from './TargetTranscodePlan'
import { APP_CONFIG } from '@main/config'

export class AppleCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    if (options.targetCodec !== 'hevc') throw new Error('Apple VideoToolbox hardware encoding supports HEVC in this workflow.')
    const quality = String(100 - (options.crf ?? APP_CONFIG.transcoding.defaultCrf))
    const args = [
      '-y', '-i', input, '-fps_mode', 'passthrough',
      '-c:v', 'hevc_videotoolbox', '-allow_sw', '0', '-q:v', quality
    ]

    appendStreamMappingArgs(args, analysis, options)
    args.push(...buildHdrMetadataArgs(analysis, options))
    if (!options.targetConversion && output.toLowerCase().endsWith('.mp4')) args.push('-movflags', '+faststart')
    args.push(output)
    applyTargetTranscodePlan(args, options)
    return args
  }
}
