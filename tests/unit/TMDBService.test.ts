/**
 * TMDBService Unit Tests
 *
 * Tests for TMDB API integration including caching,
 * rate limiting, and API methods.
 *
 * Uses real in-memory database for settings.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TMDBService } from '../../src/main/services/TMDBService'
import { BetterSQLiteService } from '../../src/main/database/BetterSQLiteService'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock RateLimiter to speed up tests
vi.mock('../../src/main/services/utils/RateLimiter', () => ({
  RateLimiters: {
    createTMDBLimiter: vi.fn(() => ({
      waitForSlot: vi.fn(() => Promise.resolve()),
    })),
  },
  SlidingWindowRateLimiter: vi.fn(),
}))

// Intercept getDatabase
let testDb: BetterSQLiteService

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => testDb),
}))

describe('TMDBService', () => {
  let service: TMDBService

  beforeEach(async () => {
    testDb = new BetterSQLiteService(':memory:')
    testDb.initialize()
    testDb.setSetting('tmdb_api_key', 'test-api-key-12345')

    vi.clearAllMocks()
    mockFetch.mockReset()
    
    service = new TMDBService()
    await service.initialize()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('initialization', () => {
    it('should initialize with API key from settings', async () => {
      await service.initialize()
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 550, title: 'Fight Club' }),
      })

      await service.getMovieDetails('550')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api_key=test-api-key-12345'),
        expect.any(Object)
      )
    })

    it('should throw error when making requests without API key', async () => {
      testDb.setSetting('tmdb_api_key', '')
      const unconfiguredService = new TMDBService()
      await unconfiguredService.initialize()
      
      await expect(unconfiguredService.getMovieDetails('550')).rejects.toThrow('TMDB API key not configured')
    })
  })

  describe('movie API', () => {
    it('should fetch movie details', async () => {
      const mockMovie = { id: 550, title: 'Fight Club', release_date: '1999-10-15' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMovie),
      })

      const movie = await service.getMovieDetails('550')
      expect(movie).toEqual(mockMovie)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/movie/550'),
        expect.any(Object)
      )
    })

    it('should search movies by title and year', async () => {
      const mockResults = { results: [{ id: 550, title: 'Fight Club' }], total_results: 1 }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResults),
      })

      const results = await service.searchMovie('Fight Club', 1999)
      expect(results).toEqual(mockResults)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=Fight+Club'),
        expect.any(Object)
      )
    })
  })

  describe('caching', () => {
    it('should cache responses and return cached data on second call', async () => {
      const mockMovie = { id: 550, title: 'Fight Club' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMovie),
      })

      await service.getMovieDetails('550')
      await service.getMovieDetails('550')

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should clear cache', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 550 }),
      })

      await service.getMovieDetails('550')
      service.clearCache()
      await service.getMovieDetails('550')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ status_message: 'Not Found' })
      })

      await expect(service.getMovieDetails('999999999')).rejects.toThrow('TMDB API Error: Not Found')
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))
      await expect(service.getMovieDetails('550')).rejects.toThrow('Network failure')
    })
  })
})
