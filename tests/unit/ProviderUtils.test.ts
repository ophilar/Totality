/**
 * ProviderUtils Unit Tests
 *
 * Tests for shared provider utility functions: best audio track selection,
 * commentary detection, bitrate estimation, and bitrate calculation.
 */

import { describe, it, expect } from 'vitest'
import {
  selectBestAudioTrack,
  isCommentaryTrack,
  estimateAudioBitrate,
  calculateAudioBitrateFromFile,
  isEstimatedBitrate,
} from '../../src/main/providers/utils/ProviderUtils'
import type { AudioTrackInfo } from '../../src/main/providers/utils/ProviderUtils'

// ============================================================================
// selectBestAudioTrack
// ============================================================================

describe('selectBestAudioTrack', () => {
  it('should return undefined for empty array', () => {
    expect(selectBestAudioTrack([])).toBeUndefined()
  })

  it('should return undefined for null', () => {
    expect(selectBestAudioTrack(null as unknown as AudioTrackInfo[])).toBeUndefined()
  })

  it('should select higher tier codec', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'aac', channels: 2, bitrate: 128 },
      { index: 1, codec: 'truehd', channels: 8, bitrate: 5000 },
    ]
    expect(selectBestAudioTrack(tracks)!.index).toBe(1)
  })

  it('should prefer more channels at same tier', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'ac3', channels: 2, bitrate: 384 },
      { index: 1, codec: 'aac', channels: 6, bitrate: 384 },
    ]
    expect(selectBestAudioTrack(tracks)!.channels).toBe(6)
  })

  it('should prefer higher bitrate at same tier and channels', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'ac3', channels: 6, bitrate: 384 },
      { index: 1, codec: 'ac3', channels: 6, bitrate: 640 },
    ]
    expect(selectBestAudioTrack(tracks)!.bitrate).toBe(640)
  })

  it('should filter out commentary tracks', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'truehd', channels: 8, bitrate: 5000, title: "Director's Commentary" },
      { index: 1, codec: 'ac3', channels: 6, bitrate: 448, title: 'English' },
    ]
    const best = selectBestAudioTrack(tracks)
    expect(best!.index).toBe(1) // Should skip commentary even though it's higher tier
  })

  it('should fall back to commentary tracks if all are commentary', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'ac3', channels: 6, bitrate: 448, title: 'Commentary with Director' },
      { index: 1, codec: 'aac', channels: 2, bitrate: 128, title: 'Commentary with Cast' },
    ]
    const best = selectBestAudioTrack(tracks)
    expect(best!.index).toBe(0) // Should use AC3 commentary (better quality)
  })
})

// ============================================================================
// isCommentaryTrack
// ============================================================================

describe('isCommentaryTrack', () => {
  it('should detect commentary in title', () => {
    expect(isCommentaryTrack({ title: "Director's Commentary" })).toBe(true)
    expect(isCommentaryTrack({ title: 'Commentary with Cast' })).toBe(true)
  })

  it('should be case-insensitive', () => {
    expect(isCommentaryTrack({ title: 'COMMENTARY' })).toBe(true)
  })

  it('should return false for non-commentary tracks', () => {
    expect(isCommentaryTrack({ title: 'English' })).toBe(false)
    expect(isCommentaryTrack({ title: 'English DTS-HD MA 7.1' })).toBe(false)
  })

  it('should return false for tracks without title', () => {
    expect(isCommentaryTrack({})).toBe(false)
    expect(isCommentaryTrack({ title: undefined })).toBe(false)
  })
})

// ============================================================================
// estimateAudioBitrate
// ============================================================================

describe('estimateAudioBitrate', () => {
  describe('lossless codecs', () => {
    it('should estimate TrueHD/Atmos bitrate by channel count', () => {
      expect(estimateAudioBitrate('truehd', 8)).toBe(6000)
      expect(estimateAudioBitrate('truehd', 6)).toBe(4000)
      expect(estimateAudioBitrate('truehd', 2)).toBe(2500)
    })

    it('should estimate TrueHD Atmos bitrate', () => {
      expect(estimateAudioBitrate('TrueHD Atmos', 8)).toBe(6000)
    })

    it('should estimate DTS-HD MA bitrate', () => {
      expect(estimateAudioBitrate('dts-hd ma', 8)).toBe(5000)
      expect(estimateAudioBitrate('dts-hd ma', 6)).toBe(3500)
      expect(estimateAudioBitrate('dtshd_ma', 2)).toBe(2000)
    })

    it('should estimate generic DTS-HD bitrate', () => {
      expect(estimateAudioBitrate('dts-hd hra', 6)).toBe(2500)
      expect(estimateAudioBitrate('dtshd', 2)).toBe(1500)
    })

    it('should estimate FLAC/PCM bitrate', () => {
      expect(estimateAudioBitrate('flac', 6)).toBe(3000)
      expect(estimateAudioBitrate('pcm', 2)).toBe(1500)
      expect(estimateAudioBitrate('lpcm', 2)).toBe(1500)
    })
  })

  describe('lossy codecs', () => {
    it('should estimate DTS bitrate', () => {
      expect(estimateAudioBitrate('dts', 6)).toBe(1509)
      expect(estimateAudioBitrate('dts', 2)).toBe(768)
    })

    it('should estimate EAC3 bitrate', () => {
      expect(estimateAudioBitrate('eac3', 8)).toBe(1024)
      expect(estimateAudioBitrate('eac3', 6)).toBe(640)
      expect(estimateAudioBitrate('e-ac-3', 2)).toBe(384)
    })

    it('should estimate AC3 bitrate', () => {
      expect(estimateAudioBitrate('ac3', 6)).toBe(640)
      expect(estimateAudioBitrate('ac-3', 2)).toBe(384)
    })

    it('should estimate AAC bitrate', () => {
      expect(estimateAudioBitrate('aac', 6)).toBe(384)
      expect(estimateAudioBitrate('aac', 2)).toBe(256)
    })

    it('should estimate MP3 bitrate', () => {
      expect(estimateAudioBitrate('mp3', 6)).toBe(320)
      expect(estimateAudioBitrate('mp3', 2)).toBe(192)
    })

    it('should estimate Opus bitrate', () => {
      expect(estimateAudioBitrate('opus', 6)).toBe(256)
      expect(estimateAudioBitrate('opus', 2)).toBe(128)
    })
  })

  describe('edge cases', () => {
    it('should handle null/undefined codec', () => {
      expect(estimateAudioBitrate(null, 6)).toBe(640)
      expect(estimateAudioBitrate(undefined, 2)).toBe(256)
    })

    it('should handle null/undefined channels', () => {
      expect(estimateAudioBitrate('aac', null)).toBe(256)
      expect(estimateAudioBitrate('aac', undefined)).toBe(256)
    })

    it('should return default for unknown codecs', () => {
      expect(estimateAudioBitrate('unknown', 6)).toBe(640)
      expect(estimateAudioBitrate('unknown', 2)).toBe(256)
    })
  })
})

// ============================================================================
// calculateAudioBitrateFromFile
// ============================================================================

describe('calculateAudioBitrateFromFile', () => {
  it('should calculate audio bitrate from total minus video', () => {
    // 20000 total, 15000 video = 5000 remaining * 0.95 / 1 track = 4750
    const result = calculateAudioBitrateFromFile(20000, 15000, 1)
    expect(result).toBe(4750)
  })

  it('should divide among multiple tracks', () => {
    // 20000 total, 15000 video = 5000 remaining * 0.95 / 2 tracks = 2375
    const result = calculateAudioBitrateFromFile(20000, 15000, 2)
    expect(result).toBe(2375)
  })

  it('should return 0 for zero total bitrate', () => {
    expect(calculateAudioBitrateFromFile(0, 15000, 1)).toBe(0)
  })

  it('should return 0 for zero video bitrate', () => {
    expect(calculateAudioBitrateFromFile(20000, 0, 1)).toBe(0)
  })

  it('should return 0 for zero tracks', () => {
    expect(calculateAudioBitrateFromFile(20000, 15000, 0)).toBe(0)
  })

  it('should return 0 when video exceeds total', () => {
    expect(calculateAudioBitrateFromFile(10000, 15000, 1)).toBe(0)
  })
})

// ============================================================================
// isEstimatedBitrate
// ============================================================================

describe('isEstimatedBitrate', () => {
  it('should detect known estimated values', () => {
    expect(isEstimatedBitrate(128)).toBe(true)
    expect(isEstimatedBitrate(256)).toBe(true)
    expect(isEstimatedBitrate(640)).toBe(true)
    expect(isEstimatedBitrate(1509)).toBe(true)
    expect(isEstimatedBitrate(5000)).toBe(true)
  })

  it('should return false for non-estimated values', () => {
    expect(isEstimatedBitrate(129)).toBe(false)
    expect(isEstimatedBitrate(448)).toBe(false)
    expect(isEstimatedBitrate(7500)).toBe(false)
  })
})
