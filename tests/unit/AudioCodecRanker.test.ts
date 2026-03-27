/**
 * AudioCodecRanker Unit Tests
 *
 * Tests for audio codec quality tier ranking, best track selection,
 * lossless detection, and object audio support detection.
 */

import { describe, it, expect } from 'vitest'
import { AudioCodecRanker } from '../../src/main/services/AudioCodecRanker'
import type { AudioTrackInfo } from '../../src/main/services/AudioCodecRanker'

// ============================================================================
// getTier
// ============================================================================

describe('AudioCodecRanker.getTier', () => {
  describe('object audio (tier 5)', () => {
    it('should rank hasObjectAudio flag as tier 5', () => {
      expect(AudioCodecRanker.getTier('truehd', true)).toBe(5)
    })

    it('should rank Atmos in codec name as tier 5', () => {
      expect(AudioCodecRanker.getTier('TrueHD Atmos')).toBe(5)
    })

    it('should rank DTS:X as tier 5', () => {
      expect(AudioCodecRanker.getTier('DTS:X')).toBe(5)
    })

    it('should rank dtsx as tier 5', () => {
      expect(AudioCodecRanker.getTier('dtsx')).toBe(5)
    })
  })

  describe('lossless (tier 4)', () => {
    it('should rank TrueHD as tier 4', () => {
      expect(AudioCodecRanker.getTier('truehd')).toBe(4)
    })

    it('should rank DTS-HD MA as tier 4', () => {
      expect(AudioCodecRanker.getTier('dts-hd ma')).toBe(4)
    })

    it('should rank dtshd_ma as tier 4', () => {
      expect(AudioCodecRanker.getTier('dtshd_ma')).toBe(4)
    })

    it('should rank FLAC as tier 4', () => {
      expect(AudioCodecRanker.getTier('flac')).toBe(4)
    })

    it('should rank ALAC as tier 4', () => {
      expect(AudioCodecRanker.getTier('alac')).toBe(4)
    })

    it('should rank PCM as tier 4', () => {
      expect(AudioCodecRanker.getTier('pcm_s24le')).toBe(4)
    })

    it('should rank WAV as tier 4', () => {
      expect(AudioCodecRanker.getTier('wav')).toBe(4)
    })

    it('should rank AIFF as tier 4', () => {
      expect(AudioCodecRanker.getTier('aiff')).toBe(4)
    })
  })

  describe('near-lossless (tier 3)', () => {
    it('should rank DTS-HD HRA as tier 3', () => {
      expect(AudioCodecRanker.getTier('dts-hd hra')).toBe(3)
    })

    it('should rank dtshd_hra as tier 3', () => {
      expect(AudioCodecRanker.getTier('dtshd_hra')).toBe(3)
    })
  })

  describe('high-quality lossy (tier 2)', () => {
    it('should rank DTS as tier 2', () => {
      expect(AudioCodecRanker.getTier('dts')).toBe(2)
    })

    it('should rank EAC3 as tier 2', () => {
      expect(AudioCodecRanker.getTier('eac3')).toBe(2)
    })

    it('should rank DD+ as tier 2', () => {
      expect(AudioCodecRanker.getTier('dd+')).toBe(2)
    })

    it('should rank E-AC-3 as tier 2', () => {
      expect(AudioCodecRanker.getTier('e-ac-3')).toBe(2)
    })
  })

  describe('standard lossy (tier 1)', () => {
    it('should rank AC3 as tier 1', () => {
      expect(AudioCodecRanker.getTier('ac3')).toBe(1)
    })

    it('should rank AAC as tier 1', () => {
      expect(AudioCodecRanker.getTier('aac')).toBe(1)
    })

    it('should rank MP3 as tier 1', () => {
      expect(AudioCodecRanker.getTier('mp3')).toBe(1)
    })

    it('should rank unknown codecs as tier 1', () => {
      expect(AudioCodecRanker.getTier('unknown')).toBe(1)
    })
  })

  it('should be case-insensitive', () => {
    expect(AudioCodecRanker.getTier('TRUEHD')).toBe(4)
    expect(AudioCodecRanker.getTier('Flac')).toBe(4)
    expect(AudioCodecRanker.getTier('EAC3')).toBe(2)
  })
})

// ============================================================================
// selectBestTrack
// ============================================================================

describe('AudioCodecRanker.selectBestTrack', () => {
  it('should return undefined for empty array', () => {
    expect(AudioCodecRanker.selectBestTrack([])).toBeUndefined()
  })

  it('should return undefined for null/undefined', () => {
    expect(AudioCodecRanker.selectBestTrack(null as unknown as AudioTrackInfo[])).toBeUndefined()
  })

  it('should return the only track for single-element array', () => {
    const track: AudioTrackInfo = { index: 0, codec: 'aac', channels: 2, bitrate: 128 }
    expect(AudioCodecRanker.selectBestTrack([track])).toBe(track)
  })

  it('should prefer higher tier codec', () => {
    const aac: AudioTrackInfo = { index: 0, codec: 'aac', channels: 6, bitrate: 640 }
    const truehd: AudioTrackInfo = { index: 1, codec: 'truehd', channels: 6, bitrate: 640 }
    expect(AudioCodecRanker.selectBestTrack([aac, truehd])).toBe(truehd)
  })

  it('should prefer more channels at same tier', () => {
    const stereo: AudioTrackInfo = { index: 0, codec: 'ac3', channels: 2, bitrate: 640 }
    const surround: AudioTrackInfo = { index: 1, codec: 'ac3', channels: 6, bitrate: 448 }
    expect(AudioCodecRanker.selectBestTrack([stereo, surround])).toBe(surround)
  })

  it('should prefer higher bitrate at same tier and channels', () => {
    const low: AudioTrackInfo = { index: 0, codec: 'ac3', channels: 6, bitrate: 384 }
    const high: AudioTrackInfo = { index: 1, codec: 'ac3', channels: 6, bitrate: 640 }
    expect(AudioCodecRanker.selectBestTrack([low, high])).toBe(high)
  })

  it('should prefer object audio over lossless', () => {
    const truehd: AudioTrackInfo = { index: 0, codec: 'truehd', channels: 8, bitrate: 5000 }
    const atmos: AudioTrackInfo = { index: 1, codec: 'truehd', channels: 8, bitrate: 5000, hasObjectAudio: true }
    expect(AudioCodecRanker.selectBestTrack([truehd, atmos])).toBe(atmos)
  })

  it('should select best from mixed tracks', () => {
    const tracks: AudioTrackInfo[] = [
      { index: 0, codec: 'aac', channels: 2, bitrate: 128 },
      { index: 1, codec: 'ac3', channels: 6, bitrate: 448 },
      { index: 2, codec: 'truehd', channels: 8, bitrate: 5000, hasObjectAudio: true },
      { index: 3, codec: 'dts', channels: 6, bitrate: 1509 },
    ]
    const best = AudioCodecRanker.selectBestTrack(tracks)
    expect(best).toBe(tracks[2]) // TrueHD Atmos
  })
})

// ============================================================================
// getTierName
// ============================================================================

describe('AudioCodecRanker.getTierName', () => {
  it('should return correct names for all tiers', () => {
    expect(AudioCodecRanker.getTierName(5)).toBe('Object Audio')
    expect(AudioCodecRanker.getTierName(4)).toBe('Lossless')
    expect(AudioCodecRanker.getTierName(3)).toBe('Near-Lossless')
    expect(AudioCodecRanker.getTierName(2)).toBe('High-Quality Lossy')
    expect(AudioCodecRanker.getTierName(1)).toBe('Standard')
  })

  it('should return Unknown for invalid tier', () => {
    expect(AudioCodecRanker.getTierName(0)).toBe('Unknown')
    expect(AudioCodecRanker.getTierName(99)).toBe('Unknown')
  })
})

// ============================================================================
// isLossless
// ============================================================================

describe('AudioCodecRanker.isLossless', () => {
  it('should return true for lossless codecs', () => {
    expect(AudioCodecRanker.isLossless('truehd')).toBe(true)
    expect(AudioCodecRanker.isLossless('flac')).toBe(true)
    expect(AudioCodecRanker.isLossless('alac')).toBe(true)
    expect(AudioCodecRanker.isLossless('pcm_s24le')).toBe(true)
  })

  it('should return true for object audio (tier 5 >= tier 4)', () => {
    expect(AudioCodecRanker.isLossless('TrueHD Atmos')).toBe(true)
  })

  it('should return false for lossy codecs', () => {
    expect(AudioCodecRanker.isLossless('ac3')).toBe(false)
    expect(AudioCodecRanker.isLossless('aac')).toBe(false)
    expect(AudioCodecRanker.isLossless('mp3')).toBe(false)
    expect(AudioCodecRanker.isLossless('eac3')).toBe(false)
  })

  it('should return false for near-lossless (tier 3 < tier 4)', () => {
    expect(AudioCodecRanker.isLossless('dts-hd hra')).toBe(false)
  })
})

// ============================================================================
// hasObjectAudioSupport
// ============================================================================

describe('AudioCodecRanker.hasObjectAudioSupport', () => {
  it('should detect Atmos in codec name', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('TrueHD Atmos')).toBe(true)
  })

  it('should detect DTS:X in codec name', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('DTS:X')).toBe(true)
    expect(AudioCodecRanker.hasObjectAudioSupport('dtsx')).toBe(true)
  })

  it('should detect TrueHD with Atmos in profile', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('truehd', 'Atmos')).toBe(true)
  })

  it('should detect TrueHD with Atmos in title', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('truehd', undefined, 'English TrueHD Atmos 7.1')).toBe(true)
  })

  it('should detect DTS-HD with DTS:X in profile', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('dts-hd ma', 'DTS:X')).toBe(true)
  })

  it('should detect DTS-HD with DTS:X in title', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('dtshd_ma', undefined, 'English DTS:X 7.1')).toBe(true)
  })

  it('should detect EAC3 with Atmos in profile', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('eac3', 'Atmos')).toBe(true)
  })

  it('should detect DD+ with Atmos in title', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('dd+', undefined, 'English DD+ Atmos 7.1')).toBe(true)
  })

  it('should detect DDP with Atmos in title', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('ddp', undefined, 'Atmos')).toBe(true)
  })

  it('should return false for plain codecs without object audio', () => {
    expect(AudioCodecRanker.hasObjectAudioSupport('truehd')).toBe(false)
    expect(AudioCodecRanker.hasObjectAudioSupport('dts-hd ma')).toBe(false)
    expect(AudioCodecRanker.hasObjectAudioSupport('eac3')).toBe(false)
    expect(AudioCodecRanker.hasObjectAudioSupport('ac3')).toBe(false)
    expect(AudioCodecRanker.hasObjectAudioSupport('aac')).toBe(false)
  })
})
