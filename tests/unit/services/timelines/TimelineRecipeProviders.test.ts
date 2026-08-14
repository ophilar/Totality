import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteRegistryRecipeProvider } from '@main/services/timelines/RemoteRegistryRecipeProvider'
import { TraktRecipeProvider } from '@main/services/timelines/TraktRecipeProvider'

describe('TimelineRecipeProviders', () => {
  describe('RemoteRegistryRecipeProvider', () => {
    it('returns bundled preset timeline recipes', async () => {
      const provider = new RemoteRegistryRecipeProvider()
      const recipes = await provider.listAvailableRecipes()
      expect(recipes.length).toBeGreaterThanOrEqual(4)

      const starTrekAir = recipes.find(r => r.id === 'star-trek-airdate')
      expect(starTrekAir).toBeDefined()
      expect(starTrekAir?.franchise).toBe('Star Trek')
      expect(starTrekAir?.sourceType).toBe('preset')

      const starTrekChrono = recipes.find(r => r.id === 'star-trek-chronological')
      expect(starTrekChrono).toBeDefined()
      expect(starTrekChrono?.franchise).toBe('Star Trek')
    })

    it('fetches and returns a full timeline definition for a preset', async () => {
      const provider = new RemoteRegistryRecipeProvider()
      const timeline = await provider.fetchTimeline('star-trek-chronological')

      expect(timeline.id).toBe('star-trek-chronological')
      expect(timeline.items.length).toBeGreaterThan(0)
      expect(timeline.items[0].identifiers.tmdbId).toBe(1478)
      expect(timeline.items[0].identifiers.tvdbId).toBe(75711)
    })

    it('throws when requesting a non-existent recipe without registry URL', async () => {
      const provider = new RemoteRegistryRecipeProvider()
      await expect(provider.fetchTimeline('unknown-recipe')).rejects.toThrow(/not found/)
    })
  })

  describe('TraktRecipeProvider', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

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
})
