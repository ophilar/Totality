import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import { TraktRecipeProvider } from '@main/services/timelines/TraktRecipeProvider'
import type { TimelineCacheService } from '@main/services/timelines/TimelineCacheService'

const mockFetchWithTimeout = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/main/services/utils/httpClient', () => ({
  fetchWithTimeout: mockFetchWithTimeout,
}))

class TestTimelineCache {
  readonly recipes = new Map<string, TimelineDefinition>()

  async getRecipe(id: string): Promise<TimelineDefinition | null> {
    return this.recipes.get(id) ?? null
  }

  async setRecipe(id: string, recipe: TimelineDefinition): Promise<void> {
    this.recipes.set(id, recipe)
  }
}

const response = (items: unknown[], pageCount = '1') => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'x-pagination-page-count': pageCount }),
  json: vi.fn().mockResolvedValue(items),
})

describe('TraktRecipeProvider', () => {
  beforeEach(() => mockFetchWithTimeout.mockReset())

  it('keeps episode and series identifiers distinct and populates supplied years', async () => {
    mockFetchWithTimeout.mockResolvedValue(response([
      { type: 'movie', movie: { title: 'Movie', year: 2001, ids: { trakt: 1, slug: 'movie', tmdb: 10 } } },
      {
        type: 'episode',
        episode: { season: 2, number: 3, title: 'Episode', ids: { trakt: 2, tmdb: 20, tvdb: 21 } },
        show: { title: 'Show', year: 1999, ids: { trakt: 3, slug: 'show', tmdb: 30, tvdb: 31 } },
      },
      { type: 'show', show: { title: 'Show', year: 1999, ids: { trakt: 3, slug: 'show', tmdb: 30 } } },
    ]))
    const provider = new TraktRecipeProvider('client', new TestTimelineCache() as unknown as TimelineCacheService)

    const timeline = await provider.fetchTimeline('user-name/list-slug')

    expect(timeline.items[0]).toMatchObject({ releaseYear: 2001 })
    expect(timeline.items[1]).toMatchObject({
      seriesTitle: 'Show',
      seasonNumber: 2,
      episodeNumber: 3,
      identifiers: { tmdbId: 20, tvdbId: 21, seriesTmdbId: 30, seriesTvdbId: 31 },
    })
    expect(timeline.items[1].releaseYear).toBeUndefined()
    expect(timeline.items[2]).toMatchObject({ releaseYear: 1999 })
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/users/user-name/lists/list-slug/items?page=1&limit=1000'),
      expect.anything(),
      10000
    )
  })

  it('round-trips hyphenated components through the canonical ID', async () => {
    mockFetchWithTimeout.mockResolvedValue(response([]))
    const cache = new TestTimelineCache()
    const provider = new TraktRecipeProvider('client', cache as unknown as TimelineCacheService)
    const first = await provider.fetchTimeline('user-name/list-slug')
    cache.recipes.clear()

    const second = await provider.fetchTimeline(first.id, { refresh: true })

    expect(second.id).toBe(first.id)
    expect(mockFetchWithTimeout).toHaveBeenLastCalledWith(
      expect.stringContaining('/users/user-name/lists/list-slug/items'),
      expect.anything(),
      10000
    )
  })

  it('recovers a legacy canonical ID from its cached source URL', async () => {
    mockFetchWithTimeout.mockResolvedValue(response([]))
    const cache = new TestTimelineCache()
    cache.recipes.set('trakt-user-name-list-slug', {
      id: 'trakt-user-name-list-slug', franchise: 'Trakt Custom', name: 'legacy', description: '', version: 1, items: [],
      sourceUrl: 'https://trakt.tv/users/user-name/lists/list-slug',
    })
    const provider = new TraktRecipeProvider('client', cache as unknown as TimelineCacheService)

    await provider.fetchTimeline('trakt-user-name-list-slug', { refresh: true })

    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/users/user-name/lists/list-slug/items'),
      expect.anything(),
      10000
    )
  })

  it('rejects an uncached ambiguous legacy canonical ID', async () => {
    const provider = new TraktRecipeProvider('client', new TestTimelineCache() as unknown as TimelineCacheService)
    await expect(provider.fetchTimeline('trakt-user-name-list-slug', { refresh: true })).rejects.toThrow(/cannot be decoded/i)
    expect(mockFetchWithTimeout).not.toHaveBeenCalled()
  })
})
