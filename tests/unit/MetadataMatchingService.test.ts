import { describe, it, expect } from 'vitest'
import { selectAutomaticMatch } from '@main/services/metadata/MetadataMatchingService'
import { MetadataSearchResult } from '@main/services/metadata/IMetadataProvider'
import { normalizeTitleForMatching, scoreTitleMatch } from '@main/services/metadata/TitleMatching'
import { isPlaceholderMusicTitle } from '@main/services/MusicBrainzService'

describe('MetadataMatchingService & selectAutomaticMatch', () => {
  describe('selectAutomaticMatch', () => {
    it('matches by external ID with highest priority', () => {
      const candidates: MetadataSearchResult[] = [
        {
          id: '101',
          provider: 'tmdb',
          title: 'Different Title',
          type: 'movie',
          externalIds: { imdbId: 'tt1234567', tmdbId: '101' }
        },
        {
          id: '102',
          provider: 'tmdb',
          title: 'Exact Title',
          type: 'movie',
          externalIds: { tmdbId: '102' }
        }
      ]

      const match = selectAutomaticMatch(candidates, {
        title: 'Exact Title',
        type: 'movie',
        externalIds: { imdb_id: 'tt1234567' }
      })

      expect(match).toBeDefined()
      expect(match?.id).toBe('101')
    })

    it('matches exact title with exact year', () => {
      const candidates: MetadataSearchResult[] = [
        { id: '1', provider: 'tmdb', title: 'The Matrix', year: 1999, type: 'movie' },
        { id: '2', provider: 'tmdb', title: 'The Matrix Resurrections', year: 2021, type: 'movie' }
      ]

      const match = selectAutomaticMatch(candidates, {
        title: 'The Matrix',
        year: 1999,
        type: 'movie'
      })

      expect(match).toBeDefined()
      expect(match?.id).toBe('1')
    })

    it('matches exact title with fuzzy +/- 1 year release difference', () => {
      const candidates: MetadataSearchResult[] = [
        { id: '1', provider: 'tmdb', title: 'Independent Film', year: 2020, type: 'movie' }
      ]

      const match = selectAutomaticMatch(candidates, {
        title: 'Independent Film',
        year: 2021,
        type: 'movie'
      })

      expect(match).toBeDefined()
      expect(match?.id).toBe('1')
    })

    it('selects top candidate when multiple exact title matches exist and query has no year', () => {
      const candidates: MetadataSearchResult[] = [
        { id: '1', provider: 'tmdb', title: 'Beauty and the Beast', year: 1991, type: 'movie', score: 85 },
        { id: '2', provider: 'tmdb', title: 'Beauty and the Beast', year: 2017, type: 'movie', score: 70 }
      ]

      const match = selectAutomaticMatch(candidates, {
        title: 'Beauty and the Beast',
        type: 'movie'
      })

      expect(match).toBeDefined()
      expect(match?.id).toBe('1')
    })

    it('matches adult/scene titles with high confidence scores and clear separation', () => {
      const candidates: MetadataSearchResult[] = [
        { id: '55', provider: 'tmdb', title: 'Pirates II Stagnetti', year: 2008, type: 'movie', score: 95 },
        { id: '99', provider: 'tmdb', title: 'Unrelated Show', year: 2015, type: 'movie', score: 30 }
      ]

      const match = selectAutomaticMatch(candidates, {
        title: 'Pirates 2 Stagnetti (2008)',
        year: 2008,
        type: 'movie'
      })

      expect(match).toBeDefined()
      expect(match?.id).toBe('55')
    })
  })

  describe('TitleMatching & Normalization', () => {
    it('normalizes Roman numerals to arabic digits', () => {
      expect(normalizeTitleForMatching('Pirates II')).toBe('pirates 2')
      expect(normalizeTitleForMatching('Rocky IV')).toBe('rocky 4')
      expect(normalizeTitleForMatching('Star Wars Episode VI')).toBe('star wars episode 6')
    })

    it('strips adult and scene noise tokens', () => {
      expect(normalizeTitleForMatching('Movie.Title.2022.XXX.1080p.WEBRip')).toBe('movie title')
    })

    it('scores title match accurately with high confidence for overlapping names', () => {
      const score = scoreTitleMatch('Big Wet Asses 25', 'Brazzers Big Wet Asses 25', 2018, 2018)
      expect(score).toBeGreaterThanOrEqual(75)
    })
  })

  describe('isPlaceholderMusicTitle', () => {
    it('identifies placeholder artist and album titles', () => {
      expect(isPlaceholderMusicTitle('[Unknown Album]')).toBe(true)
      expect(isPlaceholderMusicTitle('Unknown Album')).toBe(true)
      expect(isPlaceholderMusicTitle('Unknown Artist')).toBe(true)
      expect(isPlaceholderMusicTitle('Various Artists')).toBe(true)
      expect(isPlaceholderMusicTitle('VA')).toBe(true)
      expect(isPlaceholderMusicTitle('title')).toBe(true)
      expect(isPlaceholderMusicTitle('track 1')).toBe(true)
      expect(isPlaceholderMusicTitle('??????')).toBe(true)
      expect(isPlaceholderMusicTitle('---')).toBe(true)
      expect(isPlaceholderMusicTitle('')).toBe(true)
      expect(isPlaceholderMusicTitle(null)).toBe(true)
      expect(isPlaceholderMusicTitle(undefined)).toBe(true)
    })

    it('allows real album and artist titles', () => {
      expect(isPlaceholderMusicTitle('Radiohead')).toBe(false)
      expect(isPlaceholderMusicTitle('OK Computer')).toBe(false)
      expect(isPlaceholderMusicTitle('1989')).toBe(false)
      expect(isPlaceholderMusicTitle('The Dark Side of the Moon')).toBe(false)
    })
  })
})
