import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QualityAnalyzer } from '../../src/main/services/QualityAnalyzer'
import type { MediaItem } from '../../src/main/types/database'

const mockGetMediaItemByPath = vi.fn()
const mockUpdateDeepAnalysisByPath = vi.fn()

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    config: { getSetting: vi.fn(() => null), getSettingsByPrefix: vi.fn(() => ({})) },
    getSettingsByPrefix: vi.fn(() => ({})),
    upsertQualityScore: vi.fn(),
    getMediaItemByPath: mockGetMediaItemByPath,
    updateDeepAnalysisByPath: mockUpdateDeepAnalysisByPath,
  })),
}))

const mockAnalyzeCompleteFile = vi.fn()

vi.mock('../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: vi.fn(() => ({
    analyzeCompleteFile: mockAnalyzeCompleteFile,
  })),
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(async () => ({
    size: 1048576,
    mtimeMs: 1700000000000,
  })),
}))

describe('QualityAnalyzer - File Evidence Analysis Caching', () => {
  let analyzer: QualityAnalyzer

  beforeEach(() => {
    vi.clearAllMocks()
    analyzer = new QualityAnalyzer()
  })

  it('throws an error if media item has no file_path', async () => {
    const item: MediaItem = {
      plex_id: '1',
      title: 'Movie without path',
      type: 'movie',
      file_path: '',
      file_size_bytes: 1000,
      duration: 5000,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate_kbps: 5000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 192,
    }

    await expect(analyzer.analyzeMediaItemFileEvidence(item)).rejects.toThrow('has no local file path')
  })

  it('reuses cached deep analysis when file size and mtime fingerprint match', async () => {
    const cachedAnalysis = {
      success: true,
      filePath: '/media/movies/Test.mkv',
      fileAnalysisFingerprint: {
        size: 1048576,
        mtimeMs: 1700000000000,
      },
      analysisOptions: {
        scanBitrate: true,
        detectVolume: true,
      },
      video: {
        index: 0,
        codec: 'hevc',
        height: 2160,
        width: 3840,
        bitrate: 18000,
        hdrFormat: 'HDR10',
        bitDepth: 10,
      },
      audioTracks: [
        {
          index: 1,
          codec: 'truehd',
          channels: 8,
          bitrate: 4500,
          isDefault: true,
          hasObjectAudio: true,
        },
      ],
      subtitleTracks: [],
    }

    const item: MediaItem = {
      plex_id: '10',
      title: 'Cached Movie',
      type: 'movie',
      file_path: '/media/movies/Test.mkv',
      file_size_bytes: 1048576,
      duration: 7200000,
      resolution: '4K',
      width: 3840,
      height: 2160,
      video_codec: 'hevc',
      video_bitrate_kbps: 18000,
      audio_codec: 'truehd',
      audio_channels: 8,
      audio_bitrate: 4500,
      deep_analysis: JSON.stringify(cachedAnalysis),
      deep_analysis_at: new Date().toISOString(),
    }

    mockGetMediaItemByPath.mockReturnValue(item)

    const result = await analyzer.analyzeMediaItemFileEvidence(item)

    expect(mockAnalyzeCompleteFile).not.toHaveBeenCalled()
    expect(result.analysis.video?.codec).toBe('hevc')
    expect(result.qualityScore.quality_tier).toBe('4K')
  })

  it('runs deep analysis and persists fingerprint when no cache matches', async () => {
    const item: MediaItem = {
      plex_id: '20',
      title: 'Unanalyzed Movie',
      type: 'movie',
      file_path: '/media/movies/NewMovie.mkv',
      file_size_bytes: 1048576,
      duration: 7200000,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate_kbps: 8000,
      audio_codec: 'dts',
      audio_channels: 6,
      audio_bitrate: 1500,
    }

    mockGetMediaItemByPath.mockReturnValue(item)
    mockAnalyzeCompleteFile.mockResolvedValue({
      success: true,
      filePath: '/media/movies/NewMovie.mkv',
      video: {
        index: 0,
        codec: 'h264',
        height: 1080,
        width: 1920,
        bitrate: 8000,
      },
      audioTracks: [
        {
          index: 1,
          codec: 'dts',
          channels: 6,
          bitrate: 1500,
          isDefault: true,
          hasObjectAudio: false,
        },
      ],
      subtitleTracks: [],
    })

    const result = await analyzer.analyzeMediaItemFileEvidence(item)

    expect(mockAnalyzeCompleteFile).toHaveBeenCalledWith('/media/movies/NewMovie.mkv', {
      scanBitrate: true,
      detectVolume: true,
      signal: undefined,
    })
    expect(mockUpdateDeepAnalysisByPath).toHaveBeenCalled()
    expect(result.qualityScore.quality_tier).toBe('1080p')
  })
})
