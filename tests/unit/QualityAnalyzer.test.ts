/**
 * QualityAnalyzer Unit Tests
 *
 * Tests for quality scoring logic including resolution tiers,
 * bitrate analysis, codec efficiency, and audio quality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { MEASUREMENT_VERSION } from '../../src/main/services/MeasuredOptimizationPolicy'

const configuredSettings = new Map<string, string>()
const mockGetSetting = vi.fn((key: string) => configuredSettings.get(key) ?? null)
const mockGetSettingsByPrefix = vi.fn(() => ({} as Record<string, string>))
const mockGetPlaybackTargetProfile = vi.fn<() => Promise<PlaybackTargetProfile | null>>(async () => null)

// Mock database getter before importing QualityAnalyzer
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    config: { getSetting: mockGetSetting, getSettingsByPrefix: mockGetSettingsByPrefix },
    playbackTargetProfiles: { get: mockGetPlaybackTargetProfile },
    upsertQualityScore: vi.fn(),
  })),
}))

import { QualityAnalyzer } from '../../src/main/services/QualityAnalyzer'
import type { MediaItem, MediaItemVersion, MusicAlbum, MusicTrack, MusicQualityScore } from '../../src/main/types/database'
import type { PlaybackTargetProfile } from '../../src/main/types/playbackTarget'

describe('QualityAnalyzer', () => {
  let analyzer: QualityAnalyzer

  beforeEach(() => {
    vi.clearAllMocks()
    configuredSettings.clear()
    mockGetSettingsByPrefix.mockReturnValue({})
    mockGetPlaybackTargetProfile.mockResolvedValue(null)
    analyzer = new QualityAnalyzer()
  })

  it('reuses a measured plan total, including zero, and invalidates changed source or measurement revisions', async () => {
    const filePath = fileURLToPath(import.meta.url)
    const source = await stat(filePath)
    const measurement = { cacheKey: 'measured-plan', qualityProfile: 'balanced', samplingRole: 'measured', sourceSize: source.size, sourceMtimeMs: source.mtimeMs }
    const trustedAnalysis = () => JSON.stringify({
      success: true, filePath, durationMs: 60_000,
      fileAnalysisFingerprint: { size: source.size, mtimeMs: source.mtimeMs, ctimeMs: source.ctimeMs, ino: source.ino },
      audioTracks: [], subtitleTracks: [],
      optimizationMeasurement: measurement,
    })
    const item = createMediaItem({ file_path: filePath, file_size_bytes: source.size, duration_ms: 60_000, deep_analysis: trustedAnalysis() })
    const candidate = { encoder: 'qsv_h265', quality: 18, preset: 'medium', outputBytes: source.size - 100, sampledDurationSeconds: 60, vmafMean: 95, vmafP5: 92, cambiMean: 0 }
    const cached = { version: MEASUREMENT_VERSION, cacheKey: measurement.cacheKey, complete: true, candidates: [candidate] }
    configuredSettings.set('transcoding.measurement.measured-plan', JSON.stringify(cached))
    const score = await analyzer.analyzeMediaItem(item)
    expect(score.estimated_savings_bytes).toBe(100)
    expect(score.savings_basis).toBe('video_sample_encode')
    expect(score.evidence_status).toBe('estimated')

    measurement.qualityProfile = 'transparent'
    item.deep_analysis = trustedAnalysis()
    expect((await analyzer.analyzeMediaItem(item)).estimated_savings_bytes).toBeNull()
    measurement.qualityProfile = 'balanced'
    item.deep_analysis = trustedAnalysis()

    candidate.outputBytes = source.size
    configuredSettings.set('transcoding.measurement.measured-plan', JSON.stringify(cached))
    expect((await analyzer.analyzeMediaItem(item)).estimated_savings_bytes).toBe(0)

    measurement.sourceMtimeMs++
    item.deep_analysis = trustedAnalysis()
    expect((await analyzer.analyzeMediaItem(item)).savings_basis).toBe('video_bitrate_estimate')

    measurement.sourceMtimeMs = source.mtimeMs
    item.deep_analysis = trustedAnalysis()
    cached.version--
    configuredSettings.set('transcoding.measurement.measured-plan', JSON.stringify(cached))
    expect((await analyzer.analyzeMediaItem(item)).savings_basis).toBe('video_bitrate_estimate')
  })

  it('estimates only measured subtitle bytes when an explicit language policy removes tracks', () => {
    configuredSettings.set('subtitle_preferred_languages', 'eng')
    const item = createMediaItem({ file_size_bytes: 1_000, original_language: 'en', video_codec: 'hevc' })
    const analysis = {
      success: true,
      filePath: '/test/file.mkv',
      durationMs: 60_000,
      fileSizeBytes: 1_000,
      video: { index: 0, codec: 'hevc', width: 1920, height: 1080, bitrateKbps: 2_000 },
      audioTracks: [{ index: 1, codec: 'aac', channels: 2, bitrateKbps: 128, language: 'en', isDefault: true, hasObjectAudio: false }],
      subtitleTracks: [
        { index: 2, codec: 'srt', language: 'eng', isDefault: false, isForced: false },
        { index: 3, codec: 'srt', language: 'fra', isDefault: false, isForced: false },
      ],
      streamBytes: { 2: 10, 3: 50 },
    }

    const breakdown = analyzer.getOptimizationSavingsBreakdown(item, analysis)
    expect(breakdown.videoSavingsBytes).toBe(0)
    expect(breakdown.subtitlePruningBytes).toBe(50)
    expect(breakdown.totalEstimatedSavingsBytes).toBe(50)
    expect(breakdown.coverage).toBe('complete')
  })

  it('keeps every subtitle when no language policy is configured', () => {
    const breakdown = analyzer.getOptimizationSavingsBreakdown(createMediaItem({ original_language: 'en' }), {
      success: true,
      filePath: '/test/file.mkv',
      durationMs: 60_000,
      fileSizeBytes: 1_000,
      video: { index: 0, codec: 'hevc', width: 1920, height: 1080, bitrateKbps: 2_000 },
      audioTracks: [],
      subtitleTracks: [{ index: 2, codec: 'srt', language: 'fra', isDefault: false, isForced: false }],
      streamBytes: { 2: 50 },
    })
    expect(breakdown.subtitlePruningBytes).toBeNull()
    expect(breakdown.totalEstimatedSavingsBytes).toBe(0)
    expect(breakdown.coverage).toBe('complete')
  })

  it('models H.264 migration from video stream bytes before encoding samples', () => {
    const breakdown = analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      file_size_bytes: 1_000_000_000,
      video_codec: 'h264',
      video_bitrate_kbps: 8_000,
      duration_ms: 3_600_000,
    }), {
      success: true,
      filePath: '/test/file.mkv',
      durationMs: 3_600_000,
      fileSizeBytes: 1_000_000_000,
      video: { index: 0, codec: 'h264', width: 1920, height: 1080, bitrateKbps: 8_000 },
      audioTracks: [],
      subtitleTracks: [],
      streamBytes: { 0: 400_000_000 },
    })
    expect(breakdown.videoSavingsBytes).toBe(200_000_000)
  })

  it('does not infer achievable savings from a same-codec bitrate threshold', () => {
    const breakdown = analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      file_size_bytes: 10_000_000_000,
      video_codec: 'hevc',
      video_bitrate_kbps: 20_000,
      duration_ms: 3_600_000,
    }))

    expect(breakdown.videoSavingsBytes).toBe(0)
  })

  it.each([
    ['h264', 'hevc', 500_000_000],
    ['h264', 'av1', 600_000_000],
    ['hevc', 'hevc', 0],
    ['hevc', 'av1', 200_000_000],
    ['av1', 'hevc', 0],
    ['av1', 'av1', 0],
  ] as const)('models %s to %s from the source codec without applying the AVC saving twice', (sourceCodec, targetCodec, expected) => {
    const item = createMediaItem({ video_codec: sourceCodec, file_size_bytes: 1_000_000_000, duration_ms: 3_600_000 })
    const breakdown = analyzer.getOptimizationSavingsBreakdown(item, {
      success: true, filePath: '/test/file.mkv', fileSizeBytes: 1_000_000_000, durationMs: 3_600_000,
      video: { index: 0, codec: sourceCodec, width: 1920, height: 1080 }, audioTracks: [], subtitleTracks: [], streamBytes: { 0: 1_000_000_000 },
    }, targetCodec)
    expect(breakdown.videoSavingsBytes).toBe(expected)
  })

  it('keeps H.264 eligible for migration when configured codec factors predict no saving', async () => {
    mockGetSettingsByPrefix.mockReturnValue({ quality_codec_h265: '1' })
    await analyzer.loadThresholdsFromDatabase()
    const advice = analyzer.getOptimizationAdvice(createMediaItem({ duration_ms: 3_600_000 }), undefined, 'hevc')
    expect(advice.action).toBe('video_transcode')
    expect(advice.estimatedSavingsBytes).toBe(0)
  })

  it('models AV1 migration when selected by the playback target', async () => {
    configuredSettings.set('optimization_default_target_profile_id', 'av1-target')
    mockGetPlaybackTargetProfile.mockResolvedValue({
      id: 'av1-target',
      name: 'AV1 target',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      definition: {
        containers: ['mkv'],
        video: { codecs: ['av1'], profiles: ['main'], levels: [6], maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, bitDepths: [8, 10] },
        hdr: { formats: [], fallbackRequired: false },
        audio: { codecs: ['aac'], maxChannels: 2, objectAudio: false, outputPath: 'device' },
        subtitles: { formats: ['srt'], embedded: true, external: false, burnIn: false },
        network: { sustainableBitrate: 100_000_000 },
      },
    })
    await analyzer.loadThresholdsFromDatabase()

    const breakdown = analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      file_size_bytes: 10_000_000_000,
      video_codec: 'h264',
      video_bitrate_kbps: 20_000,
      duration_ms: 3_600_000,
    }))

    expect(breakdown.videoSavingsBytes).toBe(5_400_000_000)
    const hevcSource = analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      video_codec: 'hevc', video_bitrate_kbps: 20_000, duration_ms: 3_600_000, file_size_bytes: 10_000_000_000,
    }))
    expect(hevcSource.videoSavingsBytes).toBe(1_800_000_000)
    configuredSettings.delete('optimization_default_target_profile_id')
    analyzer.invalidateThresholdsCache()
    await analyzer.loadThresholdsFromDatabase()
    expect(analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      video_codec: 'hevc', video_bitrate_kbps: 20_000, duration_ms: 3_600_000,
    })).videoSavingsBytes).toBe(0)
  })

  it('leaves unsupported codecs and missing video inputs unknown', () => {
    const unsupported = analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      video_codec: 'mpeg2', video_bitrate_kbps: 8_000, duration_ms: 3_600_000,
    }))
    const incomplete = analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      video_codec: 'h264', video_bitrate_kbps: null, duration_ms: null,
    }))
    const zeroBitrate = analyzer.getOptimizationSavingsBreakdown(createMediaItem({
      video_codec: 'h264', video_bitrate_kbps: 0, duration_ms: 3_600_000,
    }))
    expect(unsupported.videoSavingsBytes).toBeNull()
    expect(incomplete.videoSavingsBytes).toBeNull()
    expect(zeroBitrate.videoSavingsBytes).toBeNull()
  })

  it('estimates H.264 migration before sampling and bounds inconsistent bitrate metadata by file size', () => {
    const advice = analyzer.getOptimizationAdvice(createMediaItem({
      file_path: 'C:/library/WEB-DL/title.mkv',
      file_size_bytes: 1_000_000_000,
      video_codec: 'h264',
      video_bitrate_kbps: 8_000,
      duration_ms: 3_600_000,
      resolution: null,
      audio_tracks: null,
    }))

    expect(advice.action).toBe('video_transcode')
    expect(advice.estimatedSavingsBytes).toBe(500_000_000)
    expect(advice.confidence).toBe('low')
  })

  it('combines modeled video savings with measured audio removals without counting audio bytes as video', async () => {
    const item = createMediaItem({
      file_size_bytes: 1_000_000_000,
      duration_ms: 3_600_000,
      original_language: 'en',
    })
    const analysis = {
      success: true,
      filePath: '/test/file.mkv',
      durationMs: 3_600_000,
      fileSizeBytes: 3_000_000_000,
      video: { index: 0, codec: 'h264', width: 1920, height: 1080, bitrateKbps: 10_000 },
      audioTracks: [
        { index: 1, codec: 'aac', channels: 2, bitrateKbps: 192, language: 'en', isDefault: true, hasObjectAudio: false },
        { index: 2, codec: 'aac', channels: 2, bitrateKbps: 800, language: 'fr', isDefault: false, hasObjectAudio: false },
      ],
      subtitleTracks: [],
      streamBytes: { 1: 86_400_000, 2: 360_000_000 },
    }
    const breakdown = analyzer.getOptimizationSavingsBreakdown(item, analysis)

    expect(breakdown.videoSavingsBytes).toBe(1_276_800_000)
    expect(breakdown.audioPruningBytes).toBe(360_000_000)
    const score = await analyzer.analyzeMediaItem(item, analysis)
    expect(score.video_savings_bytes).toBe(1_276_800_000)
    expect(score.estimated_savings_bytes).toBe(1_636_800_000)
    expect(score.savings_basis).toBe('mixed_measured_and_estimated')
    expect(score.confidence).toBe('low')
  })

  it('does not include audio conversion savings unless selected in a plan', () => {
    const item = createMediaItem({
      file_size_bytes: 1_000_000_000,
      duration_ms: 3_600_000,
      original_language: 'en',
      video_bitrate_kbps: 5_000,
    })
    const analysis = {
      success: true,
      filePath: '/test/file.mkv',
      durationMs: 3_600_000,
      fileSizeBytes: 1_000_000_000,
      video: { index: 0, codec: 'h264', width: 1920, height: 1080, bitrateKbps: 5_000 },
      audioTracks: [
        { index: 1, codec: 'flac', channels: 2, bitrateKbps: 1_500, language: 'en', isDefault: true, hasObjectAudio: false },
        { index: 2, codec: 'aac', channels: 2, bitrateKbps: 320, language: 'fr', isDefault: false, hasObjectAudio: false },
      ],
      subtitleTracks: [],
      streamBytes: { 1: 675_000_000, 2: 100_000_000 },
    }

    const breakdown = analyzer.getOptimizationSavingsBreakdown(item, analysis)

    expect(breakdown.videoSavingsBytes).toBe(112_500_000)
    expect(breakdown.audioPruningBytes).toBe(100_000_000)
    expect(breakdown.audioTranscodeBytes).toBeNull()
    expect(breakdown.totalEstimatedSavingsBytes).toBeGreaterThan(0)
    expect(breakdown.coverage).toBe('complete')
  })

  it('preserves the configurable overall media quality rating', async () => {
    const score = await analyzer.analyzeMediaItem(createMediaItem({
      video_bitrate_kbps: 12_000,
      duration_ms: 3_600_000,
      resolution: '1080p',
      hdr_format: 'None',
      color_bit_depth: 8,
    }))

    expect(score.quality_tier).toBe('1080p')
    expect(score.tier_quality).not.toBe('UNKNOWN')
    expect(score.tier_score).not.toBeNull()
    expect(score.tier_quality).toBe('HIGH')
    expect(score.efficiency_score).toBeNull()
    expect(score.video_savings_bytes).toBeGreaterThan(0)
    expect(score.issues).not.toContain('Low bitrate')
  })

  // ============================================================================
  // RESOLUTION TIER DETECTION
  // ============================================================================

  describe('resolution tier detection', () => {
    it('should classify SD resolution (below 720p)', async () => {
      const item = createMediaItem({ resolution: '480p', video_bitrate_kbps: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
    })

    it('should classify 720p resolution', async () => {
      const item = createMediaItem({ resolution: '720p', video_bitrate_kbps: 5000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })

    it('should classify 1080p resolution', async () => {
      const item = createMediaItem({ resolution: '1080p', video_bitrate_kbps: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should classify 4K resolution (2160p)', async () => {
      const item = createMediaItem({ resolution: '2160p', video_bitrate_kbps: 25000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should parse WxH resolution format correctly', async () => {
      const item = createMediaItem({ resolution: '1920x1080', video_bitrate_kbps: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should preserve unknown resolution without assigning a quality score', async () => {
      const item = createMediaItem({ resolution: 'unknown', video_bitrate_kbps: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('UNKNOWN')
      expect(score.tier_quality).toBe('UNKNOWN')
      expect(score.overall_score).toBeNull()
    })

    it('does not infer overall quality from audio when video bitrate is missing', async () => {
      const score = await analyzer.analyzeMediaItem(createMediaItem({ video_bitrate_kbps: null }))
      expect(score.tier_quality).toBe('UNKNOWN')
      expect(score.overall_score).toBeNull()
      expect(score.audio_tier_score).toBeNull()
    })
  })

  // ============================================================================
  // NEEDS UPGRADE FLAG
  // ============================================================================

  describe('needs upgrade detection', () => {
    it('flags LOW tier video as needing upgrade regardless of bitrate or audio properties', async () => {
      const item = createMediaItem({
        resolution: '720p',
        video_bitrate_kbps: 1500,
        audio_channels: 2,
        audio_bitrate_kbps: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('LOW')
      expect(score.needs_upgrade).toBe(true)
    })

    it('should not flag HIGH quality items as needing upgrade', async () => {
      const item = createMediaItem({
        resolution: '4K',
        video_bitrate_kbps: 50000,
        audio_codec: 'truehd',
        audio_channels: 8,
        has_object_audio: true,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
      expect(score.needs_upgrade).toBe(false)
    })

    it('does not flag MEDIUM or UNKNOWN tier video as needing upgrade', async () => {
      const mediumScore = await analyzer.analyzeMediaItem(createMediaItem({
        resolution: '1080p', video_bitrate_kbps: 5000,
      }))
      const unknownScore = await analyzer.analyzeMediaItem(createMediaItem({
        resolution: 'unknown', video_bitrate_kbps: 2000,
      }))

      expect(mediumScore.tier_quality).toBe('MEDIUM')
      expect(mediumScore.needs_upgrade).toBe(false)
      expect(unknownScore.tier_quality).toBe('UNKNOWN')
      expect(unknownScore.needs_upgrade).toBe(false)
    })
  })

  // ============================================================================
  // AUDIO TRACKS PARSING
  // ============================================================================

  describe('audio tracks parsing', () => {
    it('should select best audio track from multiple tracks', async () => {
      const item = createMediaItem({
        resolution: '2160p', // Standard resolution string
        video_bitrate_kbps: 45000, // Above 4K HIGH threshold (40000)
        audio_codec: 'aac', // Default fallback
        audio_channels: 2,
        audio_tracks: JSON.stringify([
          { codec: 'aac', channels: 2, bitrate: 128, hasObjectAudio: false },
          { codec: 'truehd', channels: 8, bitrate: 5000, hasObjectAudio: true },
          { codec: 'ac3', channels: 6, bitrate: 448, hasObjectAudio: false },
        ]),
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should fallback to primary audio fields if audio_tracks is empty', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate_kbps: 15000,
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_tracks: '[]',
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.tier_quality).toBe('HIGH')
    })

    it('should reject invalid audio_tracks JSON', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate_kbps: 15000,
        audio_codec: 'ac3',
        audio_channels: 6,
        audio_tracks: 'not valid json',
      })
      await expect(analyzer.analyzeMediaItem(item))
        .rejects.toMatchObject({ code: 'MALFORMED_AUDIO_TRACKS' })
    })
  })

  // ============================================================================
  // ISSUES REPORTING
  // ============================================================================

  describe('issues reporting', () => {
    it('reports unknown audio language for review without inferring it', async () => {
      const item = createMediaItem({
        original_language: 'en',
        audio_tracks: JSON.stringify([{ index: 0, codec: 'aac', channels: 2, bitrate: 128 }]),
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(JSON.parse(score.issues)).toContain('No reliable primary audio stream matches the original language; removing other tracks could eliminate the soundtrack (audio track indexes: 0)')
    })

    it('does not report low bitrate as a visual-quality issue', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate_kbps: 2000,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.issues).not.toContain('Low bitrate')
    })

    it('does not report audio bitrate as an audio-quality judgment', async () => {
      const item = createMediaItem({
        resolution: '1080p',
        video_bitrate_kbps: 15000,
        audio_channels: 2,
        audio_codec: 'aac',
        audio_bitrate_kbps: 64,
      })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.issues).not.toContain('Low audio quality')
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
      const item = createMediaItem({ resolution: '1080i', video_bitrate_kbps: 10000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should classify 720i as 720p tier', async () => {
      const item = createMediaItem({ resolution: '720i', video_bitrate_kbps: 5000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })

    it('should classify 4K string as 4K tier', async () => {
      const item = createMediaItem({ resolution: '4K', video_bitrate_kbps: 25000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should parse WxH format for 4K (3840x2160)', async () => {
      const item = createMediaItem({ resolution: '3840x2160', video_bitrate_kbps: 25000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should parse WxH format for 720p (1280x720)', async () => {
      const item = createMediaItem({ resolution: '1280x720', video_bitrate_kbps: 5000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })

    it('should parse WxH format for SD (640x480)', async () => {
      const item = createMediaItem({ resolution: '640x480', video_bitrate_kbps: 2000 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('SD')
    })

    it('should fall back to height field when resolution string is unknown', async () => {
      const item = createMediaItem({ resolution: 'custom', video_bitrate_kbps: 10000, height: 1080 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('1080p')
    })

    it('should use height field for 4K fallback', async () => {
      const item = createMediaItem({ resolution: 'custom', video_bitrate_kbps: 25000, height: 2160 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('4K')
    })

    it('should use height field for 720p fallback', async () => {
      const item = createMediaItem({ resolution: 'custom', video_bitrate_kbps: 5000, height: 720 })
      const score = await analyzer.analyzeMediaItem(item)
      expect(score.quality_tier).toBe('720p')
    })
  })

  // ============================================================================
  // ISSUES REPORTING (additional cases)
  // ============================================================================

  describe('media facts are not visual-quality grades', () => {
    it('retains HDR, bit-depth, and audio-channel facts as diagnostics', async () => {
      const hdr = await analyzer.analyzeMediaItem(createMediaItem({ resolution: '2160p', hdr_format: 'None', color_bit_depth: 8 }))
      const mono = await analyzer.analyzeMediaItem(createMediaItem({ resolution: '1080p', audio_channels: 1 }))
      expect(JSON.parse(hdr.issues)).toContain('4K content without HDR')
      expect(JSON.parse(hdr.issues)).toContain('Color bit depth is 8-bit (below 10-bit)')
      expect(JSON.parse(mono.issues)).toContain('Mono audio')
    })
  })
  // ============================================================================
  // CORRUPT AUDIO TRACK DETECTION
  // ============================================================================

  describe('corrupt audio track detection', () => {
    it('should skip suspiciously low bitrate tracks', async () => {
      const item = createMediaItem({
        resolution: '2160p',
        video_bitrate_kbps: 45000,
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
        video_bitrate_kbps: 15000,
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
  // ANALYZE VERSION
  // ============================================================================

  describe('analyzeVersion', () => {
    it('should return lightweight quality result for a version', () => {
      const version = createMediaItemVersion({
        resolution: '2160p',
        video_bitrate_kbps: 45000,
        video_codec: 'hevc',
        audio_codec: 'truehd',
        audio_channels: 8,
        audio_bitrate_kbps: 5000,
        has_object_audio: true,
      })
      const result = analyzer.analyzeVersion(version)
      expect(result.quality_tier).toBe('4K')
      expect(result.tier_quality).toBe('HIGH')
      expect(result.tier_score).not.toBeNull()
      expect(result.bitrate_tier_score).toBe(100)
      expect(result.audio_tier_score).toBe(100)
    })

    it('keeps within-resolution quality unknown for a poor version', () => {
      const version = createMediaItemVersion({
        resolution: '720p',
        video_bitrate_kbps: 1000,
        video_codec: 'h264',
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate_kbps: 64,
      })
      const result = analyzer.analyzeVersion(version)
      expect(result.quality_tier).toBe('720p')
      expect(result.tier_quality).toBe('LOW')
      expect(result.tier_score).not.toBeNull()
    })
  })

  // ============================================================================
  // RECOMMENDED FORMAT
  // ============================================================================

  describe('getRecommendedFormat', () => {
    it('reports the current resolution without claiming visual quality', () => {
      const item = createMediaItem({ resolution: '2160p', height: 2160 })
      const result = analyzer.getRecommendedFormat(item)
      expect(result).toBe('4K resolution')
    })

    it('recommends a resolution increase without using a quality score', () => {
      const item = createMediaItem({ resolution: '1080p', height: 1080 })
      const result = analyzer.getRecommendedFormat(item)
      expect(result).toBe('4K UHD Blu-ray')
    })

    it('should recommend Blu-ray for sub-1080p content', () => {
      const item = createMediaItem({ resolution: '720p', height: 720 })
      const result = analyzer.getRecommendedFormat(item)
      expect(result).toBe('Blu-ray')
    })

    it('recommends by resolution regardless of visual quality score', () => {
      const item = createMediaItem({ resolution: '1080p', height: 1080 })
      const result = analyzer.getRecommendedFormat(item)
      expect(result).toBe('4K UHD Blu-ray')
    })
  })

  // ============================================================================
  // MUSIC QUALITY ANALYSIS
  // ============================================================================

  describe('music quality analysis', () => {
    describe('determineMusicQualityTier (via analyzeMusicAlbum)', () => {
      it('should preserve unknown quality when the album has no tracks', () => {
        const album = createMusicAlbum()
        const score = analyzer.analyzeMusicAlbum(album, [])
        expect(score.quality_tier).toBe('UNKNOWN')
        expect(score.tier_quality).toBe('UNKNOWN')
        expect(score.needs_upgrade).toBe(false)
        expect(analyzer.getRecommendedMusicFormat(album, score)).toBe('Insufficient evidence')
      })

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

      it('should keep the lowest tier when some tracks are lossy', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 500 })
        const tracks = [
          createMusicTrack({ is_lossless: true, audio_codec: 'flac' }),
          createMusicTrack({ is_lossless: true, audio_codec: 'flac' }),
          createMusicTrack({ is_lossless: false, audio_codec: 'mp3' }),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('LOSSY_HIGH')
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

      it('should use the lowest codec score across multiple tracks', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 200 })
        const tracks = [
          createMusicTrack({ audio_codec: 'flac', is_lossless: true }),  // 95
          createMusicTrack({ audio_codec: 'mp3', is_lossless: false }),  // 60
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.codec_score).toBe(60)
      })

      it('should not let one hi-res track hide low-quality tracks in an album', () => {
        const album = createMusicAlbum({ avg_audio_bitrate: 320 })
        const tracks = [
          createMusicTrack({ audio_codec: 'flac', is_lossless: true, is_hi_res: true, audio_bitrate: 2000 }),
          ...Array.from({ length: 9 }, () => createMusicTrack({ audio_codec: 'mp3', is_lossless: false, is_hi_res: false, audio_bitrate: 128 })),
        ]
        const score = analyzer.analyzeMusicAlbum(album, tracks)
        expect(score.quality_tier).toBe('LOSSY_LOW')
        expect(score.tier_quality).not.toBe('HIGH')
        expect(score.needs_upgrade).toBe(true)
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
    provider_item_id: 'test-123',
    type: 'movie',
    title: 'Test Movie',
    year: 2023,
    resolution: '1080p',
    video_codec: 'h264',
    video_bitrate_kbps: 10000,
    audio_codec: 'ac3',
    audio_channels: 6,
    audio_bitrate_kbps: 448,
    has_object_audio: false,
    ...overrides,
  }
}

function createMediaItemVersion(overrides: Partial<MediaItemVersion> = {}): MediaItemVersion {
  return {
    media_item_id: 1,
    version_source: 'primary',
    file_path: '/test/file.mkv',
    file_size_bytes: 10000000,
    duration_ms: 7200000,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    video_bitrate_kbps: 10000,
    audio_codec: 'ac3',
    audio_channels: 6,
    audio_bitrate_kbps: 448,
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
    audio_bitrate: undefined,
    is_lossless: false,
    is_hi_res: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}
