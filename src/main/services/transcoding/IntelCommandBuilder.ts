import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { buildHdrMetadataArgs } from './HdrTranscodingPolicy'

export class IntelCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    const hdrArgs = buildHdrMetadataArgs(_analysis)
    const codec = options.targetCodec === 'av1' ? 'av1_qsv' : 'hevc_qsv'
    const quality = (options.crf ?? 20).toString()

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

    args.push(...hdrArgs)

    args.push(output)
    return args
  }

  buildHandbrakeArgs(_input: string, _output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
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
