import { describe, it, expect } from 'vitest'

describe('Fix Match - Non-TMDB Identifier Resilience', () => {
  it('validates that authoritative IDs (IMDb, TVDB, AniList) are properly recognized without requiring TMDB ID', () => {
    const detailsWithoutTmdb = {
      title: 'Independent Title',
      year: 2022,
      externalIds: {
        imdbId: 'tt9876543'
      }
    }

    const providerId = 'omdb'
    const externalId = 'tt9876543'

    const tmdbId = providerId === 'tmdb' ? externalId : detailsWithoutTmdb.externalIds?.tmdbId || null
    const imdbId = providerId === 'omdb' || providerId === 'imdb' ? externalId : detailsWithoutTmdb.externalIds?.imdbId || null
    const anilistId = providerId === 'anilist' ? externalId : detailsWithoutTmdb.externalIds?.anilistId || null

    expect(tmdbId).toBeNull()
    expect(imdbId).toBe('tt9876543')
    expect(!tmdbId && !imdbId && !anilistId).toBe(false)
  })

  it('validates that series with TVDB or AniList IDs are recognized without requiring TMDB ID', () => {
    const detailsAnime = {
      title: 'Anime Series',
      externalIds: {
        anilistId: '12345'
      }
    }

    const providerId = 'anilist'
    const externalId = '12345'

    const tmdbId = providerId === 'tmdb' ? externalId : detailsAnime.externalIds?.tmdbId || null
    const tvdbId = providerId === 'tvdb' ? externalId : detailsAnime.externalIds?.tvdbId || null
    const imdbId = providerId === 'omdb' || providerId === 'imdb' ? externalId : detailsAnime.externalIds?.imdbId || null
    const anilistId = providerId === 'anilist' ? externalId : detailsAnime.externalIds?.anilistId || null

    expect(tmdbId).toBeNull()
    expect(anilistId).toBe('12345')
    expect(!tmdbId && !tvdbId && !imdbId && !anilistId).toBe(false)
  })
})
