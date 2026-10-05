import {
  IMetadataProvider,
  MetadataSearchQuery,
  MetadataSearchResult,
  MediaMetadataDetails,
  MetadataType,
} from '../IMetadataProvider'
import { getLoggingService } from '../../LoggingService'
import type { ProviderHealthResult } from '@shared/serviceHealth'
import { fetchWithTimeout } from '@main/services/utils/httpClient'

interface OmdbItem {
  imdbID: string
  Title: string
  Year?: string
  Poster?: string
  Response?: string
  Plot?: string
  imdbRating?: string
  imdbVotes?: string
  Rated?: string
  Awards?: string
  Genre?: string
}
function isOmdbItem(value: unknown): value is OmdbItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).imdbID === 'string' &&
    typeof (value as Record<string, unknown>).Title === 'string'
  )
}

function isOmdbResponseFalse(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).Response === 'False'
  )
}

export class OMDbMetadataProvider implements IMetadataProvider {
  readonly providerId = 'omdb'
  readonly providerName = 'Open Movie Database (OMDb / IMDb)'
  readonly supportedTypes: MetadataType[] = ['movie', 'tv']

  constructor(private apiKeyGetter: () => string | null | Promise<string | null>) {}

  async testSavedCredential(signal: AbortSignal): Promise<ProviderHealthResult> {
    const apiKey = await this.apiKeyGetter()
    if (!apiKey) return { status: 'not-configured', message: null }
    const url = new URL('https://www.omdbapi.com/')
    url.searchParams.set('apikey', apiKey)
    url.searchParams.set('t', 'The Matrix')
    try {
      const response = await fetchWithTimeout(url.toString(), { signal }, 10000)
      if (response.status === 401) return { status: 'invalid-credential', message: 'OMDb rejected the saved API key.' }
      if (response.status === 429) return { status: 'rate-limited', message: 'OMDb rate limit reached.' }
      if (!response.ok) return { status: 'unavailable', message: `OMDb returned HTTP ${response.status}.` }
      const result = await response.json() as { Response?: string; Error?: string }
      if (result.Response === 'True' || result.Error === 'Movie not found!') return { status: 'valid', message: null }
      if (result.Error === 'Invalid API key!') return { status: 'invalid-credential', message: 'OMDb rejected the saved API key.' }
      if (result.Error?.toLowerCase().includes('limit')) return { status: 'rate-limited', message: 'OMDb rate limit reached.' }
      return { status: 'unavailable', message: result.Error || 'OMDb returned an unrecognized validation response.' }
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof Error && /timed out/i.test(error.message)) return { status: 'timed-out', message: 'OMDb validation timed out.' }
      return { status: 'unavailable', message: 'OMDb could not be reached.' }
    }
  }

  async search(query: MetadataSearchQuery, signal?: AbortSignal): Promise<MetadataSearchResult[]> {
    signal?.throwIfAborted()
    const apiKey = await this.apiKeyGetter()
    if (!apiKey) return []

    const typeParam = query.type === 'movie' ? 'movie' : 'series'
    const url = `https://www.omdbapi.com/?apikey=${apiKey}&s=${encodeURIComponent(query.title)}${query.year ? `&y=${query.year}` : ''}&type=${typeParam}`

    try {
      const res = await fetchWithTimeout(url, { signal }, 10000)
      if (!res.ok) {
        getLoggingService().error(
          '[OMDbMetadataProvider]',
          `Search HTTP ${res.status} for query: ${query.title}`
        )
        return []
      }
      const data: unknown = await res.json()
      if (!Array.isArray(data) && (typeof data !== 'object' || data === null)) return []
      const response = data as { Response?: string; Search?: unknown[] }
      if (response.Response === 'False' || !Array.isArray(response.Search)) {
        return []
      }

      return response.Search.filter(isOmdbItem).map((item) => ({
        id: item.imdbID,
        provider: this.providerId,
        title: item.Title,
        year: item.Year ? parseInt(item.Year.slice(0, 4), 10) : undefined,
        type: query.type,
        posterUrl: item.Poster && item.Poster !== 'N/A' ? item.Poster : undefined,
        overview: undefined,
        externalIds: { imdbId: item.imdbID },
      }))
    } catch (err) {
      if (signal?.aborted) throw err
      getLoggingService().error('[OMDbMetadataProvider]', 'Search error:', err)
      return []
    }
  }

  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    const apiKey = await this.apiKeyGetter()
    if (!apiKey || !externalId) return null

    const url = `https://www.omdbapi.com/?apikey=${apiKey}&i=${encodeURIComponent(externalId)}&plot=full`

    try {
      const res = await fetch(url)
      if (!res.ok) {
        getLoggingService().error(
          '[OMDbMetadataProvider]',
          `Details HTTP ${res.status} for ID: ${externalId}`
        )
        return null
      }
      const item: unknown = await res.json()
      if (isOmdbResponseFalse(item) || !isOmdbItem(item)) {
        return null
      }

      const imdbScore =
        item.imdbRating && item.imdbRating !== 'N/A' ? parseFloat(item.imdbRating) : undefined

      return {
        id: item.imdbID,
        provider: this.providerId,
        title: item.Title,
        year: item.Year ? parseInt(item.Year.slice(0, 4), 10) : undefined,
        type,
        posterUrl: item.Poster && item.Poster !== 'N/A' ? item.Poster : undefined,
        overview: item.Plot && item.Plot !== 'N/A' ? item.Plot : undefined,
        score: imdbScore,
        imdbRating: imdbScore,
        imdbVotes: item.imdbVotes && item.imdbVotes !== 'N/A' ? item.imdbVotes : undefined,
        contentRating: item.Rated && item.Rated !== 'N/A' ? item.Rated : undefined,
        awards: item.Awards && item.Awards !== 'N/A' ? item.Awards : undefined,
        genres: item.Genre && item.Genre !== 'N/A' ? item.Genre.split(', ') : [],
        externalIds: {
          imdbId: item.imdbID,
        },
        raw: { ...item },
      }
    } catch (err) {
      getLoggingService().error('[OMDbMetadataProvider]', 'Details error:', err)
      return null
    }
  }

  async findByExternalId(
    externalId: string,
    source: 'imdb_id' | 'tvdb_id',
    type: MetadataType
  ): Promise<MediaMetadataDetails | null> {
    if (source !== 'imdb_id') return null
    return this.getDetails(externalId, type)
  }
}
