import type { TranscodeOptions } from '../TranscodingService'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'

export function hdrLabel(analysis: FileAnalysisResult): string {
  const format = analysis.video?.hdrFormat || 'SDR'
  if (format === 'Dolby Vision') {
    const profile = analysis.video?.dolbyVisionProfile
    return profile ? `DV Profile ${profile}` : 'DV'
  }
  return format
}

export function validateHdrTranscode(analysis: FileAnalysisResult, options: TranscodeOptions = {}): void {
  if (options.targetConversion) return
  const hdrFormat = analysis.video?.hdrFormat?.toLowerCase()
  if (hdrFormat === 'dolby vision' || hdrFormat === 'hdr10+' || hdrFormat === 'hlg') {
    throw new Error(`${analysis.video?.hdrFormat} transcoding is not supported because dynamic HDR metadata cannot be preserved.`)
  }
}

export function buildHdrMetadataArgs(analysis: FileAnalysisResult, options: TranscodeOptions = {}): string[] {
  validateHdrTranscode(analysis, options)
  if (options.targetConversion) {
    if ((!analysis.video?.hdrFormat || analysis.video.hdrFormat === 'SDR') && options.targetConversion.hdrFormat === 'SDR') return []
    const sdr = options.targetConversion.hdrFormat === 'SDR'
    return ['-colorspace', sdr ? 'bt709' : 'bt2020nc', '-color_primaries', sdr ? 'bt709' : 'bt2020', '-color_trc', sdr ? 'bt709' : options.targetConversion.hdrFormat === 'HLG' ? 'arib-std-b67' : 'smpte2084']
  }
  if (analysis.video?.hdrFormat?.toLowerCase() !== 'hdr10') return []
  return [
    '-colorspace', analysis.video.colorSpace || 'bt2020nc',
    '-color_primaries', analysis.video.colorPrimaries || 'bt2020',
    '-color_trc', analysis.video.colorTransfer || 'smpte2084'
  ]
}
