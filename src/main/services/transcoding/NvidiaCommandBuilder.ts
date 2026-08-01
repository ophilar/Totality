import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'

export class NvidiaCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const args: string[] = [
      '-y',
      '-fps_mode', 'passthrough',
      '-hwaccel', 'cuda',
      '-hwaccel_output_format', 'cuda',
      '-i', input
    ]
    const codec = options.targetCodec === 'av1' ? 'av1_nvenc' : 'hevc_nvenc'
    const cq = (options.crf ?? 20).toString()
    const preset = options.preset || 'p6'

    args.push(
      '-c:v', codec,
      '-preset', preset,
      '-rc', 'vbr',
      '-cq', cq,
      '-b:v', '0',
      '-spatial-aq', '1',
      '-temporal-aq', '1',
      '-b_ref_mode', 'middle'
    )

    const is10BitSource = Boolean(
      analysis?.video?.pixelFormat?.includes('10') ||
      (analysis?.video as any)?.pix_fmt?.includes('10') ||
      analysis?.video?.bitDepth === 10
    )

    if (is10BitSource || options.targetCodec === 'av1') {
      args.push('-vf', 'scale_cuda=format=p010le')
    }

    if (options.preserveAllAudio) {
      args.push('-c:a', 'copy')
    } else {
      args.push('-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'copy')
    }

    if (options.preserveSubtitles) {
      args.push('-map', '0:s?', '-c:s', 'copy')
    }

    args.push(output)
    return args
  }

  buildHandbrakeArgs(_input: string, _output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const encoder = options.targetCodec === 'av1' ? 'nvenc_av1_10bit' : 'nvenc_h265_10bit'
    const args: string[] = [
      '--encoder', encoder,
      '--quality', (options.crf ?? 20).toString(),
      '--encoder-preset', 'quality',
      '--encopts', 'spatial-aq=1:temporal-aq=1:b-ref-mode=middle'
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
