import type { FileAnalysisResult } from '../MediaFileAnalyzer'

export function validateHdrTranscode(analysis: FileAnalysisResult): void {
  const hdrFormat = analysis.video?.hdrFormat?.toLowerCase()
  if (hdrFormat === 'dolby vision' || hdrFormat === 'hdr10+') {
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
