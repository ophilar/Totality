/**
 * IPC Handler Registration & Integration Tests
 *
 * Tests that IPC handlers are registered correctly, validate inputs,
 * and handle errors gracefully.
 *
 * Uses real in-memory database to reduce mocking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain, BrowserWindow } from 'electron'
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
  })

  describe('Database Handler Validation', () => {
    it('db:getMediaItemById rejects non-positive integer', async () => {
      const handler = handlers.get('db:getMediaItemById')!
      await expect(handler({} as never, -1)).rejects.toThrow('Validation failed')
      await expect(handler({} as never, 'abc')).rejects.toThrow('Validation failed')
      await expect(handler({} as never, 0)).rejects.toThrow('Validation failed')
    })

    it('db:getSetting rejects empty key', async () => {
      const handler = handlers.get('db:getSetting')!
      await expect(handler({} as never, '')).rejects.toThrow('Validation failed')
    })

    it('db:setSetting rejects key exceeding max length', async () => {
      const handler = handlers.get('db:setSetting')!
      const mockEvent = { sender: { id: 1 } } as never
      await expect(handler(mockEvent, 'a'.repeat(201), 'value')).rejects.toThrow('Validation failed')
    })

    it('db:countMediaItems rejects invalid filter type', async () => {
      const handler = handlers.get('db:countMediaItems')!
      await expect(handler({} as never, { type: 'invalid' })).rejects.toThrow('Validation failed')
    })
  })

  describe('IPC Handler Functional Logic', () => {
    it('db:getMediaItems accepts undefined filters', async () => {
      const handler = handlers.get('db:getMediaItems')!
      const result = await handler({} as never, undefined)
      expect(Array.isArray(result)).toBe(true)
    })

    it('db:setSetting correctly persists setting to real database', async () => {
      const handler = handlers.get('db:setSetting')!
      await handler({ sender: {} } as any, 'new_key', 'new_value')
      expect(testDb.getSetting('new_key')).toBe('new_value')
    })
  })
})
