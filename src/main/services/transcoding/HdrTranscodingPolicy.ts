import type { FileAnalysisResult } from '../MediaFileAnalyzer'

export function hdrLabel(analysis: FileAnalysisResult): string {
  const format = analysis.video?.hdrFormat || 'SDR'
  if (format === 'Dolby Vision') {
    const profile = analysis.video?.profile?.match(/(?:dv|dolby vision)[^0-9]*([0-9.]+)/i)?.[1]
    return profile ? `DV Profile ${profile}` : 'DV'
  }
  return format
}

export function validateHdrTranscode(analysis: FileAnalysisResult): void {
  const hdrFormat = analysis.video?.hdrFormat?.toLowerCase()
  if (hdrFormat === 'dolby vision' || hdrFormat === 'hdr10+' || hdrFormat === 'hlg') {
    throw new Error(`${analysis.video?.hdrFormat} transcoding is not supported because dynamic HDR metadata cannot be preserved.`)
  }
}

export function buildHdrMetadataArgs(analysis: FileAnalysisResult): string[] {
  validateHdrTranscode(analysis)
  if (analysis.video?.hdrFormat?.toLowerCase() !== 'hdr10') return []
  return [
    '-colorspace', analysis.video.colorSpace || 'bt2020nc',
    '-color_primaries', analysis.video.colorPrimaries || 'bt2020',
    '-color_trc', analysis.video.colorTransfer || 'smpte2084'
  ]
}
