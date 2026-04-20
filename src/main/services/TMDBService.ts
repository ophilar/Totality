import {
  TMDBMovieDetails,
  TMDBCollection,
  TMDBTVShowDetails,
  TMDBSeasonDetails,
  TMDBEpisode,
  TMDBSearchResponse,
  TMDBMovieSearchResult,
  TMDBTVSearchResult,
  TMDBCollectionSearchResult,
  TMDBConfiguration,
  TMDBGenre,
  TMDBGenreListResponse,
} from '../types/tmdb'
import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from './LoggingService'
import { getGeminiService } from './GeminiService'
import { RateLimiters, SlidingWindowRateLimiter } from './utils/RateLimiter'
import { retryWithBackoff, getRateLimitRetryAfter } from './utils/retryWithBackoff'

/**
 * TMDB API v3 Service with rate limiting and caching
 * Rate limit: ~40 requests per second per IP
 * API Documentation: https://developer.themoviedb.org/reference/intro/getting-started
 */
export class TMDBService {
  private static get BASE_URL(): string {
    const db = getDatabase()
    return db.getSetting('tmdb_base_url') || 'https://api.themoviedb.org/3'
  }
  private static readonly IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/'
  private static readonly CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
  private static readonly MAX_CONCURRENT = 10 // Max concurrent requests
  private static readonly REQUEST_TIMEOUT = 30000 // 30 second timeout for API requests
  private static readonly MAX_CACHE_SIZE = 1000 // Max cache entries to prevent unbounded memory growth

  private apiKey: string | null = null
  private movieGenres: TMDBGenre[] | null = null
  private tvGenres: TMDBGenre[] | null = null
  private cache: Map<string, { data: unknown; timestamp: number }> = new Map()
  private rateLimiter: SlidingWindowRateLimiter = RateLimiters.createTMDBLimiter()
  private activeRequests = 0
  private requestQueue: Array<{ execute: () => Promise<void>; resolve: () => void }> = []

  /**
   * Initialize service with API key from settings
   */
  async initialize(): Promise<void> {
    const db = getDatabase()
    const setting = db.getSetting('tmdb_api_key')
    this.apiKey = setting || null

    if (!this.apiKey || this.apiKey === '') {
      getLoggingService().warn('[TMDBService]', 'TMDB API key not configured. Collection detection will be unavailable.')
    }
  }

  /**
   * Refresh API key from database (called when settings change)
   */
  refreshApiKey(): void {
    const db = getDatabase()
    const setting = db.getSetting('tmdb_api_key')
    this.apiKey = setting || null
  }

  /**
   * Get TMDB API key from settings
   */
  private getApiKey(): string {
    if (!this.apiKey || this.apiKey === '') {
      throw new Error('TMDB API key not configured. Please add your API key in settings.')
    }
    return this.apiKey
  }

  /**
   * Rate limiting: Wait for a request slot
   * Uses shared SlidingWindowRateLimiter (40 requests per second)
   */
  private async waitForRateLimit(): Promise<void> {
    await this.rateLimiter.waitForSlot()
  }

  /**
   * Process the next item in the request queue
   */
  private processQueue(): void {
    if (this.requestQueue.length === 0) return
    if (this.activeRequests >= TMDBService.MAX_CONCURRENT) return

    const next = this.requestQueue.shift()
    if (next) {
      this.activeRequests++
      next.execute().finally(() => {
        this.activeRequests--
        next.resolve()
        this.processQueue()
      })
    }
  }

  /**
   * Queue a request for execution with concurrency control
   * Allows up to MAX_CONCURRENT requests at a time
   */
  async queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async (): Promise<void> => {
        try {
          const result = await requestFn()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }

      this.requestQueue.push({
        execute,
        resolve: () => {} // Placeholder, actual resolution in execute
      })

      this.processQueue()
    })
  }

  /**
   * Make multiple requests in parallel with rate limiting
   * Useful for batch processing
   */
  async batchRequest<T>(requests: Array<() => Promise<T>>): Promise<Array<PromiseSettledResult<T>>> {
    return Promise.allSettled(
      requests.map(reqFn => this.queueRequest(reqFn))
    )
  }

  /**
   * Cache management: Get from cache or return null
   */
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key)

    if (cached && Date.now() - cached.timestamp < TMDBService.CACHE_DURATION) {
      return cached.data as T
    }

    // Remove expired cache
    if (cached) {
      this.cache.delete(key)
    }

    return null
  }

  /**
   * Cache management: Store in cache
   */
  private setCache(key: string, data: unknown): void {
    // Evict oldest entries when cache exceeds max size
    if (this.cache.size >= TMDBService.MAX_CACHE_SIZE) {
      let oldest: string | null = null
      let oldestTime = Infinity
      for (const [k, v] of this.cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp
          oldest = k
        }
      }
      if (oldest) this.cache.delete(oldest)
    }
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })
  }

  /**
   * Make API request with rate limiting, caching, and retry with exponential backoff
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string> = {}
  ): Promise<T> {
    const apiKey = this.getApiKey()

    // Build cache key
    const cacheKey = `${endpoint}?${new URLSearchParams(params).toString()}`

    // Check cache
    const cached = this.getFromCache<T>(cacheKey)
    if (cached) {
      getLoggingService().verbose('[TMDB]', `Cache hit: ${endpoint}`)
      return cached
    }

    // Apply rate limiting
    await this.waitForRateLimit()

    // Build URL
    const url = new URL(`${TMDBService.BASE_URL}${endpoint}`)
    url.searchParams.append('api_key', apiKey)
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, value)
    })

    const urlForLogging = url.toString().replace(apiKey, 'API_KEY')

    // Track rate limit delay from Retry-After header for retry backoff
    const retryState = { minRetryDelay: 0 }

    // Make request with retry logic and timeout
    const data = await retryWithBackoff<T>(
      async () => {
        getLoggingService().info('[TMDBService]', '[TMDB] Requesting:', urlForLogging)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), TMDBService.REQUEST_TIMEOUT)

        let response: Response
        try {
          response = await fetch(url.toString(), { signal: controller.signal })
        } catch (error: unknown) {
          clearTimeout(timeoutId)
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('TMDB API request timed out')
          }
          throw error
        } finally {
          clearTimeout(timeoutId)
        }

        // Handle rate limiting with Retry-After header
        const rateLimitDelay = getRateLimitRetryAfter(response)
        if (rateLimitDelay !== null) {
          getLoggingService().verbose('[TMDB]', `Rate limited, retry after ${rateLimitDelay}ms`)
          getLoggingService().warn('[TMDB]', `Rate limited, retry after ${rateLimitDelay}ms`)
          // Pass server's delay to retry backoff as minimum floor
          retryState.minRetryDelay = rateLimitDelay
          const error = new Error(`TMDB rate limited (429)`) as Error & { status: number }
          error.status = 429
          throw error
        }

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}))
          getLoggingService().error('[TMDBService]', '[TMDB] Error response:', errorBody)
          const error = new Error(`TMDB API Error: ${errorBody.status_message || response.statusText}`) as Error & { status: number }
          error.status = response.status
          throw error
        }

        const result = await response.json()
        getLoggingService().info('[TMDBService]', '[TMDB] Response for', endpoint, '- total_results:', (result as { total_results?: number }).total_results)
        return result as T
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
        get minRetryDelay() { return retryState.minRetryDelay },
        onRetry: (attempt, error, delay) => {
          getLoggingService().warn('[TMDB]', `Retry ${attempt}/3 for ${urlForLogging} after ${delay}ms: ${error.message}`)
        }
      }
    )

    // Cache the response
    this.setCache(cacheKey, data)

    return data
  }

  /**
   * Get movie details by TMDB ID
   */
  async getMovieDetails(tmdbId: string): Promise<TMDBMovieDetails> {
    const data = await this.request<TMDBMovieDetails>(`/movie/${tmdbId}`)
    return data
  }

  /**
   * Get collection details by collection ID
   */
  async getCollectionDetails(collectionId: string): Promise<TMDBCollection> {
    return await this.request<TMDBCollection>(`/collection/${collectionId}`)
  }

  /**
   * Get TV show details by TMDB ID
   */
  async getTVShowDetails(tmdbId: string): Promise<TMDBTVShowDetails> {
    const data = await this.request<TMDBTVShowDetails>(`/tv/${tmdbId}`)
    return data
  }

  /**
   * Get TV show details with all season episode data in ONE API call
   * Uses append_to_response to fetch up to 20 seasons at once
   * This is MUCH faster than calling getSeasonDetails for each season
   */
  async getTVShowWithSeasons(tmdbId: string, seasonNumbers: number[]): Promise<TMDBTVShowDetails & { [key: string]: TMDBSeasonDetails }> {
    // TMDB limits append_to_response to 20 items
    const MAX_APPEND = 20
    const seasonsToAppend = seasonNumbers.slice(0, MAX_APPEND)

    // Build append_to_response parameter: season/1,season/2,season/3,...
    const appendParam = seasonsToAppend.map(n => `season/${n}`).join(',')

    const result = await this.request<TMDBTVShowDetails & { [key: string]: TMDBSeasonDetails }>(
      `/tv/${tmdbId}`,
      { append_to_response: appendParam }
    )

    return result
  }

  /**
   * Get TV season details
   */
  async getSeasonDetails(tmdbId: string, seasonNumber: number): Promise<TMDBSeasonDetails> {
    return await this.request<TMDBSeasonDetails>(`/tv/${tmdbId}/season/${seasonNumber}`)
  }

  /**
   * Get TV episode details
   */
  async getEpisodeDetails(tmdbId: string | number, seasonNumber: number, episodeNumber: number): Promise<TMDBEpisode> {
    return await this.request<TMDBEpisode>(`/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`)
  }

  /**
   * Search for TV show and get episode details in optimized way
   * First searches for series, then gets episode details
   * Caches series ID for subsequent episode lookups
   */
  async searchAndGetEpisode(
    seriesTitle: string,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<{ seriesTmdbId: number; episode: TMDBEpisode; seriesName: string } | null> {
    try {
      // Search for the series
      const searchResponse = await this.searchTVShow(seriesTitle)
      if (!searchResponse.results || searchResponse.results.length === 0) {
        return null
      }

      const series = searchResponse.results[0]
      const seriesTmdbId = series.id
      const seriesName = series.name

      // Get episode details
      const episode = await this.getEpisodeDetails(seriesTmdbId, seasonNumber, episodeNumber)

      return { seriesTmdbId, episode, seriesName }
    } catch (error) {
      // Episode might not exist in TMDB
      return null
    }
  }

  /**
   * Multi-strategy TMDB movie search with fuzzy year matching and AI disambiguation
   */
  async searchMovieWithFallbacks(
    originalTitle: string,
    normalizedTitle: string,
    year: number | undefined
  ): Promise<{ tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null> {
    // Helper to find best match from results
    const findBestMatch = (
      results: Array<{ id: number; title: string; release_date?: string; poster_path?: string | null; backdrop_path?: string | null }>,
      targetYear?: number
    ): { tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null => {
      if (!results || results.length === 0) return null

      if (targetYear) {
        // First try exact year match
        const exactMatch = results.find(r => r.release_date?.startsWith(String(targetYear)))
        if (exactMatch) {
          return {
            tmdbId: exactMatch.id,
            title: exactMatch.title,
            year: exactMatch.release_date ? parseInt(exactMatch.release_date.split('-')[0], 10) : undefined,
            posterPath: exactMatch.poster_path || undefined,
            backdropPath: exactMatch.backdrop_path || undefined,
          }
        }

        // Try fuzzy year match (+/- 1 year)
        const fuzzyMatch = results.find(r => {
          if (!r.release_date) return false
          const resultYear = parseInt(r.release_date.split('-')[0], 10)
          return Math.abs(resultYear - targetYear) <= 1
        })
        if (fuzzyMatch) {
          getLoggingService().info('[TMDB]', `Fuzzy year match: "${fuzzyMatch.title}" (${fuzzyMatch.release_date?.split('-')[0]}) for target year ${targetYear}`)
          return {
            tmdbId: fuzzyMatch.id,
            title: fuzzyMatch.title,
            year: fuzzyMatch.release_date ? parseInt(fuzzyMatch.release_date.split('-')[0], 10) : undefined,
            posterPath: fuzzyMatch.poster_path || undefined,
            backdropPath: fuzzyMatch.backdrop_path || undefined,
          }
        }
      }

      // Fall back to first result
      const first = results[0]
      return {
        tmdbId: first.id,
        title: first.title,
        year: first.release_date ? parseInt(first.release_date.split('-')[0], 10) : undefined,
        posterPath: first.poster_path || undefined,
        backdropPath: first.backdrop_path || undefined,
      }
    }

    // Strategy 1: Original title with year
    if (year) {
      const response = await this.searchMovie(originalTitle, year)
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    // Strategy 2: Normalized title with year
    if (year && normalizedTitle !== originalTitle) {
      const response = await this.searchMovie(normalizedTitle, year)
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    // Strategy 3: Original title without year (to get more results)
    {
      const response = await this.searchMovie(originalTitle)
      if (response.results?.length > 1) {
        const aiMatch = await this.tryAIDisambiguation(originalTitle, year, response.results)
        if (aiMatch) return aiMatch
      }
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    // Strategy 4: Normalized title without year
    if (normalizedTitle !== originalTitle) {
      const response = await this.searchMovie(normalizedTitle)
      if (response.results?.length > 1) {
        const aiMatch = await this.tryAIDisambiguation(originalTitle, year, response.results)
        if (aiMatch) return aiMatch
      }
      const match = findBestMatch(response.results, year)
      if (match) return match
    }

    return null
  }

  /**
   * Try AI disambiguation when multiple TMDB results exist.
   */
  async tryAIDisambiguation(
    filename: string,
    year: number | undefined,
    results: Array<{ id: number; title: string; release_date?: string; overview?: string; poster_path?: string | null; backdrop_path?: string | null }>,
  ): Promise<{ tmdbId: number; title: string; year?: number; posterPath?: string; backdropPath?: string } | null> {
    try {
      const gemini = getGeminiService()
      if (!gemini.isConfigured()) return null

      const candidates = results.slice(0, 5).map((r) => ({
        id: r.id,
        title: r.title,
        year: r.release_date ? parseInt(r.release_date.split('-')[0], 10) : undefined,
        overview: r.overview?.slice(0, 100),
      }))

      const bestIndex = await gemini.disambiguateTitle(filename, year, candidates)
      const best = results[bestIndex]
      if (!best) return null

      getLoggingService().info('[TMDB]', `AI disambiguation picked "${best.title}" for "${filename}"`)
      return {
        tmdbId: best.id,
        title: best.title,
        year: best.release_date ? parseInt(best.release_date.split('-')[0], 10) : undefined,
        posterPath: best.poster_path || undefined,
        backdropPath: best.backdrop_path || undefined,
      }
    } catch (error) { throw error }
  }

  /**
   * Search for movies by title and optional year
   */
  async searchMovie(query: string, year?: number): Promise<TMDBSearchResponse<TMDBMovieSearchResult>> {
    const params: Record<string, string> = {
      query
    }

    if (year) {
      params.year = year.toString()
    }

    return await this.request<TMDBSearchResponse<TMDBMovieSearchResult>>('/search/movie', params)
  }

  /**
   * Search for TV shows by title
   */
  async searchTVShow(query: string): Promise<TMDBSearchResponse<TMDBTVSearchResult>> {
    return await this.request<TMDBSearchResponse<TMDBTVSearchResult>>('/search/tv', {
      query
    })
  }

  /**
   * Search for movie collections/franchises by name
   */
  async searchCollection(query: string): Promise<TMDBSearchResponse<TMDBCollectionSearchResult>> {
    return await this.request<TMDBSearchResponse<TMDBCollectionSearchResult>>('/search/collection', {
      query
    })
  }

  /**
   * Find content by external ID (IMDB)
   * Returns both movie and TV show results if found
   */
  async findByExternalId(
    externalId: string,
    externalSource: 'imdb_id'
  ): Promise<{
    movie_results: Array<{ id: number; title: string; release_date?: string }>
    tv_results: Array<{ id: number; name: string }>
  }> {
    return await this.request<{
      movie_results: Array<{ id: number; title: string; release_date?: string }>
      tv_results: Array<{ id: number; name: string }>
    }>(
      `/find/${externalId}`,
      { external_source: externalSource }
    )
  }

  /**
   * Get TMDB configuration (image base URLs, etc.)
   */
  async getConfiguration(): Promise<TMDBConfiguration> {
    return await this.request<TMDBConfiguration>('/configuration')
  }

  /**
   * Build full image URL from path
   */
  buildImageUrl(path: string | null, size: 'w300' | 'w500' | 'original' = 'w500'): string | null {
    if (!path) return null
    return `${TMDBService.IMAGE_BASE_URL}${size}${path}`
  }

  /**
   * Get movie genre list (cached in memory — genres rarely change)
   */
  async getMovieGenres(): Promise<TMDBGenre[]> {
    if (this.movieGenres) return this.movieGenres
    const response = await this.request<TMDBGenreListResponse>('/genre/movie/list')
    this.movieGenres = response.genres
    return this.movieGenres
  }

  /**
   * Get TV genre list (cached in memory — genres rarely change)
   */
  async getTVGenres(): Promise<TMDBGenre[]> {
    if (this.tvGenres) return this.tvGenres
    const response = await this.request<TMDBGenreListResponse>('/genre/tv/list')
    this.tvGenres = response.genres
    return this.tvGenres
  }

  /**
   * Discover movies by genre, year range, rating, etc.
   */
  async discoverMovies(params: {
    genreId?: number
    yearMin?: number
    yearMax?: number
    sortBy?: string
    minRating?: number
    minVoteCount?: number
    page?: number
  }): Promise<TMDBSearchResponse<TMDBMovieSearchResult>> {
    const queryParams: Record<string, string> = {
      sort_by: params.sortBy || 'popularity.desc',
      'vote_count.gte': String(params.minVoteCount || 50),
    }
    if (params.genreId) queryParams.with_genres = String(params.genreId)
    if (params.yearMin) queryParams['primary_release_date.gte'] = `${params.yearMin}-01-01`
    if (params.yearMax) queryParams['primary_release_date.lte'] = `${params.yearMax}-12-31`
    if (params.minRating) queryParams['vote_average.gte'] = String(params.minRating)
    if (params.page) queryParams.page = String(params.page)

    return await this.request<TMDBSearchResponse<TMDBMovieSearchResult>>('/discover/movie', queryParams)
  }

  /**
   * Discover TV shows by genre, year range, rating, etc.
   */
  async discoverTV(params: {
    genreId?: number
    yearMin?: number
    yearMax?: number
    sortBy?: string
    minRating?: number
    minVoteCount?: number
    page?: number
  }): Promise<TMDBSearchResponse<TMDBTVSearchResult>> {
    const queryParams: Record<string, string> = {
      sort_by: params.sortBy || 'popularity.desc',
      'vote_count.gte': String(params.minVoteCount || 50),
    }
    if (params.genreId) queryParams.with_genres = String(params.genreId)
    if (params.yearMin) queryParams['first_air_date.gte'] = `${params.yearMin}-01-01`
    if (params.yearMax) queryParams['first_air_date.lte'] = `${params.yearMax}-12-31`
    if (params.minRating) queryParams['vote_average.gte'] = String(params.minRating)
    if (params.page) queryParams.page = String(params.page)

    return await this.request<TMDBSearchResponse<TMDBTVSearchResult>>('/discover/tv', queryParams)
  }

  /**
   * Get movies similar to a given movie
   */
  async getSimilarMovies(tmdbId: string): Promise<TMDBSearchResponse<TMDBMovieSearchResult>> {
    return await this.request<TMDBSearchResponse<TMDBMovieSearchResult>>(`/movie/${tmdbId}/similar`)
  }

  /**
   * Get TV shows similar to a given show
   */
  async getSimilarTV(tmdbId: string): Promise<TMDBSearchResponse<TMDBTVSearchResult>> {
    return await this.request<TMDBSearchResponse<TMDBTVSearchResult>>(`/tv/${tmdbId}/similar`)
  }

  /**
   * Get movie recommendations based on a given movie
   */
  async getMovieRecommendations(tmdbId: string): Promise<TMDBSearchResponse<TMDBMovieSearchResult>> {
    return await this.request<TMDBSearchResponse<TMDBMovieSearchResult>>(`/movie/${tmdbId}/recommendations`)
  }

  /**
   * Get TV show recommendations based on a given show
   */
  async getTVRecommendations(tmdbId: string): Promise<TMDBSearchResponse<TMDBTVSearchResult>> {
    return await this.request<TMDBSearchResponse<TMDBTVSearchResult>>(`/tv/${tmdbId}/recommendations`)
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; oldestEntry: number | null } {
    const now = Date.now()
    let oldestTimestamp: number | null = null

    this.cache.forEach(entry => {
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp
      }
    })

    const oldestAge = oldestTimestamp ? now - oldestTimestamp : null

    return {
      size: this.cache.size,
      oldestEntry: oldestAge
    }
  }

  /**
   * Look up TMDB IDs for media items that don't have them
   */
  async lookupMissingTMDBIds(
    items: any[],
    type: 'movie' | 'tv',
    onProgress?: (progress: { current: number; total: number; currentItem: string; phase: string }) => void
  ): Promise<{ updated: number; failed: number }> {
    const db = getDatabase()
    const itemsWithoutTmdb = items.filter(m => !m.tmdb_id)

    if (itemsWithoutTmdb.length === 0) return { updated: 0, failed: 0 }

    getLoggingService().info('[TMDBService]', `Looking up TMDB IDs for ${itemsWithoutTmdb.length} ${type}s`)

    let updated = 0
    let failed = 0
    const BATCH_SIZE = 5

    for (let i = 0; i < itemsWithoutTmdb.length; i += BATCH_SIZE) {
      const batch = itemsWithoutTmdb.slice(i, i + BATCH_SIZE)

      const results = await Promise.allSettled(
        batch.map(async (item) => {
          let tmdbId: string | null = null

          if (item.imdb_id && item.imdb_id.startsWith('tt')) {
            try {
              const findResult = await this.findByExternalId(item.imdb_id, 'imdb_id')
              const res = type === 'movie' ? findResult.movie_results : findResult.tv_results
              if (res && res.length > 0) tmdbId = String(res[0].id)
            } catch { /* ignore */ }
          }

          if (!tmdbId) {
            try {
              const res = type === 'movie' 
                ? await this.searchMovie(item.title, item.year) 
                : await this.searchTVShow(item.series_title || item.title)
              if (res.results && res.results.length > 0) {
                const bestMatch = type === 'movie' 
                  ? res.results.find(r => (r as any).release_date?.startsWith(String(item.year))) || res.results[0]
                  : res.results[0]
                tmdbId = String(bestMatch.id)
              }
            } catch { /* ignore */ }
          }

          if (tmdbId && item.id) {
            if (type === 'movie') db.media.updateMovieWithTMDBId(item.id, tmdbId)
            else db.media.updateSeriesMatch(item.series_title || item.title, item.source_id, tmdbId)
            return { success: true }
          }
          return { success: false }
        })
      )

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.success) updated++
        else failed++
      }

      onProgress?.({
        current: Math.min(i + BATCH_SIZE, itemsWithoutTmdb.length),
        total: itemsWithoutTmdb.length,
        currentItem: batch[0]?.title || '',
        phase: 'lookup',
      })
    }

    return { updated, failed }
  }
}

// Singleton instance
let tmdbService: TMDBService | null = null

export function getTMDBService(): TMDBService {
  if (!tmdbService) {
    tmdbService = new TMDBService()
    tmdbService.initialize().catch(err => {
      getLoggingService().error('[TMDBService]', 'Failed to initialize TMDB service:', err)
    })
  }
  return tmdbService
}

export function resetTMDBServiceForTesting(): void {
  tmdbService = null
}
