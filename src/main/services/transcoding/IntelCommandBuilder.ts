import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'

export class IntelCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const codec = options.targetCodec === 'av1' ? 'av1_qsv' : 'hevc_qsv'
    const quality = (options.crf ?? 20).toString()

    const args: string[] = [
      '-y',
      '-fps_mode', 'passthrough',
      '-init_hw_device', 'qsv=qsv',
      '-filter_hw_device', 'qsv',
      '-hwaccel', 'qsv',
      '-hwaccel_output_format', 'qsv',
      '-i', input,
      '-vf', 'vpp_qsv=format=p010le',
      '-c:v', codec,
      '-preset', options.preset || 'slow',
      '-global_quality', quality,
      '-look_ahead', '1'
    ]

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

  buildHandbrakeArgs(input: string, output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const encoder = options.targetCodec === 'av1' ? 'qsv_av1' : 'qsv_h265_10bit'
    const args: string[] = [
      '--encoder', encoder,
      '--quality', (options.crf ?? 20).toString()
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
