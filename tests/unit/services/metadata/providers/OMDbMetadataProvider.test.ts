import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { OMDbMetadataProvider } from '../../../../../src/main/services/metadata/providers/OMDbMetadataProvider'
import { getLoggingService } from '../../../../../src/main/services/LoggingService'

const mockLogger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}

vi.mock('../../../../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => mockLogger),
}))

describe('OMDbMetadataProvider', () => {
  let provider: OMDbMetadataProvider
  let mockApiKeyGetter: Mock
  let mockFetch: Mock

  beforeEach(() => {
    mockApiKeyGetter = vi.fn(() => 'test-api-key')
    provider = new OMDbMetadataProvider(mockApiKeyGetter)
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('search', () => {
    it('should return empty array if api key is empty', async () => {
      mockApiKeyGetter.mockReturnValueOnce('')
      const result = await provider.search({ title: 'test', type: 'movie' })
      expect(result).toEqual([])
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return empty array on fetch error status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      const result = await provider.search({ title: 'test', type: 'movie' })
      expect(result).toEqual([])
      const logger = getLoggingService()
      expect(logger.error).toHaveBeenCalledWith('[OMDbMetadataProvider]', 'Search HTTP 500 for query: test')
    })

    it('should return empty array if response is False', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ Response: 'False' }),
      })
      const result = await provider.search({ title: 'test', type: 'movie' })
      expect(result).toEqual([])
    })

    it('should return empty array if Search is not an array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ Response: 'True', Search: 'not-an-array' }),
      })
      const result = await provider.search({ title: 'test', type: 'movie' })
      expect(result).toEqual([])
    })

    it('should return mapped results successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({
          Response: 'True',
          Search: [
            { imdbID: 'tt123', Title: 'Movie 1', Year: '2020', Poster: 'http://poster1.jpg' },
            { imdbID: 'tt456', Title: 'Movie 2', Year: 'N/A', Poster: 'N/A' },
            { imdbID: 'tt789', Title: 'Movie 3' }
          ]
        }),
      })
      const result = await provider.search({ title: 'Movie', type: 'movie', year: 2020 })
      expect(mockFetch).toHaveBeenCalledWith('https://www.omdbapi.com/?apikey=test-api-key&s=Movie&y=2020&type=movie')

      expect(result).toHaveLength(3)

      expect(result[0]).toEqual({
        id: 'tt123',
        provider: 'omdb',
        title: 'Movie 1',
        year: 2020,
        type: 'movie',
        posterUrl: 'http://poster1.jpg',
        overview: undefined,
        externalIds: { imdbId: 'tt123' },
      })

      expect(result[1]).toEqual({
        id: 'tt456',
        provider: 'omdb',
        title: 'Movie 2',
        year: NaN, // parseInt('N/A'.slice(0,4)) evaluates to NaN
        type: 'movie',
        posterUrl: undefined,
        overview: undefined,
        externalIds: { imdbId: 'tt456' },
      })

      expect(result[2]).toEqual({
        id: 'tt789',
        provider: 'omdb',
        title: 'Movie 3',
        year: undefined,
        type: 'movie',
        posterUrl: undefined,
        overview: undefined,
        externalIds: { imdbId: 'tt789' },
      })
    })

    it('should handle tv series type query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ Response: 'True', Search: [] }),
      })
      await provider.search({ title: 'TV Show', type: 'tv' })
      expect(mockFetch).toHaveBeenCalledWith('https://www.omdbapi.com/?apikey=test-api-key&s=TV%20Show&type=series')
    })

    it('should catch exceptions and return empty array', async () => {
      const error = new Error('Network Error')
      mockFetch.mockRejectedValueOnce(error)
      const result = await provider.search({ title: 'test', type: 'movie' })
      expect(result).toEqual([])
      const logger = getLoggingService()
      expect(logger.error).toHaveBeenCalledWith('[OMDbMetadataProvider]', 'Search error:', error)
    })
  })

  describe('getDetails', () => {
    it('should return null if api key is empty', async () => {
      mockApiKeyGetter.mockReturnValueOnce('')
      const result = await provider.getDetails('tt123', 'movie')
      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return null if externalId is empty', async () => {
      const result = await provider.getDetails('', 'movie')
      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return null on fetch error status', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      const result = await provider.getDetails('tt123', 'movie')
      expect(result).toBeNull()
      const logger = getLoggingService()
      expect(logger.error).toHaveBeenCalledWith('[OMDbMetadataProvider]', 'Details HTTP 404 for ID: tt123')
    })

    it('should return null if response is False', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({ Response: 'False' }),
      })
      const result = await provider.getDetails('tt123', 'movie')
      expect(result).toBeNull()
    })

    it('should map valid item to MediaMetadataDetails', async () => {
      const mockItem = {
        Response: 'True',
        imdbID: 'tt12345',
        Title: 'The Matrix',
        Year: '1999',
        Poster: 'http://poster.jpg',
        Plot: 'A computer hacker learns...',
        imdbRating: '8.7',
        imdbVotes: '1,000,000',
        Rated: 'R',
        Awards: '4 Oscars',
        Genre: 'Action, Sci-Fi'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockItem),
      })

      const result = await provider.getDetails('tt12345', 'movie')
      expect(mockFetch).toHaveBeenCalledWith('https://www.omdbapi.com/?apikey=test-api-key&i=tt12345&plot=full')

      expect(result).toEqual({
        id: 'tt12345',
        provider: 'omdb',
        title: 'The Matrix',
        year: 1999,
        type: 'movie',
        posterUrl: 'http://poster.jpg',
        overview: 'A computer hacker learns...',
        score: 8.7,
        imdbRating: 8.7,
        imdbVotes: '1,000,000',
        contentRating: 'R',
        awards: '4 Oscars',
        genres: ['Action', 'Sci-Fi'],
        externalIds: { imdbId: 'tt12345' },
        raw: mockItem,
      })
    })

    it('should correctly handle N/A values', async () => {
      const mockItemNA = {
        Response: 'True',
        imdbID: 'tt12345',
        Title: 'The Matrix',
        Year: '1999',
        Poster: 'N/A',
        Plot: 'N/A',
        imdbRating: 'N/A',
        imdbVotes: 'N/A',
        Rated: 'N/A',
        Awards: 'N/A',
        Genre: 'N/A'
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce(mockItemNA),
      })

      const result = await provider.getDetails('tt12345', 'movie')
      expect(result).toEqual({
        id: 'tt12345',
        provider: 'omdb',
        title: 'The Matrix',
        year: 1999,
        type: 'movie',
        posterUrl: undefined,
        overview: undefined,
        score: undefined,
        imdbRating: undefined,
        imdbVotes: undefined,
        contentRating: undefined,
        awards: undefined,
        genres: [],
        externalIds: { imdbId: 'tt12345' },
        raw: mockItemNA,
      })
    })

    it('should catch exceptions and return null', async () => {
      const error = new Error('Network Error')
      mockFetch.mockRejectedValueOnce(error)
      const result = await provider.getDetails('tt123', 'movie')
      expect(result).toBeNull()
      const logger = getLoggingService()
      expect(logger.error).toHaveBeenCalledWith('[OMDbMetadataProvider]', 'Details error:', error)
    })
  })

  describe('findByExternalId', () => {
    it('should return null if source is not imdb_id', async () => {
      const result = await provider.findByExternalId('123', 'tvdb_id', 'movie')
      expect(result).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should call getDetails if source is imdb_id', async () => {
      // Mock getDetails on the instance
      vi.spyOn(provider, 'getDetails').mockResolvedValueOnce({ id: 'tt123' } as any)

      const result = await provider.findByExternalId('tt123', 'imdb_id', 'movie')
      expect(provider.getDetails).toHaveBeenCalledWith('tt123', 'movie')
      expect(result).toEqual({ id: 'tt123' })
    })
  })
})
