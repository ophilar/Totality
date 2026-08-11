/** Dependency-free media contracts shared by main-process analyzers and workers. */
export type HdrFormat = 'SDR' | 'HDR10' | 'HDR10+' | 'Dolby Vision' | 'HLG'

export interface HdrProbeMetadata {
  colorTransfer?: string
  colorPrimaries?: string
  colorSpace?: string
  sideDataTypes?: string[]
}

export function detectHdrFormat(metadata: HdrProbeMetadata): HdrFormat {
  const transfer = metadata.colorTransfer?.toLowerCase() ?? ''
  const primaries = metadata.colorPrimaries?.toLowerCase() ?? ''
  const colorSpace = metadata.colorSpace?.toLowerCase() ?? ''
  const sideData = metadata.sideDataTypes?.map(value => value.toLowerCase()) ?? []
  if (sideData.some(value => value.includes('dolby vision'))) return 'Dolby Vision'
  if (sideData.some(value => value.includes('hdr10+') || value.includes('dynamic hdr'))) return 'HDR10+'
  if (transfer.includes('arib-std-b67') || transfer.includes('hlg')) return 'HLG'
  if ((transfer.includes('smpte2084') || transfer.includes('pq')) &&
      (primaries.includes('bt2020') || colorSpace.includes('bt2020'))) return 'HDR10'
  return 'SDR'
}

export function normalizeHdrFormatValue(value: string | null | undefined): HdrFormat {
  const normalized = value?.trim().toLowerCase().replace(/[._-]/g, '')
  if (!normalized || normalized === 'none' || normalized === 'sdr') return 'SDR'
  if (normalized.includes('dolbyvision') || normalized === 'dovi') return 'Dolby Vision'
  if (normalized.includes('hdr10+') || normalized.includes('hdr10plus')) return 'HDR10+'
  if (normalized === 'hdr10' || normalized === 'hdr') return 'HDR10'
  if (normalized === 'hlg') return 'HLG'
  return 'SDR'
}
