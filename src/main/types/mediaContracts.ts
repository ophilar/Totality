/** Dependency-free media contracts shared by main-process analyzers and workers. */
export type HdrFormat = 'SDR' | 'HDR10' | 'HDR10+' | 'Dolby Vision' | 'HLG'

export interface HdrProbeMetadata {
  colorTransfer?: string
  colorPrimaries?: string
  colorSpace?: string
  sideDataTypes?: string[]
  profile?: string
}

export function detectHdrFormat(metadata: HdrProbeMetadata): HdrFormat {
  const transfer = metadata.colorTransfer?.toLowerCase() ?? ''
  const primaries = metadata.colorPrimaries?.toLowerCase() ?? ''
  const colorSpace = metadata.colorSpace?.toLowerCase() ?? ''
  const profile = metadata.profile?.toLowerCase() ?? ''
  const sideData = metadata.sideDataTypes?.map(value => value.toLowerCase()) ?? []
  if (sideData.some(value => value.includes('dolby vision') || value.includes('dovi'))) return 'Dolby Vision'
  if (sideData.some(value => value.includes('hdr10+') || value.includes('dynamic hdr') || value.includes('smpte2094'))) return 'HDR10+'
  if (transfer.includes('dovi') || primaries.includes('dovi') || colorSpace.includes('dovi') || profile.includes('dovi') || profile.includes('dvhe') || profile.includes('dvh1')) return 'Dolby Vision'
  if (transfer.includes('hdr10+') || transfer.includes('smpte2094') || primaries.includes('hdr10+')) return 'HDR10+'
  if (transfer.includes('arib-std-b67') || transfer.includes('hlg')) return 'HLG'
  if ((transfer.includes('smpte2084') || transfer.includes('st2084') || transfer.includes('pq')) &&
      (primaries.includes('bt2020') || primaries.includes('rec2020') || colorSpace.includes('bt2020') || colorSpace.includes('rec2020'))) return 'HDR10'
  return 'SDR'
}

export function normalizeHdrFormatValue(value: string | null | undefined): HdrFormat {
  const normalized = value?.trim().toLowerCase().replace(/[\s._-]/g, '')
  if (!normalized || normalized === 'none' || normalized === 'sdr') return 'SDR'
  if (normalized.includes('dolbyvision') || normalized.includes('dovi')) return 'Dolby Vision'
  if (normalized.includes('hdr10+') || normalized.includes('hdr10plus')) return 'HDR10+'
  if (normalized === 'hdr10' || normalized === 'hdr') return 'HDR10'
  if (normalized === 'hlg') return 'HLG'
  return 'SDR'
}
