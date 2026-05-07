import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TranscodingService, resetTranscodingServiceForTesting } from '@main/services/TranscodingService'
import { resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import { getGeminiService } from '@main/services/GeminiService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { getLoggingService } from '@main/services/LoggingService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'

// Mock dependencies
const mockLog = {
  info: vi.fn(),
  error: vi.fn(),
  verbose: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn()
}

vi.mock('../../src/main/services/GeminiService')
vi.mock('../../src/main/services/MediaFileAnalyzer')
vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => mockLog)
}))

// Mock fs and fs/promises correctly using importOriginal
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ size: 1000 }),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  }
})

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    stat: vi.fn().mockResolvedValue({ size: 1000 }),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(Promise.resolve()),
  }
})

vi.mock('child_process')

describe('TranscodingService', () => {
  let service: TranscodingService
  let db: any
  let mockGemini: any
  let mockAnalyzer: any

  beforeEach(async () => {
    vi.resetAllMocks()
    resetTranscodingServiceForTesting()
    
    db = await setupTestDb()

    mockGemini = {
      isConfigured: vi.fn().mockReturnValue(true),
      sendMessage: vi.fn()
    }
    vi.mocked(getGeminiService).mockReturnValue(mockGemini)

    mockAnalyzer = {
      getFFprobePath: vi.fn().mockReturnValue('ffprobe'),
      analyzeFile: vi.fn()
    }
    vi.mocked(getMediaFileAnalyzer).mockReturnValue(mockAnalyzer)

    // Ensure existsSync returns true for expected paths by default
    const fsMod = await import('fs')
    vi.mocked(fsMod.existsSync).mockReturnValue(true)
    
    const fsAsync = await import('fs/promises')
    vi.mocked(fsAsync.unlink).mockResolvedValue(undefined)
    vi.mocked(fsAsync.stat).mockResolvedValue({ size: 1000 } as any)

    service = new TranscodingService()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('checkAvailability', () => {
    it('returns tool availability based on process execution', async () => {
      const mockSpawn = vi.mocked(spawn)
      
      // Setup successful spawns
      mockSpawn.mockReturnValue({
        on: vi.fn((event, cb) => {
          if (event === 'close') cb(0)
        })
      } as any)

      const result = await service.checkAvailability()
      expect(result).toEqual({
        handbrake: true,
        mkvtoolnix: true,
        ffmpeg: true
      })
    })

    it('returns false if tool execution fails', async () => {
      const mockSpawn = vi.mocked(spawn)
      
      // Setup failing spawns
      mockSpawn.mockReturnValue({
        on: vi.fn((event, cb) => {
          if (event === 'close') cb(1)
          if (event === 'error') cb(new Error('Spawn error'))
        })
      } as any)

      const result = await service.checkAvailability()
      expect(result).toEqual({
        handbrake: false,
        mkvtoolnix: false,
        ffmpeg: false
      })
    })

    it('respects availability overrides in testing', async () => {
      service.setAvailabilityOverride({ handbrake: true, mkvtoolnix: false, ffmpeg: true })
      const result = await service.checkAvailability()
      expect(result).toEqual({
        handbrake: true,
        mkvtoolnix: false,
        ffmpeg: true
      })
    })
  })

  describe('getTranscodeParameters', () => {
    it('throws if Gemini is not configured', async () => {
      mockAnalyzer.analyzeFile.mockResolvedValue({ success: true, metadata: {} })
      mockGemini.isConfigured.mockReturnValue(false)
      await expect(service.getTranscodeParameters('test.mp4'))
        .rejects.toThrow('Gemini AI is not configured')
    })

    it('parses AI response into transcoding parameters', async () => {
      mockAnalyzer.analyzeFile.mockResolvedValue({ success: true, metadata: {} })
      mockGemini.sendMessage.mockResolvedValue({
        text: '```json\n{"summary": "Better quality", "handbrakeArgs": ["--preset", "fast"]}\n```'
      })

      const params = await service.getTranscodeParameters('test.mp4')
      expect(params.summary).toBe('Better quality')
      expect(params.handbrakeArgs).toEqual(['--preset', 'fast'])
    })

    it('throws error if AI response is invalid JSON', async () => {
      mockAnalyzer.analyzeFile.mockResolvedValue({ success: true, metadata: {} })
      mockGemini.sendMessage.mockResolvedValue({ text: 'Not JSON' })

      await expect(service.getTranscodeParameters('test.mp4'))
        .rejects.toThrow('Failed to generate optimized transcoding parameters')
    })
  })

  describe('transcode', () => {
    beforeEach(async () => {
      service.setAvailabilityOverride({ handbrake: true, mkvtoolnix: true, ffmpeg: true })
      await db.media.upsertItem({ id: 1, source_id: 'src1', plex_id: 'p1', title: 'Movie', type: 'movie', file_path: 'C:/media/movie.mkv', file_size: 1000 } as any)
    })

    it('executes transcode and updates database on success', async () => {
      // Mock parameter generation
      vi.spyOn(service, 'getTranscodeParameters').mockResolvedValue({
        summary: 'Saving space',
        handbrakeArgs: ['--vb', '2000']
      })

      // Mock spawn for Handbrake
      const mockProc: any = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn((event, cb) => {
          if (event === 'close') {
            // Ensure this happens after event listeners are attached
            setTimeout(() => cb(0), 10)
          }
        })
      }
      vi.mocked(spawn).mockReturnValue(mockProc)

      mockAnalyzer.analyzeFile.mockResolvedValue({ success: true, metadata: {} })

      const onProgress = vi.fn()
      const result = await service.transcode(1, { overwriteOriginal: true }, onProgress)

      expect(result).toBe(true)
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'complete' }))
      
      const item = await db.media.getItem(1)
      expect(item.file_path).toContain('movie.mkv')
    })

    it('reports failure if Handbrake fails', async () => {
      vi.spyOn(service, 'getTranscodeParameters').mockResolvedValue({
        summary: 'Saving space',
        handbrakeArgs: ['--vb', '2000']
      })

      const mockProc: any = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === 'close') cb(1)
        })
      }
      vi.mocked(spawn).mockReturnValue(mockProc)

      const onProgress = vi.fn()
      const result = await service.transcode(1, {}, onProgress)

      expect(result).toBe(false)
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    })
  })
})



