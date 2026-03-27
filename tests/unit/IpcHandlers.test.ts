/**
 * IPC Handler Registration & Integration Tests
 *
 * Tests that IPC handlers are registered correctly, validate inputs,
 * and handle errors gracefully.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// Track registered handlers
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

// Override ipcMain.handle to capture registrations
vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
  handlers.set(channel, handler)
  return undefined as never
})

// Shared mock database
const sharedMockDb = {
  getMediaItems: vi.fn(() => []),
  countMediaItems: vi.fn(() => 0),
  getTVShows: vi.fn(() => []),
  countTVShows: vi.fn(() => 0),
  countTVEpisodes: vi.fn(() => 0),
  getMediaItemById: vi.fn(() => null),
  upsertMediaItem: vi.fn(() => 1),
  deleteMediaItem: vi.fn(),
  getMediaItemVersions: vi.fn(() => []),
  getQualityScores: vi.fn(() => []),
  getQualityScoreByMediaId: vi.fn(() => null),
  upsertQualityScore: vi.fn(() => 1),
  getSetting: vi.fn(() => null),
  setSetting: vi.fn(),
  getMediaSources: vi.fn(() => []),
  getAggregatedSourceStats: vi.fn(() => ({ totalSources: 0, enabledSources: 0, totalItems: 0, bySource: [] })),
  getLetterOffset: vi.fn(() => 0),
  getExclusions: vi.fn(() => []),
  addExclusion: vi.fn(() => 1),
  removeExclusion: vi.fn(),
  resetDatabase: vi.fn(),
  getDbPath: vi.fn(() => '/mock/path/totality.db'),
}

// Mock database getter
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => sharedMockDb),
}))

// Mock other services
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
  beforeEach(() => {
    handlers.clear()
    vi.mocked(ipcMain.handle).mockClear()
    registerDatabaseHandlers()
  })

  it('registers expected database handlers', () => {
    const expected = [
      'db:getMediaItems',
      'db:countMediaItems',
      'db:getTVShows',
      'db:countTVShows',
      'db:getMediaItemById',
      'db:getSetting',
      'db:setSetting',
    ]
    for (const channel of expected) {
      expect(handlers.has(channel)).toBe(true)
    }
  })

  it('db:getMediaItemById validates input', async () => {
    const handler = handlers.get('db:getMediaItemById')!
    await expect(handler({} as any, -1)).rejects.toThrow('Validation failed')
  })

  it('db:getSetting validates input', async () => {
    const handler = handlers.get('db:getSetting')!
    await expect(handler({} as any, '')).rejects.toThrow('Validation failed')
  })
})
