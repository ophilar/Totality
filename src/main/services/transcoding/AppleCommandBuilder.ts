import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'

export class AppleCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(_input: string, _output: string, options: TranscodeOptions, _analysis: FileAnalysisResult): string[] {
    if (options.targetCodec === 'av1') throw new Error('VideoToolbox supports HEVC, not AV1.')
    throw new Error('Per-GPU VideoToolbox encoding is unavailable until FFmpeg can require the selected GPU registry ID.')
  }
}
