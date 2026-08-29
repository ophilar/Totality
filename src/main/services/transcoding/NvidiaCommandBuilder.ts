import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'
import { APP_CONFIG } from '@main/config'

export class NvidiaCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const hdrArgs = buildHdrMetadataArgs(analysis)
    const args: string[] = [
      '-y',
      '-hwaccel', 'cuda',
      '-hwaccel_output_format', 'cuda',
      '-extra_hw_frames', '8',
      '-i', input,
      '-fps_mode', 'passthrough'
    ]
    const codec = options.targetCodec === 'av1' ? 'av1_nvenc' : 'hevc_nvenc'
    const cq = (options.crf ?? APP_CONFIG.transcoding.defaultCrf).toString()
    const preset = options.preset || APP_CONFIG.transcoding.defaultPreset

    args.push(
      '-c:v', codec,
      '-preset', preset,
      '-rc', 'vbr',
      '-cq', cq,
      '-b:v', '0',
      '-b_ref_mode', 'middle',
      '-temporal-aq', '1',
      '-rc-lookahead', '32'
    )

    const is10BitSource = Boolean(
      analysis?.video?.pixelFormat?.includes('10') ||
      analysis?.video?.bitDepth === 10
    )

    if (is10BitSource || options.targetCodec === 'av1') {
      args.push('-vf', 'scale_cuda=format=p010le')
    }

    appendStreamMappingArgs(args, analysis, options)

    args.push(...hdrArgs)

    args.push(output)
    return args
  }

}
