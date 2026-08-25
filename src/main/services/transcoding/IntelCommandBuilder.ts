import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'
import { APP_CONFIG } from '@main/config'


export class IntelCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const hdrArgs = buildHdrMetadataArgs(_analysis)
    const codec = options.targetCodec === 'av1' ? 'av1_qsv' : 'hevc_qsv'
    const quality = (options.crf ?? APP_CONFIG.transcoding.defaultIntelQuality).toString()

    const sourceBitrate = _analysis?.video?.bitrate || _analysis?.overallBitrate || (_analysis?.duration && _analysis?.fileSize ? Math.round((_analysis.fileSize * 8) / _analysis.duration) : undefined)

    const args: string[] = [
      '-y',
      '-init_hw_device', 'qsv=qsv',
      '-filter_hw_device', 'qsv',
      '-hwaccel', 'qsv',
      '-hwaccel_output_format', 'qsv',
      '-i', input,
      '-fps_mode', 'cfr',
      '-vf', 'vpp_qsv=format=p010le',
      '-c:v', codec,
      '-preset', options.preset || APP_CONFIG.transcoding.defaultIntelPreset,
      '-global_quality', quality,
      ...(sourceBitrate ? ['-maxrate', `${sourceBitrate}`, '-bufsize', `${sourceBitrate * 2}`] : []),
      '-look_ahead', '1'
    ]

    appendStreamMappingArgs(args, _analysis, options)
    args.push(...hdrArgs)
    args.push(output)
    return args
  }

}
