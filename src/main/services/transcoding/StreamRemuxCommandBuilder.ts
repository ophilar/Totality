import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { appendStreamMappingArgs } from './StreamSelectionPlan'

export class StreamRemuxCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const args: string[] = ['-y', '-i', input, '-c:v', 'copy']
    const plan = appendStreamMappingArgs(args, analysis, options)
    for (const [outputIndex, sourceIndex] of plan.audioStreamIndexes.entries()) {
      const conversion = options.audioConversions?.find(item => item.sourceIndex === sourceIndex)
      if (conversion) {
        args.push(`-c:a:${outputIndex}`, conversion.codec, `-b:a:${outputIndex}`, `${conversion.bitrateKbps}k`)
      }
    }
    if (output.toLowerCase().endsWith('.mp4') && analysis.video?.hdrFormat?.toLowerCase() === 'dolby vision') {
      if (analysis.video.dolbyVisionProfile !== 5) {
        throw new Error('Dolby Vision MP4 remux is supported only when FFprobe identifies Profile 5; the source profile is unknown or unsupported.')
      }
      args.push('-tag:v', 'dvh1')
    }
    // For MP4 container remuxes (e.g. Dolby Vision profile 5 MKV -> MP4), ensure faststart
    if (output.toLowerCase().endsWith('.mp4')) {
      args.push('-movflags', '+faststart')
    }
    args.push(output)
    return args
  }
}
