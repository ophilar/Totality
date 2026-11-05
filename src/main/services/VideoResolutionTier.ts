import { APP_CONFIG } from '@main/config'
const videoBitrateThresholds = APP_CONFIG.quality.videoBitrateThresholds
type VideoQualityTier = keyof typeof videoBitrateThresholds

export function getVideoResolutionTier(resolution: string | null | undefined, height: number | null | undefined): VideoQualityTier | 'Unknown' {
  const normalizedResolution = resolution?.trim().toLowerCase()

  if (normalizedResolution) {
    if (normalizedResolution.includes('4k') || normalizedResolution.includes('2160p') || normalizedResolution.includes('uhd')) return '4K'
    if (normalizedResolution.includes('1080p') || normalizedResolution.includes('1080i') || normalizedResolution.includes('fhd')) return '1080p'
    if (normalizedResolution.includes('720p') || normalizedResolution.includes('720i') || normalizedResolution.includes('hd')) return '720p'
    if (normalizedResolution.includes('sd') || normalizedResolution.includes('480p') || normalizedResolution.includes('576p') || normalizedResolution.includes('480i') || normalizedResolution.includes('576i')) return 'SD'

    const dimensions = normalizedResolution.match(/(\d+)\s*x\s*(\d+)/i)
    if (dimensions) {
      const resolutionHeight = Number.parseInt(dimensions[2], 10)
      if (resolutionHeight >= 2160) return '4K'
      if (resolutionHeight >= 1080) return '1080p'
      if (resolutionHeight >= 720) return '720p'
      if (resolutionHeight > 0) return 'SD'
    }
  }

  if (height != null && height > 0) {
    if (height >= 2160) return '4K'
    if (height >= 1080) return '1080p'
    if (height >= 720) return '720p'
    return 'SD'
  }

  return 'Unknown'
}

export function getVideoResolutionRank(qualityTier: string | null | undefined): number | null {
  const rank = Object.keys(videoBitrateThresholds).indexOf(qualityTier ?? '')
  return rank === -1 ? null : rank
}

