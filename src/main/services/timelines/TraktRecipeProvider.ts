import type { ITimelineRecipeProvider, TimelineDefinition, TimelineItem, TimelineRecipeSummary } from './ITimelineRecipeProvider'

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
  constructor(private readonly traktClientId?: string) {}

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    return []
  }

  async fetchTimeline(listSlugOrUrl: string): Promise<TimelineDefinition> {
    if (!this.traktClientId) {
      throw new Error('Trakt Client ID is required to fetch Trakt lists.')
    }

    // Parse username and list slug from e.g. "donxy/star-trek-chronological" or "users/donxy/lists/star-trek-chronological"
    const cleaned = listSlugOrUrl.replace(/^https?:\/\/trakt\.tv\//, '').replace(/^\/?users\//, '')
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

    const response = await fetch(`https://api.trakt.tv/users/${username}/lists/${listSlug}/items`, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': this.traktClientId,
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      throw new Error(`Trakt API error (${response.status}): Failed to fetch list '${username}/${listSlug}'.`)
    }

    const rawItems: TraktItemResponse[] = await response.json()
    const items: TimelineItem[] = []

    let order = 1
    for (const raw of rawItems) {
      if (raw.type === 'movie' && raw.movie) {
        items.push({
          order: order++,
          type: 'movie',
          title: raw.movie.title,
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
            tmdbId: raw.episode.ids.tmdb || raw.show?.ids.tmdb,
            tvdbId: raw.episode.ids.tvdb || raw.show?.ids.tvdb,
            imdbId: raw.episode.ids.imdb,
          },
        })
      }
    }

    return {
      id: `trakt-${username}-${listSlug}`,
      franchise: 'Trakt Custom',
      name: `${username}/${listSlug}`,
      description: `Imported from Trakt.tv (${username}/${listSlug})`,
      sourceUrl: `https://trakt.tv/users/${username}/lists/${listSlug}`,
      version: 1,
      items,
    }
  }
}
