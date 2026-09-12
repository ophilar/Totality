import { describe, it, expect } from 'vitest'
import {
  toSnakeCaseSeriesCompleteness,
  toSnakeCaseArtistCompleteness,
  toSnakeCaseQualityScore,
  toSnakeCaseMediaItem
} from '@main/database/utils/mappers'

describe('Database Mappers', () => {
  describe('toSnakeCaseSeriesCompleteness', () => {
    it('maps camelCase Drizzle ORM model input to SeriesCompleteness contract', () => {
      const input = {
        id: 101,
        seriesTitle: 'Breaking Bad',
        seriesIdentityKey: 'tmdb:1396',
        sourceId: 'src_1',
        libraryId: 'lib_1',
        totalSeasons: 5,
        totalEpisodes: 62,
        ownedSeasons: 5,
        ownedEpisodes: 62,
        missingSeasons: '[]',
        missingEpisodes: '[]',
        completenessPercentage: 100,
        efficiencyScore: 95.5,
        storageDebtBytes: 1024,
        totalSize: 50000000,
        tmdbId: '1396',
        tvdbId: '81189',
        posterUrl: 'https://image.tmdb.org/p/poster.jpg',
        backdropUrl: 'https://image.tmdb.org/p/backdrop.jpg',
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-02T00:00:00.000Z'
      }

      const result = toSnakeCaseSeriesCompleteness(input)

      expect(result).toEqual({
        id: 101,
        series_title: 'Breaking Bad',
        series_identity_key: 'tmdb:1396',
        source_id: 'src_1',
        library_id: 'lib_1',
        total_seasons: 5,
        total_episodes: 62,
        owned_seasons: 5,
        owned_episodes: 62,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 100,
        efficiency_score: 95.5,
        storage_debt_bytes: 1024,
        total_size: 50000000,
        tmdb_id: '1396',
        tvdb_id: '81189',
        poster_url: 'https://image.tmdb.org/p/poster.jpg',
        backdrop_url: 'https://image.tmdb.org/p/backdrop.jpg',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z'
      })
    })

    it('maps snake_case SQLite raw row input to SeriesCompleteness contract', () => {
      const input = {
        id: '102',
        series_title: 'Better Call Saul',
        series_identity_key: 'tmdb:60059',
        source_id: 'src_2',
        library_id: 'lib_2',
        total_seasons: '6',
        total_episodes: '63',
        owned_seasons: '6',
        owned_episodes: '60',
        missing_seasons: '[{"season":6}]',
        missing_episodes: '[{"season":6,"episode":11}]',
        completeness_percentage: '95.2',
        efficiency_score: '88.0',
        storage_debt_bytes: '2048',
        total_size: '60000000',
        tmdb_id: '60059',
        tvdb_id: '273181',
        poster_url: 'https://image.tmdb.org/p/saul_poster.jpg',
        backdrop_url: 'https://image.tmdb.org/p/saul_backdrop.jpg',
        created_at: '2023-02-01T00:00:00.000Z',
        updated_at: '2023-02-02T00:00:00.000Z'
      }

      const result = toSnakeCaseSeriesCompleteness(input)

      expect(result).toEqual({
        id: 102,
        series_title: 'Better Call Saul',
        series_identity_key: 'tmdb:60059',
        source_id: 'src_2',
        library_id: 'lib_2',
        total_seasons: 6,
        total_episodes: 63,
        owned_seasons: 6,
        owned_episodes: 60,
        missing_seasons: '[{"season":6}]',
        missing_episodes: '[{"season":6,"episode":11}]',
        completeness_percentage: 95.2,
        efficiency_score: 88,
        storage_debt_bytes: 2048,
        total_size: 60000000,
        tmdb_id: '60059',
        tvdb_id: '273181',
        poster_url: 'https://image.tmdb.org/p/saul_poster.jpg',
        backdrop_url: 'https://image.tmdb.org/p/saul_backdrop.jpg',
        created_at: '2023-02-01T00:00:00.000Z',
        updated_at: '2023-02-02T00:00:00.000Z'
      })
    })

    it('handles nested { series: { ... } } source structure', () => {
      const input = {
        series: {
          id: 103,
          seriesTitle: 'The Wire',
          totalSeasons: 5,
          totalEpisodes: 60
        }
      }

      const result = toSnakeCaseSeriesCompleteness(input)

      expect(result.id).toBe(103)
      expect(result.series_title).toBe('The Wire')
      expect(result.total_seasons).toBe(5)
      expect(result.total_episodes).toBe(60)
    })

    it('applies default fallback values for missing, empty, or undefined fields', () => {
      const input = {}

      const result = toSnakeCaseSeriesCompleteness(input)

      expect(result).toEqual({
        id: undefined,
        series_title: '',
        series_identity_key: undefined,
        source_id: undefined,
        library_id: undefined,
        total_seasons: 0,
        total_episodes: 0,
        owned_seasons: 0,
        owned_episodes: 0,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 0,
        efficiency_score: undefined,
        storage_debt_bytes: undefined,
        total_size: undefined,
        tmdb_id: undefined,
        tvdb_id: undefined,
        poster_url: undefined,
        backdrop_url: undefined,
        created_at: undefined,
        updated_at: undefined
      })
    })

    it('throws TypeError when input is not a non-null object', () => {
      expect(() => toSnakeCaseSeriesCompleteness(null)).toThrow(TypeError)
      expect(() => toSnakeCaseSeriesCompleteness(undefined)).toThrow(TypeError)
      expect(() => toSnakeCaseSeriesCompleteness('invalid')).toThrow(TypeError)
      expect(() => toSnakeCaseSeriesCompleteness(123)).toThrow(TypeError)
      expect(() => toSnakeCaseSeriesCompleteness([1, 2, 3])).toThrow(TypeError)
    })
  })

  describe('toSnakeCaseArtistCompleteness', () => {
    it('maps camelCase and snake_case fields correctly', () => {
      const input = {
        id: 201,
        artistName: 'Pink Floyd',
        musicbrainzId: 'mb-123',
        libraryId: 'lib_music',
        totalAlbums: 15,
        ownedAlbums: 14,
        totalSingles: 20,
        ownedSingles: 18,
        totalEps: 5,
        ownedEps: 5,
        missingAlbums: '["The Final Cut"]',
        completenessPercentage: 93.3,
        efficiencyScore: 90,
        storageDebtBytes: 500,
        totalSize: 100000,
        country: 'UK',
        activeYears: '1965-present',
        artistType: 'Group',
        thumbUrl: 'https://example.com/pf.jpg',
        lastSyncAt: '2023-03-01T00:00:00.000Z',
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-02T00:00:00.000Z'
      }

      const result = toSnakeCaseArtistCompleteness(input)

      expect(result).toEqual({
        id: 201,
        artist_name: 'Pink Floyd',
        musicbrainz_id: 'mb-123',
        library_id: 'lib_music',
        total_albums: 15,
        owned_albums: 14,
        total_singles: 20,
        owned_singles: 18,
        total_eps: 5,
        owned_eps: 5,
        missing_albums: '["The Final Cut"]',
        missing_singles: '[]',
        missing_eps: '[]',
        completeness_percentage: 93.3,
        efficiency_score: 90,
        storage_debt_bytes: 500,
        total_size: 100000,
        country: 'UK',
        active_years: '1965-present',
        artist_type: 'Group',
        thumb_url: 'https://example.com/pf.jpg',
        last_sync_at: '2023-03-01T00:00:00.000Z',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z'
      })
    })

    it('handles nested { artist: { ... } } structure and defaults', () => {
      const result = toSnakeCaseArtistCompleteness({
        artist: {
          artist_name: 'Led Zeppelin'
        }
      })

      expect(result.artist_name).toBe('Led Zeppelin')
      expect(result.missing_albums).toBe('[]')
      expect(result.completeness_percentage).toBe(0)
    })

    it('throws TypeError when input is not an object', () => {
      expect(() => toSnakeCaseArtistCompleteness(null)).toThrow(TypeError)
    })
  })

  describe('toSnakeCaseQualityScore', () => {
    it('maps quality score properties and boolean flags', () => {
      const input = {
        id: 301,
        mediaItemId: 10,
        qualityTier: 'Tier A',
        tierQuality: 'High',
        tierScore: 85,
        bitrateTierScore: 80,
        audioTierScore: 90,
        overallScore: 88,
        resolutionScore: 100,
        bitrateScore: 80,
        audioScore: 90,
        efficiencyScore: 85,
        storageDebtBytes: 0,
        evidenceStatus: 'verified',
        confidence: 'high',
        savingsBasis: 'standard',
        isLowQuality: 1,
        needsUpgrade: true,
        issues: '[]',
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-02T00:00:00.000Z'
      }

      const result = toSnakeCaseQualityScore(input)

      expect(result.id).toBe(301)
      expect(result.media_item_id).toBe(10)
      expect(result.quality_tier).toBe('Tier A')
      expect(result.is_low_quality).toBe(true)
      expect(result.needs_upgrade).toBe(true)
    })

    it('throws TypeError when input is not an object', () => {
      expect(() => toSnakeCaseQualityScore(null)).toThrow(TypeError)
    })
  })

  describe('toSnakeCaseMediaItem', () => {
    it('maps MediaItem and optional quality relation', () => {
      const itemInput = {
        id: 401,
        title: 'Inception',
        year: 2010,
        resolution: '1080p',
        sourceId: 'src_m',
        libraryId: 'lib_m',
        tmdbId: '27205',
        hasObjectAudio: 1,
        userFixedMatch: true
      }

      const qualityInput = {
        qualityTier: 'Tier S',
        overallScore: 98,
        needsUpgrade: false,
        isLowQuality: 0
      }

      const result = toSnakeCaseMediaItem(itemInput, qualityInput)

      expect(result.id).toBe(401)
      expect(result.title).toBe('Inception')
      expect(result.year).toBe(2010)
      expect(result.source_id).toBe('src_m')
      expect(result.tmdb_id).toBe('27205')
      expect(result.has_object_audio).toBe(true)
      expect(result.user_fixed_match).toBe(true)
      expect(result.match_status).toBe('manual')
      expect(result.quality_tier).toBe('Tier S')
      expect(result.overall_score).toBe(98)
    })

    it('throws TypeError when input is not an object', () => {
      expect(() => toSnakeCaseMediaItem(null)).toThrow(TypeError)
    })
  })
})
