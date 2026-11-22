
interface FFprobeMetadata {
  avg_frame_rate?: string
  r_frame_rate?: string
  bits_per_raw_sample?: string
  pix_fmt?: string
  color_transfer?: string
  color_primaries?: string
  color_space?: string
  side_data_list?: Array<{ side_data_type: string }>
}

export function parseFrameRate(frameRateStr?: string): number | undefined {
  if (!frameRateStr || frameRateStr === '0/0') return undefined

  const parts = frameRateStr.split('/')
  if (parts.length === 2) {
    const num = parseInt(parts[0], 10)
    const den = parseInt(parts[1], 10)
    if (den !== 0) {
      return Math.round((num / den) * 100) / 100
    }
  }

  const parsed = parseFloat(frameRateStr)
  return isNaN(parsed) ? undefined : Math.round(parsed * 100) / 100
}

export function estimateAudioBitrate(
  codec: string,
  channels: number,
  profile?: string,
  sampleRateStr?: string
): number | undefined {
  const codecLower = codec.toLowerCase()
  const sampleRate = sampleRateStr ? parseInt(sampleRateStr, 10) : 48000

  if (codecLower === 'ac3') {
    if (channels <= 2) return 192
    if (channels <= 6) return 448
    return 640
  }

  if (codecLower === 'eac3') {
    if (channels <= 2) return 256
    if (channels <= 6) return 640
    if (channels <= 8) return 1024
    return 1536
  }

  if (codecLower === 'truehd') {
    const baseRate = sampleRate > 48000 ? 4000 : 2500
    if (channels <= 2) return Math.round(baseRate * 0.4)
    if (channels <= 6) return baseRate
    if (channels <= 8) return Math.round(baseRate * 1.6)
    return Math.round(baseRate * 2)
  }

  if (codecLower === 'dts') {
    const profileLower = profile?.toLowerCase() || ''
    if (profileLower.includes('ma') || profileLower.includes('hd ma')) {
      if (channels <= 2) return 1500
      if (channels <= 6) return 3000
      if (channels <= 8) return 4500
      return 6000
    }
    if (profileLower.includes('hra') || profileLower.includes('hd hra')) {
      if (channels <= 6) return 1500
      return 2000
    }
    if (channels <= 2) return 768
    if (channels <= 6) return 1509
    return 1509
  }

  if (codecLower === 'flac') {
    return Math.round((channels * sampleRate * 16 * 0.6) / 1000)
  }

  if (codecLower.includes('pcm')) {
    return Math.round((channels * sampleRate * 16) / 1000)
  }

  return undefined
}

export function extractBitDepth(stream: FFprobeMetadata): number | undefined {
  if (stream.bits_per_raw_sample) {
    return parseInt(stream.bits_per_raw_sample, 10)
  }

  const pixFmt = stream.pix_fmt?.toLowerCase() || ''
  if (pixFmt.includes('12le') || pixFmt.includes('12be')) return 12
  if (pixFmt.includes('10le') || pixFmt.includes('10be') || pixFmt.includes('p010')) return 10
  if (pixFmt.includes('yuv420p') || pixFmt.includes('yuv422p') || pixFmt.includes('yuv444p')) return 8

  return undefined
}

export function detectHdrFormat(stream: FFprobeMetadata): string | undefined {
  const colorTransfer = stream.color_transfer?.toLowerCase() || ''
  const colorPrimaries = stream.color_primaries?.toLowerCase() || ''
  const colorSpace = stream.color_space?.toLowerCase() || ''

  const sideData = stream.side_data_list || []
  const hasDolbyVision = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('dolby vision')
  )
  const hasHdr10Plus = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('hdr10+') ||
    sd.side_data_type?.toLowerCase().includes('dynamic hdr')
  )
  const hasMasteringDisplay = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('mastering display')
  )
  const hasContentLight = sideData.some(sd =>
    sd.side_data_type?.toLowerCase().includes('content light')
  )

  if (hasDolbyVision) return 'Dolby Vision'
  if (hasHdr10Plus) return 'HDR10+'

  if (
    (colorTransfer.includes('smpte2084') || colorTransfer.includes('pq')) &&
    (colorPrimaries.includes('bt2020') || colorSpace.includes('bt2020'))
  ) {
    if (hasMasteringDisplay || hasContentLight) return 'HDR10'
    return 'PQ'
  }

  if (colorTransfer.includes('arib-std-b67') || colorTransfer.includes('hlg')) {
    return 'HLG'
  }

  return undefined
}
