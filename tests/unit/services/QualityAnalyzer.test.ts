import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { QualityAnalyzer, OptimizationAdvice } from '@main/services/QualityAnalyzer'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import type { MediaItem } from '@main/types/database'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'

describe('QualityAnalyzer TRaSH Advisory', () => {
  let analyzer: QualityAnalyzer
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    analyzer = new QualityAnalyzer()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('does not turn container size into a video bitrate when stream bitrate is absent', () => {
    const item: MediaItem = {
      id: 8,
      source_id: 'src1',
      plex_id: 'p8',
      title: 'Measured container rate',
      type: 'movie',
      file_path: '/media/measured.mkv',
      file_size: 4 * 1024 * 1024 * 1024,
      duration: 50 * 60 * 1000,
      resolution: '1080p',
      video_codec: 'h264',
      video_bitrate: null,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 192,
    }

    const score = analyzer.analyzeVersion({
      ...item,
      media_item_id: 8,
      version_source: 'local_file',
      file_path: item.file_path!,
      file_size: item.file_size!,
      duration: item.duration!,
      resolution: item.resolution!,
      width: 1920,
      height: 1080,
      video_codec: item.video_codec!,
      video_bitrate: 0,
      audio_codec: item.audio_codec!,
      audio_channels: item.audio_channels!,
      audio_bitrate: item.audio_bitrate!,
    })

    expect(score.bitrate_tier_score).toBe(0)
  })

  it('does not estimate removable audio bytes without original-language evidence', () => {
    const item: MediaItem = {
      id: 9,
      source_id: 'src1',
      plex_id: 'p9',
      title: 'Untagged audio',
      type: 'episode',
      file_path: '/media/untagged.mkv',
      file_size: 2_000_000_000,
      duration: 50 * 60 * 1000,
      resolution: '1080p',
      video_codec: 'hevc',
      video_bitrate: 4000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 192,
      original_language: null,
      audio_tracks: JSON.stringify([{ index: 1, language: 'de', bitrate: 640 }]),
    }

    expect(analyzer.calculateDubBloatBytes(item)).toBeNull()
  })

  it('withholds a video transcode recommendation when the video stream bitrate is unknown', () => {
    const advice = analyzer.getOptimizationAdvice({
      id: 10,
      source_id: 'src1',
      plex_id: 'p10',
      title: 'Unmeasured remux',
      type: 'movie',
      file_path: '/media/Unmeasured.Remux.AVC.mkv',
      file_size: 20 * 1024 * 1024 * 1024,
      duration: 2 * 60 * 60 * 1000,
      resolution: '1080p',
      video_codec: 'h264',
      video_bitrate: null,
    })

    expect(advice.action).toBe('already_optimized')
    expect(advice.evidence_status).toBe('insufficient')
    expect(advice.confidence).toBe('none')
    expect(advice.savings_basis).toBe('insufficient_data')
    expect(advice.estimatedSavingsBytes).toBe(null)
  })

  it('recommends video_transcode for high-bitrate AVC Remux source', () => {
    const item: MediaItem = {
      id: 1,
      source_id: 'src1',
      plex_id: 'p1',
      title: 'Star Trek S01E01',
      type: 'episode',
      file_path: '/media/Star.Trek.S01E01.1080p.Remux.AVC.DTS-HD.MA.mkv',
      file_size: 15 * 1024 * 1024 * 1024, // 15 GB
      duration: 50 * 60 * 1000, // 50 mins
      resolution: '1080p',
      video_codec: 'h264',
      video_bitrate: 35000,
      audio_codec: 'dts-hd ma',
      audio_channels: 6,
      audio_bitrate: 3500,
      original_language: 'en'
    }

    const advice: OptimizationAdvice = analyzer.getOptimizationAdvice(item)
    expect(advice.action).toBe('video_transcode')
    expect(advice.sourceTier).toBe('Remux')
    expect(advice.reason).toContain('High-bitrate Remux/BluRay source suitable for modern HEVC/AV1 encoding.')
    expect(advice.evidence_status).toBe('estimated')
    expect(advice.confidence).toBe('medium')
    expect(advice.savings_basis).toBe('video_sample_encode')
    expect(advice.estimatedSavingsBytes).toBe(11_250_000_000)
  })

  it('recommends stream_pruning for WEB-DL with foreign audio dub bloat (>150MB)', () => {
    const item: MediaItem = {
      id: 2,
      source_id: 'src1',
      plex_id: 'p2',
      title: 'Strange New Worlds S01E01',
      type: 'episode',
      file_path: '/media/Star.Trek.Strange.New.Worlds.S01E01.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv',
      file_size: 4 * 1024 * 1024 * 1024, // 4 GB
      duration: 50 * 60 * 1000, // 50 mins = 3000 sec
      resolution: '1080p',
      video_codec: 'h264',
      video_bitrate: 6000,
      audio_codec: 'eac3',
      audio_channels: 6,
      audio_bitrate: 640,
      original_language: 'en',
      audio_tracks: JSON.stringify([
        { index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en', title: 'English [Original]' },
        { index: 2, codec: 'eac3', channels: 6, bitrate: 640, language: 'de', title: 'German' },
        { index: 3, codec: 'eac3', channels: 6, bitrate: 640, language: 'fr', title: 'French' },
        { index: 4, codec: 'eac3', channels: 6, bitrate: 640, language: 'es', title: 'Spanish' }
      ])
    }

    const advice: OptimizationAdvice = analyzer.getOptimizationAdvice(item)
    expect(advice.action).toBe('stream_pruning')
    expect(advice.sourceTier).toBe('WEB-DL')
    expect(advice.reason).toContain('Source is already efficient WEB-DL or HEVC/AV1. Stream copy (-c:v copy) recommended')
    expect(advice.evidence_status).toBe('measured')
    expect(advice.savings_basis).toBe('audio_stream_removal')
    expect(advice.estimatedSavingsBytes).toBe(720_000_000)
  })

  it('withholds stream pruning when a removable audio track has no measured bitrate', () => {
    const advice = analyzer.getOptimizationAdvice({
      id: 11,
      source_id: 'src1',
      plex_id: 'p11',
      title: 'Unmeasured dub',
      type: 'episode',
      file_path: '/media/Show.1080p.WEB-DL.mkv',
      duration: 50 * 60 * 1000,
      resolution: '1080p',
      video_codec: 'h264',
      video_bitrate: 6000,
      original_language: 'en',
      audio_tracks: JSON.stringify([
        { index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en' },
        { index: 2, codec: 'eac3', channels: 6, language: 'de' },
      ]),
    })

    expect(advice.action).toBe('already_optimized')
    expect(advice.evidence_status).toBe('insufficient')
    expect(advice.confidence).toBe('none')
    expect(advice.savings_basis).toBe('insufficient_data')
    expect(advice.estimatedSavingsBytes).toBe(null)
  })

  it('recommends already_optimized for clean WEB-DL with no foreign dubs', () => {
    const item: MediaItem = {
      id: 3,
      source_id: 'src1',
      plex_id: 'p3',
      title: 'Strange New Worlds S01E02',
      type: 'episode',
      file_path: '/media/Star.Trek.Strange.New.Worlds.S01E02.1080p.WEB-DL.DDP5.1.Atmos.H.264.mkv',
      file_size: 2 * 1024 * 1024 * 1024,
      duration: 50 * 60 * 1000,
      resolution: '1080p',
      video_codec: 'h264',
      video_bitrate: 5500,
      audio_codec: 'eac3',
      audio_channels: 6,
      audio_bitrate: 640,
      original_language: 'en',
      audio_tracks: JSON.stringify([
        { index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en', title: 'English [Original]' }
      ])
    }

    const advice: OptimizationAdvice = analyzer.getOptimizationAdvice(item)
    expect(advice.action).toBe('already_optimized')
    expect(advice.sourceTier).toBe('WEB-DL')
    expect(advice.reason).toContain('Source is already compact and efficient.')
    expect(advice.estimatedSavingsBytes).toBe(null)
  })

  it('recommends stream_pruning for HEVC file with foreign audio dubs', () => {
    const item: MediaItem = {
      id: 4,
      source_id: 'src1',
      plex_id: 'p4',
      title: 'Discovery S01E01',
      type: 'episode',
      file_path: '/media/Star.Trek.Discovery.S01E01.1080p.x265.mkv',
      file_size: 2500 * 1024 * 1024,
      duration: 50 * 60 * 1000,
      resolution: '1080p',
      video_codec: 'hevc',
      video_bitrate: 3000,
      original_language: 'en',
      audio_tracks: JSON.stringify([
        { index: 1, codec: 'aac', channels: 2, bitrate: 192, language: 'en', title: 'English' },
        { index: 2, codec: 'ac3', channels: 6, bitrate: 640, language: 'es', title: 'Spanish' },
        { index: 3, codec: 'ac3', channels: 6, bitrate: 640, language: 'pt', title: 'Portuguese' }
      ])
    }

    const advice: OptimizationAdvice = analyzer.getOptimizationAdvice(item)
    expect(advice.action).toBe('stream_pruning')
    expect(advice.reason).toContain('Source is already efficient WEB-DL or HEVC/AV1. Stream copy (-c:v copy) recommended')
    expect(advice.estimatedSavingsBytes).toBeGreaterThan(150 * 1024 * 1024)
  })

  it('recommends already_optimized for efficient HDTV stream with no dubs', () => {
    const item: MediaItem = {
      id: 5,
      source_id: 'src1',
      plex_id: 'p5',
      title: 'Show S01E01',
      type: 'episode',
      file_path: '/media/Show.S01E01.720p.HDTV.x264.mkv',
      file_size: 800 * 1024 * 1024,
      duration: 40 * 60 * 1000,
      resolution: '720p',
      video_codec: 'h264',
      video_bitrate: 2500,
      original_language: 'en',
      audio_tracks: JSON.stringify([
        { index: 1, codec: 'ac3', channels: 6, bitrate: 384, language: 'en', title: 'English' }
      ])
    }

    const advice: OptimizationAdvice = analyzer.getOptimizationAdvice(item)
    expect(advice.action).toBe('already_optimized')
    expect(advice.sourceTier).toBe('HDTV')
    expect(advice.reason).toContain('Video bitrate is already within efficient range.')
    expect(advice.estimatedSavingsBytes).toBe(null)
  })

  it('recommends video_transcode for older high-bitrate BluRay encode', () => {
    const item: MediaItem = {
      id: 6,
      source_id: 'src1',
      plex_id: 'p6',
      title: 'Movie 1080p BluRay',
      type: 'movie',
      file_path: '/media/Movie.2010.1080p.BluRay.x264.mkv',
      file_size: 12 * 1024 * 1024 * 1024,
      duration: 120 * 60 * 1000,
      resolution: '1080p',
      video_codec: 'h264',
      video_bitrate: 16000,
      original_language: 'en',
      audio_tracks: JSON.stringify([
        { index: 1, codec: 'dts', channels: 6, bitrate: 1509, language: 'en', title: 'English DTS' }
      ])
    }

    const advice: OptimizationAdvice = analyzer.getOptimizationAdvice(item)
    expect(advice.action).toBe('video_transcode')
    expect(advice.sourceTier).toBe('BluRay')
    expect(advice.reason).toContain('Older or high-bitrate video stream suitable for modern transcoding.')
    expect(advice.estimatedSavingsBytes).toBeGreaterThan(0)
  })

  it('supports passing FileAnalysisResult directly for detailed track and subtitle calculations', () => {
    const item: MediaItem = {
      id: 7,
      source_id: 'src1',
      plex_id: 'p7',
      title: 'Show S01E03',
      type: 'episode',
      file_path: '/media/Show.S01E03.1080p.WEB-DL.mkv',
      file_size: 3 * 1024 * 1024 * 1024,
      duration: 45 * 60 * 1000,
      original_language: 'en'
    }

    const analysis: FileAnalysisResult = {
      success: true,
      filePath: item.file_path!,
      duration: 45 * 60 * 1000,
      video: {
        index: 0,
        codec: 'h264',
        width: 1920,
        height: 1080,
        bitrate: 5000
      },
      audioTracks: [
        { index: 1, codec: 'eac3', channels: 6, bitrate: 640, language: 'en', isDefault: true, hasObjectAudio: false },
        { index: 2, codec: 'eac3', channels: 6, bitrate: 640, language: 'de', isDefault: false, hasObjectAudio: false },
        { index: 3, codec: 'eac3', channels: 6, bitrate: 640, language: 'fr', isDefault: false, hasObjectAudio: false }
      ],
      subtitleTracks: [
        { index: 4, codec: 'subrip', language: 'en', isDefault: true, isForced: false },
        { index: 5, codec: 'hdmv_pgs_subtitle', language: 'de', isDefault: false, isForced: false },
        { index: 6, codec: 'hdmv_pgs_subtitle', language: 'fr', isDefault: false, isForced: false }
      ]
    }

    const advice: OptimizationAdvice = analyzer.getOptimizationAdvice(item, analysis)
    expect(advice.action).toBe('stream_pruning')
    expect(advice.sourceTier).toBe('WEB-DL')
    expect(advice.estimatedSavingsBytes).toBeGreaterThan(150 * 1024 * 1024)
  })
})
