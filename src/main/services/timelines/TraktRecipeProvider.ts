
import type { ITimelineRecipeProvider, TimelineDefinition, TimelineItem, TimelineRecipeSummary, TimelineFetchOptions } from './ITimelineRecipeProvider'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'
import { fetchWithTimeout } from '../utils/httpClient'

interface TraktItemResponse {
  rank: number
  type: 'movie' | 'episode' | 'show'
  movie?: {
    title: string
    year: number
    ids: {
      trakt: number
      slug: string
      imdb?: string
      tmdb?: number
    }
  }
  show?: {
    title: string
    year: number
    ids: {
      trakt: number
      slug: string
      imdb?: string
      tmdb?: number
      tvdb?: number
    }
  }
  episode?: {
    season: number
    number: number
    title: string
    ids: {
      trakt: number
      tvdb?: number
      imdb?: string
      tmdb?: number
    }
  }
}

export class TraktRecipeProvider implements ITimelineRecipeProvider {
  constructor(
    private readonly traktClientId?: string,
    private readonly cacheService: TimelineCacheService = getTimelineCacheService()
  ) {}

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    return []
  }

  async supports(input: string): Promise<boolean> {
    return input.startsWith('trakt-') || /^https?:\/\/trakt\.tv\//i.test(input) || /^[^/]+\/[^/]+$/.test(input)
  }

  async fetchTimeline(listSlugOrUrl: string, options: TimelineFetchOptions = {}): Promise<TimelineDefinition> {
    const cached = await this.cacheService.getRecipe(listSlugOrUrl)
    if (cached && !options.refresh) {
      return cached
    }

    if (!this.traktClientId) {
      throw new Error('Trakt Client ID is required to fetch Trakt lists.')
    }

    let source = listSlugOrUrl
    if (source.startsWith('trakt-')) {
      const decoded = decodeCanonicalId(source)
      if (decoded) {
        source = `${decoded.username}/${decoded.listSlug}`
      } else {
        const legacy = await this.cacheService.getRecipe(source, true)
        if (!legacy?.sourceUrl) {
          throw new Error(`Legacy Trakt timeline ID '${source}' cannot be decoded. Reopen the guide using its Trakt list URL.`)
        }
        source = legacy.sourceUrl
      }
    }

    // Parse username and list slug from e.g. "donxy/star-trek-chronological" or "users/donxy/lists/star-trek-chronological"
    const cleaned = source
      .replace(/^https?:\/\/(?:www\.)?trakt\.tv\//i, '')
      .replace(/^\/?users\//i, '')
    const parts = cleaned.split('/').filter(Boolean)

    let username: string
    let listSlug: string

    if (parts.length === 2) {
      [username, listSlug] = parts
    } else if (parts.length >= 3 && parts[1] === 'lists') {
      username = parts[0]
      listSlug = parts[2]
    } else {
      throw new Error(`Invalid Trakt list format '${listSlugOrUrl}'. Expected 'username/list-slug'.`)
    }

    const canonicalId = encodeCanonicalId(username, listSlug)
    const cachedByCanonical = await this.cacheService.getRecipe(canonicalId)
    if (cachedByCanonical && !options.refresh) {
      return cachedByCanonical
    }

    const rawItems: TraktItemResponse[] = []
    const pageSize = 1000
    for (let page = 1; ; page++) {
      const response = await fetchWithTimeout(`https://api.trakt.tv/users/${encodeURIComponent(username)}/lists/${encodeURIComponent(listSlug)}/items?page=${page}&limit=${pageSize}`, {
        headers: {
          'Content-Type': 'application/json',
          'trakt-api-version': '2',
          'trakt-api-key': this.traktClientId,
        },
        signal: options.signal,
      }, 10000)

      if (!response.ok) {
        throw new Error(`Trakt API error (${response.status}): Failed to fetch list '${username}/${listSlug}'.`)
      }

      const pageItems: unknown = await response.json()
      if (!Array.isArray(pageItems)) throw new Error(`Trakt API returned an invalid item list for '${username}/${listSlug}'.`)
      rawItems.push(...pageItems as TraktItemResponse[])
      const pageCountHeader = response.headers.get('x-pagination-page-count')
      const pageCount = pageCountHeader === null ? undefined : Number(pageCountHeader)
      if ((pageCount !== undefined && Number.isInteger(pageCount) && page >= pageCount) || (pageCount === undefined && pageItems.length < pageSize)) break
    }
    const items: TimelineItem[] = []

    let order = 1
    for (const raw of rawItems) {
      if (raw.type === 'movie' && raw.movie) {
        items.push({
          order: order++,
          type: 'movie',
          title: raw.movie.title,
          releaseYear: raw.movie.year,
          identifiers: {
            tmdbId: raw.movie.ids.tmdb,
            imdbId: raw.movie.ids.imdb,
          },
        })
      } else if (raw.type === 'episode' && raw.episode) {
        items.push({
          order: order++,
          type: 'episode',
          title: raw.episode.title,
          seriesTitle: raw.show?.title,
          seasonNumber: raw.episode.season,
          episodeNumber: raw.episode.number,
          identifiers: {
            tmdbId: raw.episode.ids.tmdb,
            tvdbId: raw.episode.ids.tvdb,
            imdbId: raw.episode.ids.imdb,
            seriesTmdbId: raw.show?.ids.tmdb,
            seriesTvdbId: raw.show?.ids.tvdb,
          },
        })
      } else if (raw.type === 'show' && raw.show) {
        items.push({
          order: order++,
          type: 'show',
          title: raw.show.title,
          seriesTitle: raw.show.title,
          releaseYear: raw.show.year,
          identifiers: {
            tmdbId: raw.show.ids.tmdb,
            tvdbId: raw.show.ids.tvdb,
            imdbId: raw.show.ids.imdb,
          },
        })
      }
    }

    const definition: TimelineDefinition = {
      id: canonicalId,
      franchise: 'Trakt Custom',
      name: `${username}/${listSlug}`,
      description: `Imported from Trakt.tv (${username}/${listSlug})`,
      sourceUrl: `https://trakt.tv/users/${username}/lists/${listSlug}`,
      version: 1,
      items,
    }

    await this.cacheService.setRecipe(canonicalId, definition)
    if (listSlugOrUrl !== canonicalId) {
      await this.cacheService.setRecipe(listSlugOrUrl, definition)
    }

    return definition
  }
}

function encodeCanonicalId(username: string, listSlug: string): string {
  return `trakt-${Buffer.from(JSON.stringify([username, listSlug]), 'utf8').toString('base64url')}`
}

function decodeCanonicalId(id: string): { username: string; listSlug: string } | null {
  try {
    const encoded = id.slice('trakt-'.length)
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(value => typeof value !== 'string' || !value)) return null
    const [username, listSlug] = parsed as [string, string]
    return encodeCanonicalId(username, listSlug) === id ? { username, listSlug } : null
  } catch {
    return null
  }
}
