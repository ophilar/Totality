import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { appendStreamMappingArgs } from './StreamSelectionPlan'

export class StreamRemuxCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const args: string[] = ['-y', '-i', input, '-c:v', 'copy']
    const plan = appendStreamMappingArgs(args, analysis, options)
    for (const [outputIndex, sourceIndex] of plan.audioStreamIndexes.entries()) {
      const conversion = options.audioConversions?.find(item => item.sourceIndex === sourceIndex)
      if (conversion) args.push(`-c:a:${outputIndex}`, conversion.codec, `-b:a:${outputIndex}`, `${conversion.bitrateKbps}k`)
    }
    args.push(output)
    return args
  }
}
