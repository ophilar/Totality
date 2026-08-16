import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteRegistryRecipeProvider } from '@main/services/timelines/RemoteRegistryRecipeProvider'
import { TraktRecipeProvider } from '@main/services/timelines/TraktRecipeProvider'
import { TMDBRecipeProvider } from '@main/services/timelines/TMDBRecipeProvider'
import { TimelineCacheService } from '@main/services/timelines/TimelineCacheService'
import type { TMDBService } from '@main/services/TMDBService'

describe('TimelineRecipeProviders', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    TimelineCacheService.resetInstanceForTesting()
  })

  describe('RemoteRegistryRecipeProvider', () => {
    it('fetches remote manifest from registry URL', async () => {
      const mockManifest = [
        {
          id: 'star-trek-chronological',
          name: 'Star Trek: Chronological Order',
          franchise: 'Star Trek',
          description: 'All series and movies in universe chronological order',
          totalItems: 25,
        },
      ]

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockManifest,
      } as unknown as Response)

      const provider = new RemoteRegistryRecipeProvider('https://registry.example.com')
      const recipes = await provider.listAvailableRecipes()
      expect(recipes.length).toBe(1)
      expect(recipes[0].id).toBe('star-trek-chronological')
      expect(recipes[0].sourceType).toBe('remote')
    })

    it('fetches and caches timeline recipe definition from remote registry', async () => {
      const mockRecipe = {
        id: 'star-trek-chronological',
        franchise: 'Star Trek',
        name: 'Star Trek: Chronological Order',
        description: 'Complete chronological order',
        version: 1,
        items: [
          {
            order: 1,
            type: 'show',
            title: 'Star Trek: Enterprise',
            timelineEra: '2151-2155',
            identifiers: { tmdbId: 1478, tvdbId: 75711 },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockRecipe,
      } as unknown as Response)

      const provider = new RemoteRegistryRecipeProvider('https://registry.example.com')
      const timeline = await provider.fetchTimeline('star-trek-chronological')

      expect(timeline.id).toBe('star-trek-chronological')
      expect(timeline.items.length).toBe(1)
      expect(timeline.items[0].identifiers.tmdbId).toBe(1478)
      expect(timeline.items[0].identifiers.tvdbId).toBe(75711)
    })

    it('throws when requesting a recipe that fails with 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as unknown as Response)

      const provider = new RemoteRegistryRecipeProvider('https://registry.example.com')
      await expect(provider.fetchTimeline('unknown-recipe')).rejects.toThrow(/Failed to fetch timeline 'unknown-recipe'/)
    })
  })

  describe('TMDBRecipeProvider', () => {
    it('fetches and builds timeline from TMDB collection details', async () => {
      const mockCollection = {
        id: 115570,
        name: 'Star Trek: The Original Series Collection',
        overview: 'The original Star Trek films',
        parts: [
          {
            id: 152,
            title: 'Star Trek: The Motion Picture',
            release_date: '1979-12-07',
          },
          {
            id: 154,
            title: 'Star Trek II: The Wrath of Khan',
            release_date: '1982-06-04',
          },
        ],
      }

      const mockTmdb = {
        getCollectionDetails: vi.fn().mockResolvedValue(mockCollection),
      } as unknown as TMDBService

      const provider = new TMDBRecipeProvider(mockTmdb)
      const timeline = await provider.fetchTimeline('tmdb-collection-115570')

      expect(timeline.id).toBe('tmdb-collection-115570')
      expect(timeline.name).toBe('Star Trek: The Original Series Collection')
      expect(timeline.items.length).toBe(2)
      expect(timeline.items[0].title).toBe('Star Trek: The Motion Picture')
      expect(timeline.items[0].identifiers.tmdbId).toBe(152)
      expect(timeline.items[1].title).toBe('Star Trek II: The Wrath of Khan')
      expect(timeline.items[1].identifiers.tmdbId).toBe(154)
    })
  })

  describe('TraktRecipeProvider', () => {
    it('throws error if Trakt client ID is missing', async () => {
      const provider = new TraktRecipeProvider()
      await expect(provider.fetchTimeline('donxy/star-trek')).rejects.toThrow(/Trakt Client ID is required/)
    })

    it('fetches and maps Trakt list items when client ID is provided', async () => {
      const mockItems = [
        {
          rank: 1,
          type: 'movie',
          movie: {
            title: 'Star Trek II: The Wrath of Khan',
            year: 1982,
            ids: { trakt: 100, slug: 'star-trek-2', tmdb: 154, imdb: 'tt0084726' },
          },
        },
        {
          rank: 2,
          type: 'episode',
          show: {
            title: 'Star Trek: The Next Generation',
            year: 1987,
            ids: { trakt: 200, slug: 'tng', tmdb: 655, tvdb: 71470 },
          },
          episode: {
            season: 1,
            number: 1,
            title: 'Encounter at Farpoint',
            ids: { trakt: 201, tmdb: 655, tvdb: 71470 },
          },
        },
      ]

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockItems,
      } as unknown as Response)

      const provider = new TraktRecipeProvider('dummy-client-id')
      const timeline = await provider.fetchTimeline('donxy/star-trek-chronological')

      expect(timeline.id).toBe('trakt-donxy-star-trek-chronological')
      expect(timeline.items.length).toBe(2)
      expect(timeline.items[0].title).toBe('Star Trek II: The Wrath of Khan')
      expect(timeline.items[0].type).toBe('movie')
      expect(timeline.items[0].identifiers.tmdbId).toBe(154)
      expect(timeline.items[1].title).toBe('Encounter at Farpoint')
      expect(timeline.items[1].type).toBe('episode')
      expect(timeline.items[1].seasonNumber).toBe(1)
      expect(timeline.items[1].episodeNumber).toBe(1)
    })
  })

  describe('TimelineCacheService', () => {
    it('memoizes and returns cached recipes without refetching', async () => {
      const mockRecipe = {
        id: 'cached-timeline-1',
        franchise: 'Star Wars',
        name: 'Star Wars Canon',
        description: 'Canon films',
        version: 1,
        items: [
          {
            order: 1,
            type: 'movie' as const,
            title: 'Star Wars: A New Hope',
            identifiers: { tmdbId: 11 },
          },
        ],
      }

      const mockCacheService = {
        getRecipe: vi.fn().mockResolvedValue(mockRecipe),
        setRecipe: vi.fn(),
      }

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const provider = new RemoteRegistryRecipeProvider('https://registry.example.com', mockCacheService as never)
      const result = await provider.fetchTimeline('cached-timeline-1')

      expect(result).toEqual(mockRecipe)
      expect(mockCacheService.getRecipe).toHaveBeenCalledWith('cached-timeline-1')
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('Bundled Fallbacks in RemoteRegistryRecipeProvider', () => {
    it('returns bundled recipes when remote registry is offline / 404', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as unknown as Response)

      const provider = new RemoteRegistryRecipeProvider()
      const recipes = await provider.listAvailableRecipes()
      expect(recipes.length).toBeGreaterThanOrEqual(5)
      expect(recipes.some((r) => r.id === 'star-trek-chronological')).toBe(true)

      const starTrek = await provider.fetchTimeline('star-trek-chronological')
      expect(starTrek.id).toBe('star-trek-chronological')
      expect(starTrek.items.length).toBeGreaterThanOrEqual(20)
      expect(starTrek.items[0].title).toBe('Star Trek: Enterprise')
    })
  })

  describe('WebGuideRecipeProvider', () => {
    it('parses web guide HTML into structured timeline items', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head><title>Star Trek Chronological Viewing Guide</title></head>
          <body>
            <h2>1. Star Trek: Enterprise (2001)</h2>
            <p>The prequel series.</p>
            <h2>2. Star Trek: The Original Series (1966)</h2>
            <p>Kirk and Spock.</p>
            <h2>3. Star Trek II: The Wrath of Khan (1982)</h2>
          </body>
        </html>
      `

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => mockHtml,
      } as unknown as Response)

      const mockGemini = {
        isConfigured: () => false,
      } as never

      const mockTmdb = {
        searchMovie: vi.fn().mockResolvedValue({ results: [{ id: 154, release_date: '1982-06-04' }] }),
        searchTVShow: vi.fn().mockResolvedValue({ results: [{ id: 1478, first_air_date: '2001-09-26' }] }),
      } as never

      const { WebGuideRecipeProvider } = await import('@main/services/timelines/WebGuideRecipeProvider')
      const provider = new WebGuideRecipeProvider(undefined as never, mockGemini, mockTmdb)

      const timeline = await provider.fetchTimeline('https://startrekviewingguide.com/chronological')
      expect(timeline.items.length).toBe(3)
      expect(timeline.items[0].title).toContain('Star Trek: Enterprise')
      expect(timeline.items[1].title).toContain('Star Trek: The Original Series')
      expect(timeline.items[2].title).toContain('Star Trek II: The Wrath of Khan')
    })
  })
})
