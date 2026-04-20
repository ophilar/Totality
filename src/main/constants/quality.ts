/**
 * Quality Analysis Constants
 * 
 * Centralized thresholds and scores for media quality assessment.
 */

export const VIDEO_BITRATE_THRESHOLDS = {
  'SD': { medium: 1500, high: 3500 },
  '720p': { medium: 2500, high: 6000 },
  '1080p': { medium: 6000, high: 15000 },
  '4K': { medium: 15000, high: 40000 }
}

export const AUDIO_BITRATE_THRESHOLDS = {
  'SD': { medium: 128, high: 320 },
  '720p': { medium: 192, high: 448 },
  '1080p': { medium: 256, high: 640 },
  '4K': { medium: 320, high: 1000 }
}

export const STORAGE_DEBT_THRESHOLDS = {
  'SD': 2500,
  '720p': 2500,
  '1080p': 5000,
  '4K': 15000
}

export const AUDIO_QUALITY_SCORES = {
  OBJECT_AUDIO: 10000,
  LOSSLESS: 5000,
  SURROUND_PLUS: 3000,
  SURROUND: 2000,
  STEREO_PLUS: 1000,
  DEFAULT: 500
}

export const MIN_EFFICIENCY_SCORE = 60
export const HIGH_EFFICIENCY_SCORE = 85
export const MIN_STORAGE_DEBT_BYTES = 500 * 1024 * 1024 // 500 MB
