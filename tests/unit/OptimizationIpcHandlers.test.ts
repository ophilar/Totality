import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { LanguageRemuxService } from '@main/services/LanguageRemuxService'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'
import { getTMDBService } from '@main/services/TMDBService'
import { promises as fs } from 'node:fs'
import path from 'node:path'

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
  let mediaDir: string
  let invoke: ReturnType<typeof setupRealIntegratedBridge>['invoke']
  const mediaPath = (filename: string) => path.join(mediaDir, filename)

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
    await fs.mkdir(path.join(process.cwd(), 'tests/tmp'), { recursive: true })
    mediaDir = await fs.mkdtemp(path.join(process.cwd(), 'tests/tmp/optimization-ipc-'))
    await Promise.all(['movie.mkv', 's01e01.mkv', 'test.mkv', 'item.mkv'].map(filename =>
      fs.writeFile(mediaPath(filename), Buffer.alloc(1_000_000))
    ))
    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    invoke = bridge.invoke

    mockAnalyzer.isAvailable.mockResolvedValue(true)
    mockAnalyzer.getFFmpegPath.mockReturnValue('/usr/bin/ffmpeg')
    mockAnalyzer.getFFprobePath.mockReturnValue('/usr/bin/ffprobe')

    vi.mocked(getMediaFileAnalyzer).mockReturnValue(mockAnalyzer as never)
    vi.mocked(getTMDBService).mockReturnValue(mockTMDBService as never)

  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await cleanupTestDb()
    await fs.rm(mediaDir, { recursive: true, force: true })
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
        file_path: mediaPath('item.mkv'),
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
        connection_config: JSON.stringify({ folderPath: mediaDir }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: mediaPath('item.mkv'),
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
        connection_config: JSON.stringify({ folderPath: mediaDir }),
        is_enabled: 1,
      })
      const mediaId = await db.media.upsertItem({
        source_id: 'src-1',
        source_type: 'local',
        type: 'movie',
        file_path: mediaPath('item.mkv'),
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
