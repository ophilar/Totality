/**
 * IPC Handler Registration & Integration Tests
 *
 * Tests that IPC handlers are registered correctly, validate inputs,
 * and handle errors gracefully.
 *
 * Uses real in-memory database to reduce mocking and increase confidence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { BetterSQLiteService } from '../../src/main/database/BetterSQLiteService'

// Track registered handlers
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

// Override ipcMain.handle to capture registrations
vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
  handlers.set(channel, handler)
  return undefined as never
})

// Intercept getDatabase
let testDb: BetterSQLiteService

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => testDb),
}))

// Mock other service dependencies
vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    invalidateThresholdsCache: vi.fn(),
    getQualityDistribution: vi.fn(() => ({})),
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    refreshApiKey: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/GeminiService', () => ({
  getGeminiService: vi.fn(() => ({
    refreshApiKey: vi.fn(),
  })),
}))

vi.mock('../../src/main/providers/kodi/KodiDatabaseSchema', () => ({
  invalidateNfsMappingsCache: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(() => Promise.resolve({ size: 1024 })),
  },
}))

describe('IPC Handler Registration', () => {
  let registerDatabaseHandlers: () => void

  beforeEach(async () => {
    handlers.clear()
    vi.mocked(ipcMain.handle).mockClear()
    
    testDb = new BetterSQLiteService(':memory:')
    testDb.initialize()
    
    // Import inside beforeEach to ensure fresh registration
    const mod = await import('../../src/main/ipc/database')
    registerDatabaseHandlers = mod.registerDatabaseHandlers
    
    registerDatabaseHandlers()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('Database Handlers Registration', () => {
    it('registers all expected database handlers', () => {
      const expectedHandlers = [
        'db:getMediaItems',
        'db:countMediaItems',
        'db:getTVShows',
        'db:countTVShows',
        'db:countTVEpisodes',
        'db:getMediaItemById',
        'db:upsertMediaItem',
        'db:deleteMediaItem',
        'db:getMediaItemVersions',
        'db:getQualityScores',
        'db:getQualityScoreByMediaId',
        'db:upsertQualityScore',
        'db:getSetting',
        'db:setSetting',
      ]

      for (const channel of expectedHandlers) {
        expect(handlers.has(channel), `Handler '${channel}' should be registered`).toBe(true)
      }
    })

    it('db:getMediaItemById rejects non-positive integer', async () => {
      const handler = handlers.get('db:getMediaItemById')!
      await expect(handler({} as never, -1)).rejects.toThrow('Validation failed')
      await expect(handler({} as never, 'abc')).rejects.toThrow('Validation failed')
      await expect(handler({} as never, 0)).rejects.toThrow('Validation failed')
    })

    it('db:getMediaItemById accepts valid id', async () => {
      const handler = handlers.get('db:getMediaItemById')!
      // In a real DB, 42 doesn't exist yet, so should return null
      const result = await handler({} as never, 42)
      expect(result).toBeNull()
    })

    it('db:getSetting rejects empty key', async () => {
      const handler = handlers.get('db:getSetting')!
      await expect(handler({} as never, '')).rejects.toThrow('Validation failed')
    })

    it('db:getSetting accepts valid key', async () => {
      const handler = handlers.get('db:getSetting')!
      const result = await handler({} as never, 'tmdb_api_key')
      // Defaults to empty string from schema
      expect(result).toBe('')
    })

    it('db:setSetting rejects key exceeding max length', async () => {
      const handler = handlers.get('db:setSetting')!
      const mockEvent = { sender: { id: 1 } } as never
      await expect(handler(mockEvent, 'a'.repeat(201), 'value')).rejects.toThrow('Validation failed')
    })

    it('db:deleteMediaItem rejects non-integer id', async () => {
      const handler = handlers.get('db:deleteMediaItem')!
      await expect(handler({} as never, 'not-a-number')).rejects.toThrow('Validation failed')
    })

    it('db:getMediaItems accepts undefined filters', async () => {
      const handler = handlers.get('db:getMediaItems')!
      const result = await handler({} as never, undefined)
      expect(Array.isArray(result)).toBe(true)
    })

    it('db:getTVShows rejects invalid sortBy', async () => {
      const handler = handlers.get('db:getTVShows')!
      await expect(handler({} as never, { sortBy: 'DROP TABLE' })).rejects.toThrow('Validation failed')
    })

    it('db:countMediaItems rejects invalid filter type', async () => {
      const handler = handlers.get('db:countMediaItems')!
      await expect(handler({} as never, { type: 'invalid' })).rejects.toThrow('Validation failed')
    })

    it('db:getLetterOffset validates required params', async () => {
      const handler = handlers.get('db:getLetterOffset')!
      await expect(handler({} as never, {})).rejects.toThrow('Validation failed')
    })
  })

  describe('IPC Handler Functional Logic', () => {
    it('db:setSetting correctly persists setting to real database', async () => {
      const handler = handlers.get('db:setSetting')!
      await handler({ sender: {} } as any, 'new_key', 'new_value')
      expect(testDb.getSetting('new_key')).toBe('new_value')
    })

    it('db:getMediaItems returns data from real database', async () => {
      const handler = handlers.get('db:getMediaItems')!
      
      testDb.upsertMediaItem({
        plex_id: '1',
        title: 'Real DB Movie',
        type: 'movie',
        file_path: '/path/test.mkv',
        file_size: 1000,
        duration: 3600,
        resolution: '1080p',
        width: 1920,
        height: 1080,
        video_codec: 'h264',
        video_bitrate: 5000,
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate: 192,
      })

      const results = await handler({} as any, { type: 'movie' }) as any[]
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Real DB Movie')
    })
  })
})

describe('IPC Handler Error Handling', () => {
  beforeEach(async () => {
    handlers.clear()
    vi.mocked(ipcMain.handle).mockClear()
    
    testDb = new BetterSQLiteService(':memory:')
    testDb.initialize()
    
    const mod = await import('../../src/main/ipc/database')
    mod.registerDatabaseHandlers()
  })

  afterEach(() => {
    testDb.close()
  })

  it('handlers throw errors with context for invalid input', async () => {
    const handler = handlers.get('db:getMediaItemById')!
    try {
      await handler({} as never, 'invalid')
      expect.fail('should throw')
    } catch (error) {
      expect((error as Error).message).toContain('db:getMediaItemById')
    }
  })
})
