import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { LanguageRemuxService } from '@main/services/LanguageRemuxService'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'
import { getTMDBService } from '@main/services/TMDBService'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'
import { promises as fs } from 'node:fs'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/tmp/test-user-data/${name}`),
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
    on: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createReadStream: vi.fn(() => {
      const emitter = new EventEmitter()
      process.nextTick(() => {
        emitter.emit('data', Buffer.from('mock-file-data'))
        emitter.emit('end')
      })
      return emitter
    }),
  }
})

vi.mock('@main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: vi.fn(),
}))

vi.mock('@main/services/TMDBService', () => ({
  getTMDBService: vi.fn(),
}))

vi.mock('@main/services/ArrIntegrationService', () => ({
  ArrIntegrationService: vi.fn(),
}))

describe('Optimization IPC Handlers', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let invoke: ReturnType<typeof setupRealIntegratedBridge>['invoke']

  const mockAnalyzer = {
    isAvailable: vi.fn(),
    getFFmpegPath: vi.fn(),
    getFFprobePath: vi.fn(),
    analyzeFile: vi.fn(),
  }

  const mockTMDBService = {
    getTVShowDetails: vi.fn(),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    invoke = bridge.invoke

    mockAnalyzer.isAvailable.mockResolvedValue(true)
    mockAnalyzer.getFFmpegPath.mockReturnValue('/usr/bin/ffmpeg')
    mockAnalyzer.getFFprobePath.mockReturnValue('/usr/bin/ffprobe')

    vi.mocked(getMediaFileAnalyzer).mockReturnValue(mockAnalyzer as never)
    vi.mocked(getTMDBService).mockReturnValue(mockTMDBService as never)

    // Bypass MediaPathAuthorization for test convenience
    vi.spyOn(MediaPathAuthorization, 'assertMediaAuthorized').mockImplementation(() => {})

    // Default mock implementation for fs.stat
    vi.spyOn(fs, 'stat').mockResolvedValue({
      size: 1000000,
      mtimeMs: 1600000000000,
    } as never)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await cleanupTestDb()
  })

  describe('OPTIMIZATION.LOCAL_REMUX', () => {
    it('throws error when optIn is false', async () => {
      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, 1, false)).rejects.toThrow(
        'Opt-in is required before local remux'
      )
    })

    it('throws error when media item does not exist or has no file_path/source_id', async () => {
      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, 999, true)).rejects.toThrow(
        'Media item has no local source path'
      )
    })

    it('throws error when media source is not found', async () => {
      const mediaId = await db.media.upsertItem({
        source_id: 'non-existent-source',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/movie.mkv',
        title: 'Movie',
      } as never)

      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, mediaId, true)).rejects.toThrow(
        'Media source was not found'
      )
    })

    it('throws error when FFmpeg/FFprobe are unavailable', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/movie.mkv',
        title: 'Movie',
      } as never)

      mockAnalyzer.isAvailable.mockResolvedValueOnce(false)

      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, mediaId, true)).rejects.toThrow(
        'Verified FFmpeg and FFprobe are required for local remux'
      )
    })

    it('throws error when fresh media analysis fails or has no audio tracks', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/movie.mkv',
        title: 'Movie',
      } as never)

      mockAnalyzer.analyzeFile.mockResolvedValueOnce({
        success: false,
        audioTracks: [],
      })

      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, mediaId, true)).rejects.toThrow(
        'Fresh media analysis is required before local remux'
      )
    })

    it('throws error when no removable audio tracks are identified', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/movie.mkv',
        original_language: 'eng',
        title: 'Movie',
      } as never)

      mockAnalyzer.analyzeFile.mockResolvedValueOnce({
        success: true,
        duration: 120000,
        fileSize: 1000000,
        audioTracks: [
          {
            index: 1,
            language: 'eng',
            title: 'English Main',
            codec: 'aac',
            channels: 2,
            channelLayout: 'stereo',
            bitrate: 192000,
            isDefault: true,
            hasObjectAudio: false,
            isCommentary: false,
            isAudioDescription: false,
            isAccessibility: false,
          },
        ],
      })

      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, mediaId, true)).rejects.toThrow()
    })

    it('successfully executes remux workflow and updates job/media records', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/movie.mkv',
        original_language: 'eng',
        title: 'Movie',
      } as never)

      mockAnalyzer.analyzeFile.mockResolvedValueOnce({
        success: true,
        duration: 120000,
        fileSize: 1000000,
        audioTracks: [
          {
            index: 1,
            language: 'eng',
            title: 'English',
            codec: 'aac',
            channels: 2,
            channelLayout: 'stereo',
            bitrate: 192000,
            isDefault: true,
            hasObjectAudio: false,
            isCommentary: false,
            isAudioDescription: false,
            isAccessibility: false,
          },
          {
            index: 2,
            language: 'spa',
            title: 'Spanish',
            codec: 'aac',
            channels: 2,
            channelLayout: 'stereo',
            bitrate: 192000,
            isDefault: false,
            hasObjectAudio: false,
            isCommentary: false,
            isAudioDescription: false,
            isAccessibility: false,
          },
        ],
      })

      const mockRemuxInstance = {
        remux: vi.fn().mockResolvedValue({
          activePath: '/media/movie.mkv',
          verifiedProbe: { size: 800000, duration: 120000 },
        }),
      }
      vi.spyOn(LanguageRemuxService, 'createDefaultRunner').mockReturnValue({} as never)
      vi.spyOn(LanguageRemuxService.prototype, 'remux').mockImplementation(mockRemuxInstance.remux)

      const response = (await invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, mediaId, true)) as {
        jobId: number
        result: unknown
        decision: unknown
      }

      expect(response.jobId).toBeGreaterThan(0)
      const job = await db.mediaRemuxJobs.getLatest(mediaId)
      expect(job?.status).toBe('promoted')
      expect(job?.bytesSaved).toBe(200000)
    })

    it('marks remux job as failed if remux process throws', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/movie.mkv',
        original_language: 'eng',
        title: 'Movie',
      } as never)

      mockAnalyzer.analyzeFile.mockResolvedValueOnce({
        success: true,
        duration: 120000,
        fileSize: 1000000,
        audioTracks: [
          {
            index: 1,
            language: 'eng',
            title: 'English',
            codec: 'aac',
            channels: 2,
            channelLayout: 'stereo',
            bitrate: 192000,
            isDefault: true,
            hasObjectAudio: false,
            isCommentary: false,
            isAudioDescription: false,
            isAccessibility: false,
          },
          {
            index: 2,
            language: 'fre',
            title: 'French',
            codec: 'aac',
            channels: 2,
            channelLayout: 'stereo',
            bitrate: 192000,
            isDefault: false,
            hasObjectAudio: false,
            isCommentary: false,
            isAudioDescription: false,
            isAccessibility: false,
          },
        ],
      })

      vi.spyOn(LanguageRemuxService.prototype, 'remux').mockRejectedValueOnce(new Error('Remux FFmpeg crashed'))

      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, mediaId, true)).rejects.toThrow(
        'Remux FFmpeg crashed'
      )

      const job = await db.mediaRemuxJobs.getLatest(mediaId)
      expect(job?.status).toBe('failed')
      expect(job?.error).toBe('Remux FFmpeg crashed')
    })
  })

  describe('OPTIMIZATION.DRY_RUN', () => {
    it('throws error when episode media analysis is incomplete or unavailable', async () => {
      vi.spyOn(db.tvShows, 'getEpisodes').mockResolvedValueOnce([
        { title: 'Ep 1', file_path: '/media/s01e01.mkv' } as never,
      ])
      mockAnalyzer.isAvailable.mockResolvedValueOnce(false)

      await expect(
        invoke(IPC_CHANNELS.OPTIMIZATION.DRY_RUN, 'Show Title', 'src-1', 'key-1', 'lib-1')
      ).rejects.toThrow('Fresh media analysis is unavailable for episode Ep 1')
    })

    it('computes dry run metrics and fetches original language from TMDB if missing', async () => {
      vi.spyOn(db.tvShows, 'getEpisodes').mockResolvedValueOnce([
        {
          title: 'Ep 1',
          file_path: '/media/s01e01.mkv',
          file_size: 500000,
          storage_debt_bytes: 100000,
          efficiency_score: 80,
          series_tmdb_id: 12345,
        } as never,
      ])

      mockAnalyzer.isAvailable.mockResolvedValue(true)
      mockAnalyzer.analyzeFile.mockResolvedValueOnce({
        success: true,
        duration: 60000,
        audioTracks: [
          {
            index: 1,
            codec: 'aac',
            language: 'eng',
            title: 'English',
            channels: 2,
            bitrate: 192,
            isDefault: true,
            isCommentary: false,
            isAudioDescription: false,
            isAccessibility: false,
          },
        ],
      })

      mockTMDBService.getTVShowDetails.mockResolvedValueOnce({ original_language: 'en' })

      const res = (await invoke(
        IPC_CHANNELS.OPTIMIZATION.DRY_RUN,
        'Show Title',
        'src-1',
        'key-1',
        'lib-1'
      )) as Record<string, unknown>

      expect(res.title).toBe('Show Title')
      expect(res.optInRequired).toBe(true)
      expect(mockTMDBService.getTVShowDetails).toHaveBeenCalledWith(12345)
    })
  })

  describe('OPTIMIZATION.REQUEST_ARR_SEARCH', () => {
    it('throws error when optIn is false', async () => {
      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH, 10, false)).rejects.toThrow(
        'Opt-in is required before requesting an Arr search'
      )
    })

    it('throws error when Arr settings are not configured', async () => {
      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH, 10, true)).rejects.toThrow(
        'Arr integration is not configured in main-process settings'
      )
    })

    it('returns existing pending record if key is already set', async () => {
      await db.config.setSetting('arr_base_url', 'http://localhost:8989')
      await db.config.setSetting('arr_api_key', 'valid-api-key')

      const key = 'optimization.pending.arr.series.10'
      const existingRecord = {
        requestedAt: '2025-01-01T00:00:00.000Z',
        seriesId: 10,
        commandId: 55,
        state: 'awaiting-rescan',
      }
      await db.config.setSetting(key, JSON.stringify(existingRecord))

      const result = (await invoke(
        IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH,
        10,
        true
      )) as Record<string, unknown>

      expect(result.state).toBe('awaiting-rescan')
      expect(result.pending).toEqual(existingRecord)
    })

    it('executes searchSeries and stores new pending record when not present', async () => {
      await db.config.setSetting('arr_base_url', 'http://localhost:8989')
      await db.config.setSetting('arr_api_key', 'valid-api-key')

      const searchSeriesMock = vi.fn().mockResolvedValue({ id: 99 })
      vi.mocked(ArrIntegrationService).mockImplementation(function (this: { searchSeries: typeof searchSeriesMock }) {
        this.searchSeries = searchSeriesMock
      } as never)

      const result = (await invoke(
        IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH,
        10,
        true
      )) as Record<string, unknown>

      expect(result.seriesId).toBe(10)
      expect(result.commandId).toBe(99)
      expect(result.state).toBe('awaiting-rescan')

      const saved = await db.config.getSetting('optimization.pending.arr.series.10')
      expect(saved).toBeDefined()
      expect(JSON.parse(saved!)).toMatchObject({ seriesId: 10, commandId: 99 })
    })
  })

  describe('OPTIMIZATION.GET_PENDING', () => {
    it('returns valid pending records and filters out invalid JSON records', async () => {
      const validKey = 'optimization.pending.arr.series.1'
      const validValue = JSON.stringify({
        requestedAt: '2025-01-01T00:00:00.000Z',
        seriesId: 1,
        commandId: 100,
        state: 'awaiting-rescan',
      })
      const invalidKey = 'optimization.pending.arr.series.2'
      const invalidValue = 'invalid-json-{}'

      await db.config.setSetting(validKey, validValue)
      await db.config.setSetting(invalidKey, invalidValue)

      const result = (await invoke(IPC_CHANNELS.OPTIMIZATION.GET_PENDING)) as Array<{
        key: string
        value: unknown
      }>

      expect(result).toHaveLength(1)
      expect(result[0].key).toBe(validKey)
      expect(result[0].value).toMatchObject({ seriesId: 1, commandId: 100 })
    })
  })

  describe('OPTIMIZATION.GET_REMUX_JOB', () => {
    it('returns the latest remux job for a media item', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/test.mkv',
        title: 'Title',
      } as never)

      const jobId = await db.mediaRemuxJobs.create({
        mediaItemId: mediaId,
        operationKind: 'remux',
        status: 'planned',
        sourcePath: '/media/test.mkv',
        sourceSize: 1000,
        sourceMtimeMs: 1000,
        sourceSha256: 'abc',
        decisionSnapshot: '{}',
        streamSignatures: '[]',
        quarantinePath: '/tmp/quarantine',
        error: null,
        predictedOutputBytes: null,
        actualOutputBytes: null,
        bytesSaved: null,
        sourceDurationMs: null,
        outputDurationMs: null,
        encoderProfile: null,
        sourceAnalysis: null,
        outputAnalysis: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      const job = (await invoke(IPC_CHANNELS.OPTIMIZATION.GET_REMUX_JOB, mediaId)) as { id: number; mediaItemId: number }
      expect(job.id).toBe(jobId)
      expect(job.mediaItemId).toBe(mediaId)
    })
  })

  describe('OPTIMIZATION.GET_DECISION', () => {
    it('throws error when media item does not exist', async () => {
      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.GET_DECISION, 999)).rejects.toThrow(
        'Media item has no local source path'
      )
    })

    it('throws error when source does not exist', async () => {
      const mediaId = await db.media.upsertItem({
        source_id: 'missing-src',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/item.mkv',
        title: 'Title',
      } as never)

      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.GET_DECISION, mediaId)).rejects.toThrow(
        'Media source was not found'
      )
    })

    it('throws error when media analysis fails', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/item.mkv',
        title: 'Title',
      } as never)

      mockAnalyzer.analyzeFile.mockResolvedValueOnce({
        success: false,
        error: 'Corrupt file probe failed',
      })

      await expect(invoke(IPC_CHANNELS.OPTIMIZATION.GET_DECISION, mediaId)).rejects.toThrow(
        'Corrupt file probe failed'
      )
    })

    it('returns calculated optimization decision when analysis succeeds', async () => {
      await db.sources.upsertSource({
        source_id: 'src-1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: JSON.stringify({ path: '/media' }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: '/media/item.mkv',
        title: 'Title',
        original_language: 'eng',
      } as never)

      mockAnalyzer.analyzeFile.mockResolvedValueOnce({
        success: true,
        duration: 120000,
        fileSize: 2000000,
        audioTracks: [
          {
            index: 1,
            language: 'eng',
            title: 'English',
            codec: 'aac',
            channels: 2,
            channelLayout: 'stereo',
            bitrate: 192000,
            isDefault: true,
            hasObjectAudio: false,
            isCommentary: false,
            isAudioDescription: false,
            isAccessibility: false,
          },
        ],
      })

      const decision = (await invoke(IPC_CHANNELS.OPTIMIZATION.GET_DECISION, mediaId)) as Record<string, unknown>
      expect(decision).toBeDefined()
      expect(decision.primaryAction).toBeDefined()
    })
  })
})
