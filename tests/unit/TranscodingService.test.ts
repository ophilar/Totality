import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getTranscodingService, resetTranscodingServiceForTesting } from '@main/services/TranscodingService'
import { setupTestDb, cleanupTestDb, createAuthorizedIpcEvent } from '@tests/TestUtils'
import * as fs from 'fs'
import * as path from 'path'
import { spawnSync } from 'child_process'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { _FileAnalysisResult } from '@main/workers/ffprobe-worker'
import type { MediaItem } from '@main/types/database'

describe('Transcoding Integration (Service + IPC)', () => {
  let service: ReturnType<typeof getTranscodingService>
  let db: Awaited<ReturnType<typeof setupTestDb>>
  const testDir = path.join(process.cwd(), 'tests/tmp/transcoding_integrated_test')
  type CapturedHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
  const handlers = new Map<string, CapturedHandler>()

  beforeEach(async () => {
    vi.resetAllMocks()
    resetTranscodingServiceForTesting()
    handlers.clear()
    
    db = await setupTestDb()
    
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true })
    const fixturePath = path.join(testDir, 'input.mkv')
    const fixture = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'color=c=black:s=16x16:d=1', '-frames:v', '1', '-c:v', 'mpeg4',
      '-f', 'matroska', '-y', fixturePath,
    ], { encoding: 'utf8' })
    if (fixture.error) throw fixture.error
    if (fixture.status !== 0) throw new Error(`FFmpeg test fixture failed: ${fixture.stderr}`)

    // Capture registered handlers
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: CapturedHandler) => {
      handlers.set(channel, handler)
      return undefined
    })

    registerTranscodingHandlers()
    service = getTranscodingService()

  })

  afterEach(async () => {
    cleanupTestDb()
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('IPC Registration', () => {
    it('registers all expected transcoding handlers', () => {
      expect(handlers.has('transcoding:checkAvailability')).toBe(true)
      expect(handlers.has('transcoding:getParameters')).toBe(true)
      expect(handlers.has('transcoding:preflightShow')).toBe(true)
      expect(handlers.has('transcoding:queueShow')).toBe(true)
      expect(handlers.has('transcoding:start')).toBe(false)
    })
  })

  describe('Integrated Transcoding Flow', () => {
    it('returns explicit transcoding parameters via IPC for a real file', async () => {
      const testFile = path.join(testDir, 'input.mkv')
      await db.sources.upsertSource({ source_id: 'src1', source_type: 'local', display_name: 'Test source', connection_config: JSON.stringify({ folderPath: testDir }), is_enabled: 1 })
      await db.media.upsertItem({ id: 1, source_id: 'src1', plex_id: 'p1', title: 'Movie', type: 'movie', file_path: testFile, file_size: 5, duration: null, resolution: null, width: null, height: null, video_codec: null, video_bitrate: null, audio_codec: null, audio_channels: null, audio_bitrate: null } satisfies MediaItem)

      const handler = handlers.get('transcoding:getParameters')!
      const result = await handler(createAuthorizedIpcEvent(), 1, { targetCodec: 'av1', encoder: 'svt_av1', crf: 25, preset: 'fast', qualityProfile: 'balanced', encoderPolicy: 'software' }) as { summary: string }
      
      expect(result.summary).toBe('Explicit measured transcoding parameters')
    })

  })

  describe('Service Direct Logic', () => {
    it('respects availability overrides', async () => {
      const result = await service.checkAvailability()
      expect(result.ffmpeg).toBeDefined()
    })
  })
})
