
import type { TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'

export function hdrLabel(analysis: FileAnalysisResult): string {
  const format = analysis.video?.hdrFormat || 'SDR'
  return format
}

export function validateHdrTranscode(analysis: FileAnalysisResult, options: TranscodeOptions = {}): void {
  if (options.targetConversion) return
  const hdrFormat = analysis.video?.hdrFormat?.toLowerCase()
  if (hdrFormat === 'dolby vision' || hdrFormat === 'hdr10+') {
    if (options.optimizationMode !== 'remux_only' && options.encoder !== 'remux' && options.encoder !== 'copy') {
      throw new Error(`${analysis.video?.hdrFormat} transcoding is not supported because dynamic HDR metadata cannot be preserved unless converted or remuxed.`)
    }
  }
}

export function buildHdrMetadataArgs(analysis: FileAnalysisResult, options: TranscodeOptions = {}): string[] {
  validateHdrTranscode(analysis, options)
  const targetConversion = options.targetConversion as { hdrFormat?: string } | undefined
  if (targetConversion) {
    if ((!analysis.video?.hdrFormat || analysis.video.hdrFormat === 'SDR') && targetConversion.hdrFormat === 'SDR') return []
    const sdr = targetConversion.hdrFormat === 'SDR'
    return [
      '-colorspace', sdr ? 'bt709' : 'bt2020nc',
      '-color_primaries', sdr ? 'bt709' : 'bt2020',
      '-color_trc', sdr ? 'bt709' : targetConversion.hdrFormat === 'HLG' ? 'arib-std-b67' : 'smpte2084'
    ]
  }
  const hdrFormat = analysis.video?.hdrFormat?.toLowerCase()
  if (hdrFormat !== 'hdr10' && hdrFormat !== 'hlg') return []
  return [
    '-colorspace', analysis.video?.colorSpace || 'bt2020nc',
    '-color_primaries', analysis.video?.colorPrimaries || 'bt2020',
    '-color_trc', analysis.video?.colorTransfer || (hdrFormat === 'hlg' ? 'arib-std-b67' : 'smpte2084')
  ]
}
