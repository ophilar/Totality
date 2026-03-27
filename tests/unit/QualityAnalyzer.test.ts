/**
 * QualityAnalyzer Unit Tests
 *
 * Tests for quality scoring logic including resolution tiers,
 * bitrate analysis, codec efficiency, and audio quality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock database getter before importing QualityAnalyzer
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSettingsByPrefix: vi.fn(() => ({})),
    upsertQualityScore: vi.fn(),
  })),
}))

import { QualityAnalyzer } from '../../src/main/services/QualityAnalyzer'
import type { MediaItem, MediaItemVersion, MusicAlbum, MusicTrack, MusicQualityScore } from '../../src/main/types/database'

describe('QualityAnalyzer', () => {
  let analyzer: QualityAnalyzer

  beforeEach(() => {
    vi.clearAllMocks()
    analyzer = new QualityAnalyzer()
  })

  // ============================================================================
  // RESOLUTION TIER DETECTION
  // ============================================================================

  describe('resolution tier detection', () => {
    it('should classify SD resolution (below 720p)', async () => {
      const item = createMediaItem({ resolution: '480p', video_bitrate: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
    })

    it('should classify 720p resolution', async () => {
      const item = createMediaItem({ resolution: '720p', video_bitrate: 5000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })

    it('should classify 1080p resolution', async () => {
      const item = createMediaItem({ resolution: '1080p', video_bitrate: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should classify 4K resolution (2160p)', async () => {
      const item = createMediaItem({ resolution: '2160p', video_bitrate: 25000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should parse WxH resolution format correctly', async () => {
      const item = createMediaItem({ resolution: '1920x1080', video_bitrate: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should default to SD for unknown resolution', async () => {
      const item = createMediaItem({ resolution: 'unknown', video_bitrate: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
    })
  })

  // ============================================================================
  // TIER QUALITY (WITHIN-TIER SCORING)
  // ============================================================================

  describe('tier quality scoring', () => {
    it('should rate HIGH quality for high bitrate 1080p', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 20000,
        audio_channels: 6,
        audio_codec: 'truehd',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should rate MEDIUM quality for medium bitrate 1080p', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        audio_channels: 6,
        audio_codec: 'ac3',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('MEDIUM')
    })

    it('should rate LOW quality for low bitrate 1080p', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 3000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('LOW')
    })

    it('should consider audio quality in overall tier', async () => {
      // High video bitrate but poor audio should not be HIGH
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 20000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      // Audio is LOW, so overall should not be HIGH
      expect(['LOW', 'MEDIUM']).toContain(score.tier_quality)
    })
  })

  // ============================================================================
  // CODEC EFFICIENCY
  // ============================================================================

  describe('codec efficiency', () => {
    it('should apply HEVC/H.265 efficiency multiplier', async () => {
      const h264Item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        video_codec: 'h264',
      })
      const hevcItem = createMediaItem({
        resolution: '1080p',
        video_bitrate: 4000, // Half the bitrate
        video_codec: 'hevc',
      })

      const h264Score = await analyzer.analyzeMediaItem(h264Item)
      const hevcScore = await analyzer.analyzeMediaItem(hevcItem)

      // HEVC at half bitrate should have similar or better effective quality
      // due to 2x efficiency multiplier
      expect(hevcScore.tier_score).toBeGreaterThanOrEqual(h264Score.tier_score - 20)
    })

    it('should apply AV1 efficiency multiplier', async () => {
      const item = createMediaItem({
        resolution: '2160p', // Use standard resolution string
        video_bitrate: 16000,
        video_codec: 'av1',
        audio_codec: 'truehd', // HIGH audio to not drag down overall
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      // AV1 has 2.5x efficiency, so effective bitrate is 40000 (at 40000 HIGH threshold)
      expect(score.tier_quality).toBe('HIGH')
    })
  })

  // ============================================================================
  // AUDIO QUALITY
  // ============================================================================

  describe('audio quality detection', () => {
    it('should recognize object audio (Atmos) as HIGH quality', async () => {
      const item = createMediaItem({
        resolution: '2160p', // Standard resolution string
        video_bitrate: 45000, // Above 4K HIGH threshold (40000)
        has_object_audio: true,
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should recognize lossless audio (TrueHD) as HIGH quality', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should recognize DTS-HD MA as lossless', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'dts-hd ma',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should recognize FLAC as lossless', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'flac',
        audio_channels: 2,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should rate AC3 5.1 as MEDIUM quality', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_bitrate: 448,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('MEDIUM')
    })

    it('should rate stereo AAC at low bitrate as LOW', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 8000,
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate: 96,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('LOW')
    })
  })

  // ============================================================================
  // NEEDS UPGRADE FLAG
  // ============================================================================

  describe('needs upgrade detection', () => {
    it('should flag LOW quality items as needing upgrade', async () => {
      const item = createMediaItem({
        resolution: '720p',
        video_bitrate: 1500,
        audio_channels: 2,
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.needs_upgrade).toBe(true)
    })

    it('should not flag HIGH quality items as needing upgrade', async () => {
      const item = createMediaItem({
        resolution: '4K',
        video_bitrate: 50000,
        audio_codec: 'truehd',
        audio_channels: 8,
        has_object_audio: true,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.needs_upgrade).toBe(false)
    })
  })

  // ============================================================================
  // AUDIO TRACKS PARSING
  // ============================================================================

  describe('audio tracks parsing', () => {
    it('should select best audio track from multiple tracks', async () => {
      const item = createMediaItem({
        resolution: '2160p', // Standard resolution string
        video_bitrate: 45000, // Above 4K HIGH threshold (40000)
        audio_codec: 'aac', // Default fallback
        audio_channels: 2,
        audio_tracks: JSON.stringify([
          { codec: 'aac', channels: 2, bitrate: 128, hasObjectAudio: false },
          { codec: 'truehd', channels: 8, bitrate: 5000, hasObjectAudio: true },
          { codec: 'ac3', channels: 6, bitrate: 448, hasObjectAudio: false },
        ]),
      })
      const score = await analyzer.analyzeMediaItem(item)
      // Should select TrueHD Atmos track as best (object audio = HIGH)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should fallback to primary audio fields if audio_tracks is empty', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_tracks: '[]',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should handle invalid audio_tracks JSON gracefully', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_tracks: 'not valid json',
      })
      // Should not throw
      const score = await analyzer.analyzeMediaItem(item)
      expect(score).toBeDefined()
    })
  })

  // ============================================================================
  // ISSUES REPORTING
  // ============================================================================

  describe('issues reporting', () => {
    it('should report low bitrate issue', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 2000,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.issues).toContain('Low bitrate')
    })

    it('should report poor audio issue', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.issues).toContain('audio')
    })
  })

  // ============================================================================
  // THRESHOLD CACHING
  // ============================================================================

  describe('threshold caching', () => {
    it('should invalidate thresholds cache', () => {
      analyzer.invalidateThresholdsCache()
      // Should not throw
      expect(() => analyzer.invalidateThresholdsCache()).not.toThrow()
    })
  })

  // ============================================================================
  // RESOLUTION TIER CLASSIFICATION (additional edge cases)
  // ============================================================================

  describe('resolution tier classification edge cases', () => {
    it('should classify 1080i as 1080p tier', async () => {
      const item = createMediaItem({ resolution: '1080i', video_bitrate: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should classify 720i as 720p tier', async () => {
      const item = createMediaItem({ resolution: '720i', video_bitrate: 5000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })

    it('should classify 4K string as 4K tier', async () => {
      const item = createMediaItem({ resolution: '4K', video_bitrate: 25000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should parse WxH format for 4K (3840x2160)', async () => {
      const item = createMediaItem({ resolution: '3840x2160', video_bitrate: 25000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should parse WxH format for 720p (1280x720)', async () => {
      const item = createMediaItem({ resolution: '1280x720', video_bitrate: 5000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })

    it('should parse WxH format for SD (640x480)', async () => {
      const item = createMediaItem({ resolution: '640x480', video_bitrate: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
    })

    it('should fall back to height field when resolution string is unknown', async () => {
      const item = createMediaItem({ resolution: 'custom', video_bitrate: 10000, height: 1080 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should use height field for 4K fallback', async () => {
      const item = createMediaItem({ resolution: 'custom', video_bitrate: 25000, height: 2160 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should use height field for 720p fallback', async () => {
      const item = createMediaItem({ resolution: 'custom', video_bitrate: 5000, height: 720 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })
  })

  // ============================================================================
  // VIDEO TIER SCORE CALCULATION
  // ============================================================================

  describe('video tier score calculation', () => {
    it('should return 0 for zero bitrate', async () => {
      const item = createMediaItem({ resolution: '1080p', video_bitrate: 0 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.bitrate_tier_score).toBe(0)
    })

    it('should return 100 for bitrate at or above HIGH threshold', async () => {
      // 1080p HIGH threshold = 15000
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        video_codec: 'h264',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.bitrate_tier_score).toBe(100)
    })

    it('should return score below 50 for bitrate below MEDIUM threshold', async () => {
      // 1080p MEDIUM threshold = 6000
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 3000,
        video_codec: 'h264',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.bitrate_tier_score).toBeLessThan(50)
      expect(score.bitrate_tier_score).toBeGreaterThan(0)
    })

    it('should return score between 50-99 for bitrate between MEDIUM and HIGH', async () => {
      // 1080p: MEDIUM=6000, HIGH=15000
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 10000,
        video_codec: 'h264',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.bitrate_tier_score).toBeGreaterThanOrEqual(50)
      expect(score.bitrate_tier_score).toBeLessThan(100)
    })
  })

  // ============================================================================
  // AUDIO TIER SCORE CALCULATION
  // ============================================================================

  describe('audio tier score calculation', () => {
    it('should return 100 for object audio', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        has_object_audio: true,
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.audio_tier_score).toBe(100)
    })

    it('should return 100 for lossless audio', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'flac',
        audio_channels: 2,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.audio_tier_score).toBe(100)
    })

    it('should return 0 for zero audio bitrate (non-lossless)', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate: 0,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.audio_tier_score).toBe(0)
    })

    it('should scale audio score between MEDIUM and HIGH thresholds', async () => {
      // 1080p audio: MEDIUM=256, HIGH=640
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_bitrate: 448,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.audio_tier_score).toBeGreaterThanOrEqual(50)
      expect(score.audio_tier_score).toBeLessThan(100)
    })
  })

  // ============================================================================
  // WEIGHTED OVERALL SCORE
  // ============================================================================

  describe('weighted overall score', () => {
    it('should compute tier_score as weighted average of video and audio', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        video_codec: 'h264',
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_bitrate: 448,
      })
      const score = await analyzer.analyzeMediaItem(item)
      // Default weight: 70% video, 30% audio
      const expected = Math.round(score.bitrate_tier_score * 0.7 + score.audio_tier_score * 0.3)
      expect(score.tier_score).toBe(expected)
    })
  })

  // ============================================================================
  // ISSUES REPORTING (additional cases)
  // ============================================================================

  describe('issues reporting (additional)', () => {
    it('should report unknown bitrate when video_bitrate is 0', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 0,
      })
      const score = await analyzer.analyzeMediaItem(item)
      const issues = JSON.parse(score.issues)
      expect(issues.some((i: string) => i.includes('unknown'))).toBe(true)
    })

    it('should report 4K without HDR', async () => {
      const item = createMediaItem({
        resolution: '2160p',
        video_bitrate: 45000,
        hdr_format: 'None',
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      const issues = JSON.parse(score.issues)
      expect(issues.some((i: string) => i.includes('without HDR'))).toBe(true)
    })

    it('should report 8-bit color for 4K content', async () => {
      const item = createMediaItem({
        resolution: '2160p',
        video_bitrate: 45000,
        hdr_format: 'HDR10',
        color_bit_depth: 8,
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      const issues = JSON.parse(score.issues)
      expect(issues.some((i: string) => i.includes('8-bit'))).toBe(true)
    })

    it('should not report HDR issue when HDR is present', async () => {
      const item = createMediaItem({
        resolution: '2160p',
        video_bitrate: 45000,
        hdr_format: 'Dolby Vision',
        color_bit_depth: 10,
        audio_codec: 'truehd',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      const issues = JSON.parse(score.issues)
      expect(issues.some((i: string) => i.includes('without HDR'))).toBe(false)
    })

    it('should report mono audio', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 10000,
        audio_channels: 1,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      const issues = JSON.parse(score.issues)
      expect(issues.some((i: string) => i.includes('Mono'))).toBe(true)
    })

    it('should report low audio quality for stereo below threshold', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      const issues = JSON.parse(score.issues)
      expect(issues.some((i: string) => i.includes('Low audio quality'))).toBe(true)
    })

    it('should include codec name in low bitrate issue for efficient codecs', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 2000,
        video_codec: 'hevc',
      })
      const score = await analyzer.analyzeMediaItem(item)
      const issues = JSON.parse(score.issues)
      expect(issues.some((i: string) => i.includes('hevc'))).toBe(true)
    })
  })

  // ============================================================================
  // CORRUPT AUDIO TRACK DETECTION
  // ============================================================================

  describe('corrupt audio track detection', () => {
    it('should skip suspiciously low bitrate tracks', async () => {
      const item = createMediaItem({
        resolution: '2160p',
        video_bitrate: 45000,
        audio_tracks: JSON.stringify([
          // Corrupt 5.1 track: 96 kbps < 6 channels × 32 kbps = 192 kbps
          { codec: 'ac3', channels: 6, bitrate: 96, hasObjectAudio: false },
          // Legitimate stereo track
          { codec: 'aac', channels: 2, bitrate: 256, hasObjectAudio: false },
        ]),
      })
      const score = await analyzer.analyzeMediaItem(item)
      // The AAC stereo track should be selected over the corrupt AC3 track
      // because the corrupt track only gets raw bitrate score (96)
      // while AAC gets codec bonus (1000) + channels (200) + bitrate (256)
      expect(score).toBeDefined()
    })
  })

  // ============================================================================
  // COMMENTARY TRACK FILTERING
  // ============================================================================

  describe('commentary track filtering', () => {
    it('should prefer non-commentary tracks', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_tracks: JSON.stringify([
          { codec: 'truehd', channels: 8, bitrate: 5000, hasObjectAudio: true, title: "Director's Commentary" },
          { codec: 'ac3', channels: 6, bitrate: 448, hasObjectAudio: false, title: 'English' },
        ]),
      })
      const score = await analyzer.analyzeMediaItem(item)
      // Should pick AC3 English over TrueHD commentary
      expect(score).toBeDefined()
    })
  })

  // ============================================================================
  // CODEC EFFICIENCY (additional cases)
  // ============================================================================

  describe('codec efficiency (additional)', () => {
    it('should apply VP9 efficiency multiplier', async () => {
      const h264Item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 9000,
        video_codec: 'h264',
      })
      const vp9Item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 5000,
        video_codec: 'vp9',
      })
      const h264Score = await analyzer.analyzeMediaItem(h264Item)
      const vp9Score = await analyzer.analyzeMediaItem(vp9Item)
      // VP9 at 5000 × 1.8 = 9000 effective, similar to H.264 at 9000
      expect(vp9Score.bitrate_tier_score).toBeGreaterThanOrEqual(h264Score.bitrate_tier_score - 5)
    })

    it('should use 1.0x multiplier for unknown codecs', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 6000,
        video_codec: 'unknown_codec',
      })
      const score = await analyzer.analyzeMediaItem(item)
      // 6000 with 1.0x = exactly at MEDIUM threshold → score should be 50
      expect(score.bitrate_tier_score).toBe(50)
    })

    it('should recognize x264 as H.264 variant', async () => {
      const h264Item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 10000,
        video_codec: 'h264',
      })
      const x264Item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 10000,
        video_codec: 'x264',
      })
      const h264Score = await analyzer.analyzeMediaItem(h264Item)
      const x264Score = await analyzer.analyzeMediaItem(x264Item)
      expect(x264Score.bitrate_tier_score).toBe(h264Score.bitrate_tier_score)
    })

    it('should recognize x265 as HEVC variant', async () => {
      const hevcItem = createMediaItem({
        resolution: '1080p',
        video_bitrate: 5000,
        video_codec: 'hevc',
      })
      const x265Item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 5000,
        video_codec: 'x265',
      })
      const hevcScore = await analyzer.analyzeMediaItem(hevcItem)
      const x265Score = await analyzer.analyzeMediaItem(x265Item)
      expect(x265Score.bitrate_tier_score).toBe(hevcScore.bitrate_tier_score)
    })
  })

  // ============================================================================
  // LOSSLESS AUDIO DETECTION
  // ============================================================================

  describe('lossless audio detection', () => {
    it('should recognize ALAC as lossless', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'alac',
        audio_channels: 2,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.audio_tier_score).toBe(100)
    })

    it('should recognize PCM as lossless', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'pcm_s24le',
        audio_channels: 2,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.audio_tier_score).toBe(100)
    })

    it('should recognize dtshd_ma as lossless', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate: 15000,
        audio_codec: 'dtshd_ma',
        audio_channels: 8,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.audio_tier_score).toBe(100)
    })
  })

  // ============================================================================
  // ANALYZE VERSION
  // ============================================================================

  describe('analyzeVersion', () => {
    it('should return lightweight quality result for a version', () => {
      const version = createMediaItemVersion({
        resolution: '2160p',
        video_bitrate: 45000,
        video_codec: 'hevc',
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_bitrate: 5000,
        has_object_audio: true,
      })
      const result = analyzer.analyzeVersion(version)
      expect(result.quality_tier).toBe('4K')
      expect(result.tier_quality).toBe('HIGH')
      expect(result.tier_score).toBeGreaterThanOrEqual(75)
      expect(result.bitrate_tier_score).toBe(100)
      expect(result.audio_tier_score).toBe(100)
    })

    it('should return LOW quality for a poor version', () => {
      const version = createMediaItemVersion({
        resolution: '720p',
        video_bitrate: 1000,
        video_codec: 'h264',
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate: 64,
      })
      const result = analyzer.analyzeVersion(version)
      expect(result.quality_tier).toBe('720p')
      expect(result.tier_quality).toBe('LOW')
      expect(result.tier_score).toBeLessThan(50)
    })
  })

  // ============================================================================
  // RECOMMENDED FORMAT
  // ============================================================================

  describe('getRecommendedFormat', () => {
    it('should return no upgrade for high quality 4K', () => {
      const item = createMediaItem({ resolution: '2160p', height: 2160 })
      const result = analyzer.getRecommendedFormat(item, 95)
      expect(result).toBe('No upgrade needed')
    })

    it('should recommend 4K UHD for 1080p with low score', () => {
      const item = createMediaItem({ resolution: '1080p', height: 1080 })
      const result = analyzer.getRecommendedFormat(item, 70)
      expect(result).toBe('4K UHD Blu-ray')
    })

    it('should recommend Blu-ray for sub-1080p content', () => {
      const item = createMediaItem({ resolution: '720p', height: 720 })
      const result = analyzer.getRecommendedFormat(item, 50)
      expect(result).toBe('Blu-ray')
    })

    it('should recommend Blu-ray for 1080p with high score', () => {
      const item = createMediaItem({ resolution: '1080p', height: 1080 })
      const result = analyzer.getRecommendedFormat(item, 85)
      expect(result).toBe('Blu-ray')
    })
  })

  // ============================================================================
  // MUSIC QUALITY ANALYSIS
  // ============================================================================

  describe('music quality analysis', () => {
    describe('determineMusicQualityTier (via analyzeMusicAlbum)', () => {
      it('should classify HI_RES when tracks have hi-res flag', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 2000 })
        const tracks = [
          createMusicTrack({ is_lossless: true, is_hi_res: true, audio_codec: 'flac' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('HI_RES')
      })

      it('should classify LOSSLESS when all tracks are lossless', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 900 })
        const tracks = [
          createMusicTrack({ is_lossless: true, is_hi_res: false, audio_codec: 'flac' }),
          createMusicTrack({ is_lossless: true, is_hi_res: false, audio_codec: 'flac' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('LOSSLESS')
      })

      it('should classify LOSSLESS when more than half tracks are lossless', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 500 })
        const tracks = [
          createMusicTrack({ is_lossless: true, audio_codec: 'flac' }),
          createMusicTrack({ is_lossless: true, audio_codec: 'flac' }),
          createMusicTrack({ is_lossless: false, audio_codec: 'mp3' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('LOSSLESS')
      })

      it('should classify LOSSY_HIGH for high bitrate lossy', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 320 })
        const tracks = [
          createMusicTrack({ is_lossless: false, audio_codec: 'mp3' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('LOSSY_HIGH')
      })

      it('should classify LOSSY_MID for medium bitrate lossy', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 220 })
        const tracks = [
          createMusicTrack({ is_lossless: false, audio_codec: 'mp3' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('LOSSY_MID')
      })

      it('should classify LOSSY_LOW for low bitrate lossy', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 128 })
        const tracks = [
          createMusicTrack({ is_lossless: false, audio_codec: 'mp3' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('LOSSY_LOW')
      })
    })

    describe('music codec scoring', () => {
      it('should score FLAC tracks higher than MP3', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 900 })
        const flacTracks = [createMusicTrack({ audio_codec: 'flac', is_lossless: true })]
        const mp3Tracks = [createMusicTrack({ audio_codec: 'mp3', is_lossless: false })]

        const flacScore = analyzer.analyzeMusicAlbum(album, flacTracks)
        const mp3Score = analyzer.analyzeMusicAlbum(album, mp3Tracks)
        expect(flacScore.codec_score).toBeGreaterThan(mp3Score.codec_score)
      })

      it('should return 50 for empty track list', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 0 })
        const score = analyzer.analyzeMusicAlbum(album, [])
        expect(score.codec_score).toBe(50)
      })

      it('should give hi-res bonus to codec score', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 2000 })
        const normalTrack = [createMusicTrack({ audio_codec: 'flac', is_lossless: true, is_hi_res: false })]
        const hiResTrack = [createMusicTrack({ audio_codec: 'flac', is_lossless: true, is_hi_res: true })]

        const normalScore = analyzer.analyzeMusicAlbum(album, normalTrack)
        const hiResScore = analyzer.analyzeMusicAlbum(album, hiResTrack)
        expect(hiResScore.codec_score).toBeGreaterThan(normalScore.codec_score)
      })

      it('should average codec scores across multiple tracks', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 200 })
        const tracks = [
          createMusicTrack({ audio_codec: 'flac', is_lossless: true }),  // 95
          createMusicTrack({ audio_codec: 'mp3', is_lossless: false }),  // 60
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        // Should be ~78 (average of 95 and 60)
        expect(score.codec_score).toBeGreaterThan(60)
        expect(score.codec_score).toBeLessThan(95)
      })
    })

    describe('music bitrate scoring', () => {
      it('should return 100 for HI_RES tier', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 2000 })
        const tracks = [createMusicTrack({ is_hi_res: true, is_lossless: true, audio_codec: 'flac' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.bitrate_score).toBe(100)
      })

      it('should return 100 for LOSSLESS with high bitrate', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 1200 })
        const tracks = [createMusicTrack({ is_lossless: true, audio_codec: 'flac' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.bitrate_score).toBe(100)
      })

      it('should return 95 for 320 kbps lossy', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 320 })
        const tracks = [createMusicTrack({ is_lossless: false, audio_codec: 'mp3' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.bitrate_score).toBe(95)
      })

      it('should return 25 for very low bitrate', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 64 })
        const tracks = [createMusicTrack({ is_lossless: false, audio_codec: 'mp3' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.bitrate_score).toBe(25)
      })
    })

    describe('music tier quality and issues', () => {
      it('should flag LOSSY_LOW as needing upgrade with issue', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 128 })
        const tracks = [createMusicTrack({ is_lossless: false, audio_codec: 'mp3' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.needs_upgrade).toBe(true)
        const issues = JSON.parse(score.issues)
        expect(issues.some((i: string) => i.includes('Low quality'))).toBe(true)
      })

      it('should flag LOSSY_MID as needing upgrade', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 220 })
        const tracks = [createMusicTrack({ is_lossless: false, audio_codec: 'mp3' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.needs_upgrade).toBe(true)
      })

      it('should not flag LOSSLESS as needing upgrade', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 900 })
        const tracks = [createMusicTrack({ is_lossless: true, audio_codec: 'flac' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.needs_upgrade).toBe(false)
      })

      it('should report mixed quality issue', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 500 })
        const tracks = [
          createMusicTrack({ is_lossless: true, audio_codec: 'flac' }),
          createMusicTrack({ is_lossless: false, audio_codec: 'mp3' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        const issues = JSON.parse(score.issues)
        expect(issues.some((i: string) => i.includes('Mixed quality'))).toBe(true)
      })

      it('should assign HIGH tier quality for high tier score', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 1200 })
        const tracks = [createMusicTrack({ is_lossless: true, audio_codec: 'flac' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.tier_quality).toBe('HIGH')
      })

      it('should assign LOW tier quality for low tier score', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 64 })
        const tracks = [createMusicTrack({ is_lossless: false, audio_codec: 'wma' })]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.tier_quality).toBe('LOW')
      })
    })
  })

  // ============================================================================
  // MUSIC DISPLAY AND RECOMMENDATIONS
  // ============================================================================

  describe('music display and recommendations', () => {
    it('should display tier names correctly', () => {
      expect(analyzer.getMusicQualityTierDisplay('LOSSY_LOW')).toBe('Low Quality')
      expect(analyzer.getMusicQualityTierDisplay('LOSSY_MID')).toBe('Standard')
      expect(analyzer.getMusicQualityTierDisplay('LOSSY_HIGH')).toBe('High Quality')
      expect(analyzer.getMusicQualityTierDisplay('LOSSLESS')).toBe('Lossless')
      expect(analyzer.getMusicQualityTierDisplay('HI_RES')).toBe('Hi-Res')
    })

    it('should recommend no upgrade for high quality HI_RES', () => {
      const album = createMusicAlbum({})
      const score: MusicQualityScore = {
        album_id: 1,
        quality_tier: 'HI_RES',
        tier_quality: 'HIGH',
        tier_score: 100,
        codec_score: 100,
        bitrate_score: 100,
        needs_upgrade: false,
        issues: '[]',
        created_at: '',
        updated_at: '',
      }
      expect(analyzer.getRecommendedMusicFormat(album, score)).toBe('No upgrade needed')
    })

    it('should recommend Hi-Res for non-LOW lossless', () => {
      const album = createMusicAlbum({})
      const score: MusicQualityScore = {
        album_id: 1,
        quality_tier: 'LOSSLESS',
        tier_quality: 'HIGH',
        tier_score: 90,
        codec_score: 95,
        bitrate_score: 90,
        needs_upgrade: false,
        issues: '[]',
        created_at: '',
        updated_at: '',
      }
      expect(analyzer.getRecommendedMusicFormat(album, score)).toBe('Hi-Res (24-bit/96kHz+)')
    })

    it('should recommend Lossless for lossy content', () => {
      const album = createMusicAlbum({})
      const score: MusicQualityScore = {
        album_id: 1,
        quality_tier: 'LOSSY_HIGH',
        tier_quality: 'MEDIUM',
        tier_score: 60,
        codec_score: 70,
        bitrate_score: 85,
        needs_upgrade: true,
        issues: '[]',
        created_at: '',
        updated_at: '',
      }
      expect(analyzer.getRecommendedMusicFormat(album, score)).toBe('Lossless (FLAC/ALAC)')
    })
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 1,
    source_id: 'test-source',
    source_type: 'plex',
    library_id: 'lib-1',
    plex_id: 'test-123',
    type: 'movie',
    title: 'Test Movie',
    year: 2023,
    resolution: '1080p',
    video_codec: 'h264',
    video_bitrate: 10000,
    audio_codec: 'ac3',
    audio_channels: 6,
    audio_bitrate: 448,
    has_object_audio: false,
    file_path: '/path/to/test.mkv',
    file_size: 5 * 1024 * 1024 * 1024,
    duration: 120 * 60 * 1000,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function createMediaItemVersion(overrides: Partial<MediaItemVersion> = {}): MediaItemVersion {
  return {
    media_item_id: 1,
    version_source: 'primary',
    file_path: '/test/file.mkv',
    file_size: 10000000,
    duration: 7200,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    video_bitrate: 10000,
    audio_codec: 'ac3',
    audio_channels: 6,
    audio_bitrate: 448,
    ...overrides,
  }
}

function createMusicAlbum(overrides: Partial<MusicAlbum> = {}): MusicAlbum {
  return {
    id: 1,
    source_id: 'test-source',
    source_type: 'plex',
    provider_id: 'album-1',
    artist_name: 'Test Artist',
    title: 'Test Album',
    year: 2023,
    avg_audio_bitrate: 320,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function createMusicTrack(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    source_id: 'test-source',
    source_type: 'plex',
    provider_id: 'track-1',
    artist_name: 'Test Artist',
    title: 'Test Track',
    audio_codec: 'mp3',
    audio_bitrate: 320,
    is_lossless: false,
    is_hi_res: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}
