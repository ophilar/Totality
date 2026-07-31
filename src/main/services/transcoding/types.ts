import { TranscodeOptions } from '../TranscodingService'
import { FileAnalysisResult } from '../MediaFileAnalyzer'

export interface ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[]
  buildHandbrakeArgs(input: string, output: string, options: TranscodeOptions, analysis: FileAnalysisResult): string[]
}
