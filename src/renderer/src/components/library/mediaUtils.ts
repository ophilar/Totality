/**
 * Media Browser Utility Functions and Constants
 *
 * Shared utilities used across media browser components.
 */

import { PROVIDERS } from '@main/constants/providers'

// ============================================================================
// Constants
// ============================================================================

/** Provider colors for source badges */
export const providerColors: Record<string, string> = Object.values(PROVIDERS).reduce((acc, p) => ({ ...acc, [p.type]: p.color }), {})

/** Lossless audio codecs */
export const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'pcm', 'ape', 'wv', 'wavpack']

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format season label (Season 0 = Specials)
 */
export const formatSeasonLabel = (seasonNumber: number): string => {
  return seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`
}

/**
 * Format duration from milliseconds to MM:SS or HH:MM:SS
 */
export const formatDuration = (ms?: number): string => {
  if (!ms) return '--:--'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Format bitrate for display (e.g., "320 kbps" or "1.5 Mbps")
 */
export const formatBitrate = (bitrate?: number): string => {
  if (!bitrate) return '--'
  if (bitrate >= 1000) {
    return `${(bitrate / 1000).toFixed(1)} Mbps`
  }
  return `${bitrate} kbps`
}

/**
 * Format sample rate for display (e.g., "44.1 kHz" or "96 kHz")
 */
export const formatSampleRate = (sampleRate?: number): string => {
  if (!sampleRate) return '--'
  if (sampleRate >= 1000) {
    return `${(sampleRate / 1000).toFixed(1)} kHz`
  }
  return `${sampleRate} Hz`
}

/**
 * Format file size for display
 */
export const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '--'
  if (bytes >= 1073741824) {
    return `${(bytes / 1073741824).toFixed(2)} GB`
  }
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`
  }
  return `${(bytes / 1024).toFixed(0)} KB`
}

export {
  formatLanguage,
  isSameLanguage,
  normalizeLanguage,
  toIso639_2,
  CANONICAL_LANGUAGE_CODES,
  LANGUAGE_OPTIONS,
  LANGUAGE_ALIASES_TO_2,
  ISO639_1_TO_3,
} from '@main/constants/languages'

// ============================================================================
// Quality Assessment Functions
// ============================================================================

/**
 * Check if a codec is lossless
 */
export const isLosslessCodec = (codec?: string): boolean => {
  if (!codec) return false
  const normalized = codec.toLowerCase()
  return losslessCodecs.some(c => normalized.includes(c))
}

/**
 * Check if a codec is AAC
 */
export const isAACCodec = (codec?: string): boolean => {
  if (!codec) return false
  return codec.toLowerCase().includes('aac')
}

/**
 * Get quality tier color
 */
export const getQualityTierColor = (tier?: string | null): string => {
  if (!tier) return 'text-muted-foreground'
  const normalized = tier.toLowerCase()
  switch (normalized) {
    case 'hi_res':
    case 'ultra':
      return 'text-purple-400'
    case 'lossless':
    case 'high':
      return 'text-green-400'
    case 'lossy_high':
    case 'high-lossy':
    case 'lossy_mid':
    case 'medium':
      return 'text-yellow-400'
    case 'lossy_low':
    case 'low':
      return 'text-red-400'
    default:
      return 'text-muted-foreground'
  }
}

/**
 * Get quality tier background color
 */
export const getQualityTierBgColor = (tier?: string | null): string => {
  if (!tier) return 'bg-muted/30'
  const normalized = tier.toLowerCase()
  switch (normalized) {
    case 'hi_res':
    case 'ultra':
      return 'bg-purple-500/20'
    case 'lossless':
    case 'high':
      return 'bg-green-500/20'
    case 'lossy_high':
    case 'high-lossy':
    case 'lossy_mid':
    case 'medium':
      return 'bg-yellow-500/20'
    case 'lossy_low':
    case 'low':
      return 'bg-red-500/20'
    default:
      return 'bg-muted/30'
  }
}

/**
 * Check if a track is high resolution (24-bit or >48kHz)
 */
export const isHighResTrack = (bitDepth?: number, sampleRate?: number): boolean => {
  return (bitDepth !== undefined && bitDepth >= 24) || (sampleRate !== undefined && sampleRate > 48000)
}

// ============================================================================
// Status Functions
// ============================================================================

/**
 * Get status badge styling for TV show status
 */
export const getStatusBadge = (status?: string): { text: string; color: string } | null => {
  if (!status) return null

  const statusLower = status.toLowerCase()
  if (statusLower.includes('return')) {
    return { color: 'bg-green-600', text: 'Returning' }
  } else if (statusLower.includes('ended')) {
    return { color: 'bg-gray-500', text: 'Ended' }
  } else if (statusLower.includes('cancel')) {
    return { color: 'bg-red-600', text: 'Canceled' }
  } else if (statusLower.includes('production')) {
    return { color: 'bg-blue-600', text: 'In Production' }
  }
  return null
}

// ============================================================================
// Grid Calculations
// ============================================================================

/**
 * Calculate poster minimum width based on grid scale
 */
export const calculatePosterWidth = (gridScale: number): number => {
    const widths = [96, 112, 128, 144, 160, 176, 192]
    const clampedScale = Math.max(1, Math.min(widths.length, Math.round(gridScale)))
    return widths[clampedScale - 1]
}

/**
 * Calculate grid columns based on container width and poster width
 */
export const calculateGridColumns = (containerWidth: number, posterWidth: number): number => {
  const gap = 16 // gap-4 = 16px
  return Math.max(1, Math.floor((containerWidth + gap) / (posterWidth + gap)))
}
