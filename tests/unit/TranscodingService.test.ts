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

vi.mock('child_process')

describe('Transcoding Integration (Service + IPC)', () => {
  let service: ReturnType<typeof getTranscodingService>
  let db: any
  const testDir = path.join(process.cwd(), 'tests/tmp/transcoding_integrated_test')
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()

  beforeEach(async () => {
    vi.resetAllMocks()
    resetTranscodingServiceForTesting()
    handlers.clear()
    
    db = await setupTestDb()
    
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true })

    // Capture registered handlers
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
      handlers.set(channel, handler)
      return undefined as any
    })

    // Initialize paths in DB so service doesn't use defaults
    await db.config.setSetting('handbrake_path', 'HandBrakeCLI')

    registerTranscodingHandlers()
    service = getTranscodingService()

    // Use real GeminiService but spy on its network method
    const gemini = getGeminiService()
    vi.spyOn(gemini, 'isConfigured').mockReturnValue(true)
    vi.spyOn(gemini, 'sendMessage').mockResolvedValue({
       text: '{"summary": "test", "handbrakeArgs": ["--quality", "20"]}',
       usage: { input_tokens: 0, output_tokens: 0 }
    })

    // Setup real analyzer but mock ffprobe call
    const analyzer = getMediaFileAnalyzer()
    vi.spyOn(analyzer as any, 'runFFprobe').mockImplementation(async (filePath: string) => {
      const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 1000
      return {
        format: { format_name: 'matroska', size: size.toString(), duration: '60' },
        streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }]
      }
    })

    // Mock spawn to handle multiple calls (availability checks + Handbrake)
    vi.mocked(spawn).mockImplementation((tool: any, args: any) => {
      const mockProc: any = {
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
      return mockProc
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

      const handler = handlers.get('transcoding:getParameters')!
      const result = await handler({} as any, testFile, { targetCodec: 'av1' })
      
      expect(result.summary).toBe('test')
      expect(result.handbrakeArgs).toContain('--quality')
    })

    it('initiates and completes a transcoding job through IPC', async () => {
      const testFile = path.join(testDir, 'movie_ipc.mkv')
      fs.writeFileSync(testFile, 'dummy content')
      
      await db.media.upsertItem({ 
        id: 1, 
        source_id: 'src1', 
        plex_id: 'p1', 
        title: 'Movie', 
        type: 'movie', 
        file_path: testFile, 
        file_size: 13 
      } as any)

      service.setAvailabilityOverride({ handbrake: true, mkvtoolnix: true, ffmpeg: true })

      const handler = handlers.get('transcoding:start')!
      const mockEvent = { sender: { send: vi.fn() } }
      
      const result = await handler(mockEvent as any, 1, { overwriteOriginal: true, targetCodec: 'hevc' })
      
      expect(result).toBe(true)
      
      // Verify file was updated (service logic)
      const content = fs.readFileSync(testFile, 'utf8')
      expect(content).toBe('transcoded content')
      
      const item = await db.media.getItem(1)
      expect(item.file_size).toBe(18)
    })
  })

  describe('Service Direct Logic', () => {
    it('respects availability overrides', async () => {
      service.setAvailabilityOverride({ handbrake: true, mkvtoolnix: false, ffmpeg: true })
      const result = await service.checkAvailability()
      expect(result).toEqual({
        handbrake: true
      })
    })
  })
})
