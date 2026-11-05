/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchJSON = vi.hoisted(() => vi.fn())
const mockFetchWithTimeout = vi.hoisted(() => vi.fn())
const mockGetMediaItems = vi.hoisted(() => vi.fn((): Array<{ id: number; plex_id: string }> => []))
const mockDeleteMediaItem = vi.hoisted(() => vi.fn())
const mockCountMediaItems = vi.hoisted(() => vi.fn(() => 0))

vi.mock('../../src/main/services/utils/httpClient', () => ({
  fetchJSON: mockFetchJSON,
  fetchWithTimeout: mockFetchWithTimeout,
  buildUrl: (base: string, params?: Record<string, unknown>) => {
    if (!params) return base
    const qs = Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&')
    return qs ? `${base}?${qs}` : base
  },
  isHttpError: vi.fn((e: any) => e && typeof e.status === 'number'),
  HttpError: class HttpError extends Error { status: number; data: any; constructor(s: number, d: any) { super(); this.status = s; this.data = d } },
}))

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
    getMediaItems: mockGetMediaItems,
    upsertMediaItem: vi.fn(),
    deleteMediaItem: mockDeleteMediaItem,
    countMediaItems: mockCountMediaItems,
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    getLibraryScan: vi.fn(() => null),
    upsertLibraryScan: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({
    loadThresholdsFromDatabase: vi.fn(),
    analyzeMediaItem: vi.fn(),
    analyzeVersion: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: vi.fn(() => ({
    analyzeFile: vi.fn(),
    analyzeWithWorker: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({
    initialize: vi.fn(),
    searchMovie: vi.fn(() => null),
    searchTVShow: vi.fn(() => null),
  })),
}))

vi.mock('../../src/main/services/FileNameParser', () => ({
  getFileNameParser: vi.fn(() => ({
    parse: vi.fn(() => null),
  })),
}))

vi.mock('../../src/main/services/MovieCollectionService', () => ({
  getMovieCollectionService: vi.fn(() => ({
    processCollectionsFromProvider: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))

vi.mock('../../src/main/services/utils/retryWithBackoff', () => ({
  retryWithBackoff: vi.fn((fn: () => any) => fn()),
}))

import { JellyfinProvider } from '@main/providers/jellyfin-emby/JellyfinProvider'

const makeConfig = (overrides: Record<string, any> = {}) => ({
  sourceId: 'test-jf',
  connectionConfig: {
    serverUrl: 'http://localhost:8096',
    apiKey: 'test-api-key',
    accessToken: '',
    userId: 'user-1',
    ...overrides,
  },
})

describe('JellyfinEmbyBase (via JellyfinProvider)', () => {
  let provider: JellyfinProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new JellyfinProvider(makeConfig())
  })

  describe('music scan errors', () => {
    it('reports artist-processing failures rather than marking the scan successful', async () => {
      vi.spyOn(provider, 'getMusicArtists').mockResolvedValue([{ Id: 'artist-1', Name: 'Test Artist' }] as any)
      vi.spyOn(provider, 'getMusicAlbums').mockResolvedValue([])
      vi.spyOn(provider as any, 'convertToMusicArtist').mockImplementation(() => {
        throw new Error('Invalid artist metadata')
      })

      const result = await provider.scanMusicLibrary('music-library')

      expect(result.success).toBe(false)
      expect(result.errors).toEqual(['Failed to process artist Test Artist: Invalid artist metadata'])
      expect(result.itemsRemoved).toBe(0)
    })
  })

  describe('scan library identity', () => {
    it('fails when the requested library is no longer on the server', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([])
      const result = await provider.scanLibrary('missing-library')
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Library missing-library not found')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('fails instead of treating an unsupported library as movies', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'music-library', type: 'music' }] as any)
      const result = await provider.scanLibrary('music-library')
      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('type music as video')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })
  })

  describe('incomplete inventory reconciliation safety', () => {
    it('advances to the next actual item offset when pages are shorter than requested', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'library-1', type: 'movie' }] as any)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1', Type: 'Movie' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'film-2', Type: 'Movie' }], TotalRecordCount: 2 })

      await provider.scanLibrary('library-1')

      const inventoryRequests = mockFetchJSON.mock.calls.filter(([url]) =>
        String(url).includes('ParentId=library-1') && String(url).includes('StartIndex=')
      )
      expect(inventoryRequests).toHaveLength(2)
      expect(inventoryRequests[0][0]).toContain('StartIndex=0')
      expect(inventoryRequests[1][0]).toContain('StartIndex=1')
    })

    it('reports sourceless media as an incomplete scan instead of deleting stored records', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'library-1', type: 'movie' }] as any)
      mockFetchJSON.mockResolvedValueOnce({
        Items: [{ Id: 'film-1', Name: 'Unresolved movie', Type: 'Movie', MediaSources: [] }],
        TotalRecordCount: 1,
      })
      mockGetMediaItems.mockReturnValueOnce([{ id: 12, plex_id: 'film-1' }])

      const result = await provider.scanLibrary('library-1')

      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('No media sources returned for Unresolved movie')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('rejects prematurely empty inventory pages', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'library-1', type: 'movie' }] as any)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1', Type: 'Movie' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 2 })

      const result = await provider.scanLibrary('library-1')

      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Incomplete jellyfin library inventory')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('rejects a partial ID inventory before deletion reconciliation', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 2 })

      await expect((provider as any).getAllLibraryItemIds('library-1', 'movie'))
        .rejects.toThrow('Incomplete jellyfin deletion inventory')
    })

    it('rejects collections whose child list exceeds the returned page', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'library-1', type: 'movie', collectionType: 'boxsets' }] as any)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'box-1', ProviderIds: {} }], TotalRecordCount: 1 })
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 2 })

      const result = await provider.scanLibrary('library-1')

      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('Incomplete jellyfin collection box-1')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('requests subsequent collection pages instead of assuming a 1000-item limit is complete', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'library-1', type: 'movie', collectionType: 'boxsets' }] as any)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'box-1', ProviderIds: {} }], TotalRecordCount: 1 })
        .mockResolvedValueOnce({ Items: [{ Id: 'film-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'film-2' }], TotalRecordCount: 2 })

      await provider.scanLibrary('library-1')

      const childRequests = mockFetchJSON.mock.calls.filter(([url]) => String(url).includes('ParentId=box-1'))
      expect(childRequests).toHaveLength(2)
      expect(childRequests[0][0]).toContain('StartIndex=0')
      expect(childRequests[1][0]).toContain('StartIndex=1')
    })

    it('fails an incremental scan when a zero server count conflicts with stored media', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'library-1', type: 'movie' }] as any)
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
      mockCountMediaItems.mockReturnValueOnce(1)

      const result = await provider.scanLibrary('library-1', { sinceTimestamp: new Date('2026-01-01T00:00:00Z') })

      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('server reported no items while 1 are stored')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })

    it('fails instead of marking empty inventory successful when stored media exists', async () => {
      vi.spyOn(provider, 'getLibraries').mockResolvedValue([{ id: 'library-1', type: 'movie' }] as any)
      mockFetchJSON.mockResolvedValueOnce({ Items: [], TotalRecordCount: 0 })
      mockGetMediaItems.mockReturnValueOnce([{ id: 12, plex_id: 'stored-1' }])

      const result = await provider.scanLibrary('library-1')

      expect(result.success).toBe(false)
      expect(result.errors.join(' ')).toContain('server returned no items while 1 are stored')
      expect(mockDeleteMediaItem).not.toHaveBeenCalled()
    })
  })

  describe('music pagination', () => {
    it('retrieves album artists after a short nonterminal page', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'artist-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'artist-2' }], TotalRecordCount: 2 })
      const artists = await provider.getMusicArtists('music-library')
      expect(artists.map(artist => artist.Id)).toEqual(['artist-1', 'artist-2'])
      expect(String(mockFetchJSON.mock.calls[1][0])).toContain('StartIndex=1')
    })

    it('retrieves albums after a short nonterminal page', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'album-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'album-2' }], TotalRecordCount: 2 })
      const albums = await provider.getMusicAlbums('music-library')
      expect(albums.map(album => album.Id)).toEqual(['album-1', 'album-2'])
      expect(String(mockFetchJSON.mock.calls[1][0])).toContain('StartIndex=1')
    })

    it('retrieves every album track using counted pages', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'track-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [{ Id: 'track-2' }], TotalRecordCount: 2 })
      const tracks = await provider.getMusicTracks('album-1')
      expect(tracks.map(track => track.Id)).toEqual(['track-1', 'track-2'])
      expect(String(mockFetchJSON.mock.calls[1][0])).toContain('StartIndex=1')
    })

    it('fails a truncated artist inventory rather than returning partial results', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'artist-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 2 })
      await expect(provider.getMusicArtists('music-library')).rejects.toThrow('Failed to fetch music artists')
    })

    it('fails a truncated track inventory rather than returning partial results', async () => {
      mockFetchJSON
        .mockResolvedValueOnce({ Items: [{ Id: 'track-1' }], TotalRecordCount: 2 })
        .mockResolvedValueOnce({ Items: [], TotalRecordCount: 2 })
      await expect(provider.getMusicTracks('album-1')).rejects.toThrow('Failed to fetch music tracks')
    })
  })

  // ==========================================================================
  // buildImageUrl (protected — access via any cast)
  // ==========================================================================
  describe('buildImageUrl', () => {
    it('builds correct URL structure', () => {
      const url = (provider as any).buildImageUrl('item-123', 'Primary')
      expect(url).toBe('http://localhost:8096/Items/item-123/Images/Primary?api_key=test-api-key')
    })

    it('includes tag param when provided', () => {
      const url = (provider as any).buildImageUrl('item-123', 'Primary', 'tag-abc')
      expect(url).toContain('tag=tag-abc')
      expect(url).toContain('api_key=test-api-key')
    })

    it('returns empty string for missing serverUrl', () => {
      const p = new JellyfinProvider(makeConfig({ serverUrl: '' }))
      expect((p as any).buildImageUrl('item-123', 'Primary')).toBe('')
    })

    it('returns empty string for missing itemId', () => {
      expect((provider as any).buildImageUrl('', 'Primary')).toBe('')
    })

    it('uses accessToken when apiKey is empty', () => {
      const p = new JellyfinProvider(makeConfig({ apiKey: '', accessToken: 'tok-123' }))
      const url = (p as any).buildImageUrl('item-1', 'Primary')
      expect(url).toContain('api_key=tok-123')
    })
  })

  // ==========================================================================
  // mapLibraryType (protected)
  // ==========================================================================
  describe('mapLibraryType', () => {
    it('maps movies', () => {
      expect((provider as any).mapLibraryType('movies')).toBe('movie')
    })

    it('maps homevideos to movie', () => {
      expect((provider as any).mapLibraryType('homevideos')).toBe('movie')
    })

    it('maps tvshows', () => {
      expect((provider as any).mapLibraryType('tvshows')).toBe('show')
    })

    it('maps music', () => {
      expect((provider as any).mapLibraryType('music')).toBe('music')
    })

    it('returns unknown for undefined', () => {
      expect((provider as any).mapLibraryType(undefined)).toBe('unknown')
    })

    it('returns unknown for unrecognized type', () => {
      expect((provider as any).mapLibraryType('photos')).toBe('unknown')
    })
  })

  // ==========================================================================
  // buildAuthHeader (protected)
  // ==========================================================================
  describe('buildAuthHeader', () => {
    it('includes client name and device', () => {
      const p = new JellyfinProvider(makeConfig({ accessToken: 'tok' }))
      const header = (p as any).buildAuthHeader()
      expect(header).toContain('Client="Totality"')
      expect(header).toContain('Device="Totality"')
    })

    it('includes token when accessToken set', () => {
      const p = new JellyfinProvider(makeConfig({ accessToken: 'tok-abc' }))
      const header = (p as any).buildAuthHeader()
      expect(header).toContain('Token="tok-abc"')
    })

    it('omits token when accessToken empty', () => {
      const header = (provider as any).buildAuthHeader()
      expect(header).not.toContain('Token=')
    })
  })

  // ==========================================================================
  // getAuthHeaders (protected)
  // ==========================================================================
  describe('getAuthHeaders', () => {
    it('uses API key when no access token', () => {
      const headers = (provider as any).getAuthHeaders()
      expect(headers['X-Emby-Token']).toBe('test-api-key')
    })

    it('uses auth header when access token present', () => {
      const p = new JellyfinProvider(makeConfig({ accessToken: 'tok', apiKey: '' }))
      const headers = (p as any).getAuthHeaders()
      expect(headers['Authorization']).toBeDefined()
      expect(headers['X-Emby-Token']).toBeUndefined()
    })
  })

  // ==========================================================================
  // authenticate
  // ==========================================================================
  describe('authenticate', () => {
    it('requires serverUrl', async () => {
      const result = await provider.authenticate({ serverUrl: '' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('Server URL')
    })

    it('succeeds with API key', async () => {
      mockFetchJSON.mockResolvedValueOnce({ ServerName: 'Test', Id: 'srv-1' })
      const result = await provider.authenticate({
        serverUrl: 'http://localhost:8096',
        apiKey: 'key-123',
      })
      expect(result.success).toBe(true)
    })
  })

  // ==========================================================================
  // testConnection
  // ==========================================================================
  describe('testConnection', () => {
    it('succeeds when server responds', async () => {
      mockFetchJSON.mockResolvedValueOnce({ ServerName: 'Test', Version: '10.8.0' })
      const result = await provider.testConnection()
      expect(result.success).toBe(true)
      expect(result.serverName).toBe('Test')
    })

    it('fails on network error', async () => {
      mockFetchJSON.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const result = await provider.testConnection()
      expect(result.success).toBe(false)
    })
  })
})
