import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import type { TranscodeOptions } from './types'

export function getEncoderBitDepth(analysis: FileAnalysisResult, options: TranscodeOptions): 8 | 10 {
  const targetBitDepth = (options.targetConversion as { bitDepth?: number } | undefined)?.bitDepth
  const bitDepth = targetBitDepth ?? analysis.video?.bitDepth
  if (bitDepth !== 8 && bitDepth !== 10) {
    throw new Error(`Cannot select an encoder pixel format for ${bitDepth === undefined ? 'unknown' : `${bitDepth}-bit`} video`)
  }
  return bitDepth
}
