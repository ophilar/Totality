import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getTranscodingService, resetTranscodingServiceForTesting } from '@main/services/TranscodingService'
import { getGeminiService } from '@main/services/GeminiService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { FileAnalysisResult } from '@main/workers/ffprobe-worker'
import type { MediaItem } from '@main/types/database'

vi.mock('child_process')

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

    // Capture registered handlers
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: CapturedHandler) => {
      handlers.set(channel, handler)
      return undefined
    })

    registerTranscodingHandlers()
    service = getTranscodingService()

    // Use real GeminiService but spy on its network method
    const gemini = getGeminiService()
    vi.spyOn(gemini, 'isConfigured').mockReturnValue(true)
    vi.spyOn(gemini, 'sendMessage').mockResolvedValue({
       text: '{"summary": "test", "videoCodec": "nvenc_h265", "crf": 20, "preset": "p6", "ffmpegArgs": ["-c:v", "hevc_nvenc"]}',
       usage: { input_tokens: 0, output_tokens: 0 }
    })

    // Setup real analyzer but mock ffprobe call
    const analyzer = getMediaFileAnalyzer()
    vi.spyOn(analyzer as unknown as { runFFprobe: (filePath: string) => Promise<unknown> }, 'runFFprobe').mockImplementation(async (filePath: string) => {
      const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 1000
      return {
        format: { format_name: 'matroska', size: size.toString(), duration: '60' },
        streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }]
      }
    })

    // Mock spawn to handle availability checks and FFmpeg execution.
    vi.mocked(spawn).mockImplementation((tool: string, args: readonly string[]) => {
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            const argsArray = Array.isArray(args) ? args : []
            const iIdx = argsArray.indexOf('-i')
            const oIdx = argsArray.indexOf('-o')
            
            if (iIdx !== -1 && oIdx !== -1) {
               const outputPath = argsArray[oIdx + 1]
               if (outputPath) {
                 fs.writeFileSync(outputPath, 'transcoded content')
               }
            }
            setTimeout(() => cb(0), 10)
          }
        })
      }
      return mockProc as unknown as ReturnType<typeof spawn>
    })
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
      expect(handlers.has('transcoding:start')).toBe(true)
    })
  })

  describe('Integrated Transcoding Flow', () => {
    it('returns AI generated parameters via IPC for a real file', async () => {
      const testFile = path.join(testDir, 'input.mkv')
      fs.writeFileSync(testFile, 'dummy')
      await db.sources.upsertSource({ source_id: 'src1', source_type: 'local', display_name: 'Test source', connection_config: JSON.stringify({ folderPath: testDir }), is_enabled: 1 })
      await db.media.upsertItem({ id: 1, source_id: 'src1', plex_id: 'p1', title: 'Movie', type: 'movie', file_path: testFile, file_size: 5, duration: null, resolution: null, width: null, height: null, video_codec: null, video_bitrate: null, audio_codec: null, audio_channels: null, audio_bitrate: null } satisfies MediaItem)

      const handler = handlers.get('transcoding:getParameters')!
      const result = await handler({} as IpcMainInvokeEvent, 1, { targetCodec: 'av1' }) as { summary: string }
      
      expect(result.summary).toBe('test')
    })

  })

  describe('Service Direct Logic', () => {
    it('respects availability overrides', async () => {
      const result = await service.checkAvailability()
      expect(result.ffmpeg).toBeDefined()
    })
  })
})
