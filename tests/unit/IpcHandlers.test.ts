import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { getBetterSQLiteService, resetBetterSQLiteServiceForTesting } from '../../src/main/database/BetterSQLiteService'

// Track registered handlers
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

// Override ipcMain.handle to capture registrations
vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
  handlers.set(channel, handler)
  return undefined as never
})

// Mock other services (keep these as they are separate domains)
vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    invalidateThresholdsCache: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    refreshApiKey: vi.fn(),
    initialize: vi.fn(),
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
    stat: vi.fn(() => Promise.resolve({ isDirectory: () => true })),
    readdir: vi.fn(() => Promise.resolve([])),
  },
}))

// Import handlers after mocks
import { registerDatabaseHandlers } from '../../src/main/ipc/database'

describe('IPC Handler Registration', () => {
  let db: any

  beforeEach(async () => {
    handlers.clear()
    vi.mocked(ipcMain.handle).mockClear()
    
    resetBetterSQLiteServiceForTesting()
    process.env.NODE_ENV = 'test'
    db = getBetterSQLiteService()
    await db.initialize()
    
    registerDatabaseHandlers()
  })

  it('registers expected database handlers', () => {
    const expected = [
      'db:media:list',
      'db:media:count',
      'db:tvshows:list',
      'db:tvshows:count',
      'db.media.getItem',
      'db:getSetting',
      'db:setSetting',
    ]
    for (const channel of expected) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('db.media.getItem validates input', async () => {
    const handler = handlers.get('db.media.getItem')!
    // Real validation via Zod should throw
    await expect(handler({} as any, -1)).rejects.toThrow()
  })

  it('db:getSetting validates input', async () => {
    const handler = handlers.get('db:getSetting')!
    await expect(handler({} as any, '')).rejects.toThrow()
  })
})
