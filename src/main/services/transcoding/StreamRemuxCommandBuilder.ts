import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'
import { appendStreamMappingArgs } from './StreamSelectionPlan'

export class StreamRemuxCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[] {
    const args: string[] = ['-y', '-i', input, '-c:v', 'copy']
    appendStreamMappingArgs(args, analysis, options)
    args.push(output)
    return args
  }
}
