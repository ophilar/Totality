import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import { getTranscodingService } from '@main/services/TranscodingService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('./tests/tmp'),
    isReady: vi.fn().mockReturnValue(true),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
}))

const mockService = {
  checkAvailability: vi.fn(),
  getTranscodeParameters: vi.fn(),
  transcode: vi.fn(),
}

vi.mock('../../src/main/services/TranscodingService', () => ({
  getTranscodingService: vi.fn(() => mockService),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}))

describe('Transcoding IPC Handlers', () => {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  let db: any

  beforeEach(async () => {
    vi.resetAllMocks()
    handlers.clear()
    
    db = await setupTestDb()

    // Capture registered handlers
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
      handlers.set(channel, handler)
      return undefined as any
    })

    registerTranscodingHandlers()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('registers all expected transcoding handlers', () => {
    expect(handlers.has('transcoding:checkAvailability')).toBe(true)
    expect(handlers.has('transcoding:getParameters')).toBe(true)
    expect(handlers.has('transcoding:start')).toBe(true)
  })

  describe('transcoding:checkAvailability', () => {
    it('calls service.checkAvailability', async () => {
      const service = getTranscodingService()
      vi.mocked(service.checkAvailability).mockResolvedValue({ handbrake: true, mkvtoolnix: true, ffmpeg: true })
      
      const handler = handlers.get('transcoding:checkAvailability')!
      const result = await handler({} as any)
      
      expect(result.handbrake).toBe(true)
      expect(service.checkAvailability).toHaveBeenCalled()
    })
  })

  describe('transcoding:getParameters', () => {
    it('validates input and calls service.getTranscodeParameters', async () => {
      const service = getTranscodingService()
      vi.mocked(service.getTranscodeParameters).mockResolvedValue({ summary: 'test', handbrakeArgs: [] })
      
      const handler = handlers.get('transcoding:getParameters')!
      const result = await handler({} as any, 'C:/test.mp4', { targetCodec: 'av1' })
      
      expect(result.summary).toBe('test')
      expect(service.getTranscodeParameters).toHaveBeenCalledWith('C:/test.mp4', { targetCodec: 'av1' })
    })

    it('throws validation error for invalid path', async () => {
      const handler = handlers.get('transcoding:getParameters')!
      await expect(handler({} as any, '', {})).rejects.toThrow()
    })
  })

  describe('transcoding:start', () => {
    it('calls service.transcode', async () => {
      const service = getTranscodingService()
      vi.mocked(service.transcode).mockResolvedValue(true)
      
      const handler = handlers.get('transcoding:start')!
      const result = await handler({} as any, 123, { targetCodec: 'hevc' })
      
      expect(result).toBe(true)
      expect(service.transcode).toHaveBeenCalledWith(123, { targetCodec: 'hevc' }, expect.any(Function))
    })
  })
})



