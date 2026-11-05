import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
  handlers.set(channel, handler)
  return undefined as never
})

const mockDb = {
  updateSeriesMatch: vi.fn(() => 5),
}

const mockTMDB = {
  initialize: vi.fn(),
  getTVShowDetails: vi.fn().mockResolvedValue({
    id: 1396,
    name: 'Breaking Bad',
    original_language: 'en',
    poster_path: '/path/poster.jpg',
  }),
  buildImageUrl: vi.fn(() => 'https://image.tmdb.org/t/p/w500/path/poster.jpg'),
}

const mockCompletenessService = {
  analyzeSeries: vi.fn().mockResolvedValue({
    id: 1,
    series_title: 'Breaking Bad',
    series_identity_key: 'tmdb:1396',
    completeness_percentage: 100,
  }),
}

vi.mock('../../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => mockDb),
}))

vi.mock('../../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => mockTMDB),
}))

vi.mock('../../../src/main/services/SeriesCompletenessService', () => ({
  getSeriesCompletenessService: vi.fn(() => mockCompletenessService),
}))

vi.mock('../../../src/main/services/TaskQueueService', () => ({
  getTaskQueueService: vi.fn(() => ({
    hasActiveTask: vi.fn(() => false),
  })),
}))

import { registerSeriesHandlers } from '../../../src/main/ipc/series'

describe('series:fixMatch IPC Handler', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    registerSeriesHandlers()
  })

  it('successfully fixes series match when given canonical identity, source, library, and positive tmdbId', async () => {
    const handler = handlers.get('series:fixMatch')
    expect(handler).toBeDefined()

    const result = await handler!(
      { senderFrame: { url: 'file:///test' } } as any,
      'tmdb:99999',
      'plex-src-1',
      'lib-tv-1',
      1396
    )

    expect(mockTMDB.getTVShowDetails).toHaveBeenCalledWith('1396')
    expect(mockDb.updateSeriesMatch).toHaveBeenCalledWith(
      'tmdb:99999',
      'plex-src-1',
      'lib-tv-1',
      '1396',
      'https://image.tmdb.org/t/p/w500/path/poster.jpg',
      'Breaking Bad',
      'en'
    )
    expect(mockCompletenessService.analyzeSeries).toHaveBeenCalledWith(
      'tmdb:1396',
      'plex-src-1',
      'lib-tv-1',
      '1396'
    )

    expect(result).toEqual({
      success: true,
      updatedEpisodes: 5,
      completeness: expect.objectContaining({
        series_identity_key: 'tmdb:1396',
      }),
      newTitle: 'Breaking Bad',
      newIdentityKey: 'tmdb:1396',
    })
  })

  it('rejects raw title without canonical prefix', async () => {
    const handler = handlers.get('series:fixMatch')
    expect(handler).toBeDefined()

    await expect(
      handler!({ senderFrame: { url: 'file:///test' } } as any, 'Breaking Bad', 'src-1', 'lib-1', 1396)
    ).rejects.toThrow(/seriesIdentityKey must be a canonical key starting with tmdb:, tvdb:, or unresolved:/)
  })

  it('rejects empty seriesIdentityKey', async () => {
    const handler = handlers.get('series:fixMatch')
    expect(handler).toBeDefined()

    await expect(
      handler!({ senderFrame: { url: 'file:///test' } } as any, '', 'src-1', 'lib-1', 1396)
    ).rejects.toThrow(/seriesIdentityKey/)
  })

  it('successfully fixes series match when libraryId is undefined or empty string', async () => {
    const handler = handlers.get('series:fixMatch')
    expect(handler).toBeDefined()

    const result = await handler!(
      { senderFrame: { url: 'file:///test' } } as any,
      'tmdb:99999',
      'plex-src-1',
      undefined,
      1396
    )

    expect(mockDb.updateSeriesMatch).toHaveBeenCalledWith(
      'tmdb:99999',
      'plex-src-1',
      undefined,
      '1396',
      'https://image.tmdb.org/t/p/w500/path/poster.jpg',
      'Breaking Bad',
      'en'
    )
    expect(mockCompletenessService.analyzeSeries).toHaveBeenCalledWith(
      'tmdb:1396',
      'plex-src-1',
      undefined,
      '1396'
    )
    expect(result.success).toBe(true)
  })

  it('rejects empty or missing sourceId', async () => {
    const handler = handlers.get('series:fixMatch')
    expect(handler).toBeDefined()

    await expect(
      handler!({ senderFrame: { url: 'file:///test' } } as any, 'tmdb:12345', '', 'lib-1', 1396)
    ).rejects.toThrow(/sourceId/)
  })

  it('rejects invalid or non-positive tmdbId', async () => {
    const handler = handlers.get('series:fixMatch')
    expect(handler).toBeDefined()

    await expect(
      handler!({ senderFrame: { url: 'file:///test' } } as any, 'tmdb:12345', 'src-1', 'lib-1', -1)
    ).rejects.toThrow(/tmdbId/)

    await expect(
      handler!({ senderFrame: { url: 'file:///test' } } as any, 'tmdb:12345', 'src-1', 'lib-1', '1396')
    ).rejects.toThrow(/tmdbId/)
  })
})
