
import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'
import { applyTargetTranscodePlan } from './TargetTranscodePlan'
import { APP_CONFIG } from '@main/config'

export class IntelCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const hdrArgs = buildHdrMetadataArgs(analysis, options)
    const codec = options.targetCodec === 'av1' ? 'av1_qsv' : 'hevc_qsv'
    const quality = (options.crf ?? APP_CONFIG.transcoding.defaultIntelQuality).toString()

    const args: string[] = [
      '-y',
      '-init_hw_device', 'qsv=qsv',
      '-filter_hw_device', 'qsv',
      '-hwaccel', 'qsv',
      '-hwaccel_output_format', 'qsv',
      '-i', input,
      '-fps_mode', 'passthrough',
      '-vf', 'vpp_qsv=format=p010le',
      '-c:v', codec,
      '-preset', options.preset || APP_CONFIG.transcoding.defaultIntelPreset,
      '-global_quality', quality,
      '-look_ahead', '1'
    ]

    appendStreamMappingArgs(args, analysis, options)
    args.push(...hdrArgs)
    if (!options.targetConversion && output.toLowerCase().endsWith('.mp4')) {
      args.push('-movflags', '+faststart')
    }
    args.push(output)
    applyTargetTranscodePlan(args, options)
    return args
  }
}
