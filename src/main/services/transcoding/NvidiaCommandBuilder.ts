import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'
import { appendStreamMappingArgs } from './StreamSelectionPlan'

export class NvidiaCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const hdrArgs = buildHdrMetadataArgs(analysis)
    const args: string[] = [
      '-y',
      '-hwaccel', 'cuda',
      '-hwaccel_output_format', 'cuda',
      '-extra_hw_frames', '8',
      '-i', input,
      '-fps_mode', 'cfr'
    ]
    const codec = options.targetCodec === 'av1' ? 'av1_nvenc' : 'hevc_nvenc'
    const cq = (options.crf ?? 20).toString()
    const preset = options.preset || 'p6'

    const sourceBitrate = analysis.video?.bitrate || analysis.overallBitrate || (analysis.duration && analysis.fileSize ? Math.round((analysis.fileSize * 8) / analysis.duration) : undefined)

    args.push(
      '-c:v', codec,
      '-preset', preset,
      '-rc', 'vbr',
      '-cq', cq,
      ...(options.targetCodec === 'av1'
        ? ['-maxrate', sourceBitrate ? `${Math.min(60000000, Math.round(sourceBitrate * 0.9))}` : '60M', '-bufsize', sourceBitrate ? `${Math.min(120000000, Math.round(sourceBitrate * 1.8))}` : '120M', '-level', '5.2', '-tier', '0', '-bf', '0', '-b_ref_mode', 'disabled', '-rc-lookahead', '0']
        : (sourceBitrate ? ['-b:v', '0', '-maxrate', `${Math.round(sourceBitrate * 0.9)}`, '-bufsize', `${Math.round(sourceBitrate * 1.8)}`, '-b_ref_mode', 'middle'] : ['-b:v', '0', '-b_ref_mode', 'middle'])),
      '-spatial-aq', '1',
      '-temporal-aq', '1'
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
