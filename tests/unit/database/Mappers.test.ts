import { describe, expect, it } from 'vitest'
import {
  toSnakeCaseArtistCompleteness,
  toSnakeCaseMediaItem,
  toSnakeCaseQualityScore,
  toSnakeCaseSeriesCompleteness,
} from '@main/database/utils/mappers'

describe('Database Mappers', () => {
  describe('toSnakeCaseArtistCompleteness', () => {
    it('maps Drizzle camelCase fields correctly to snake_case contract', () => {
      const input = {
        id: 1,
        artistName: 'The Beatles',
        musicbrainzId: 'mb-123',
        libraryId: 'lib-1',
        totalAlbums: 12,
        ownedAlbums: 10,
        totalSingles: 5,
        ownedSingles: 4,
        totalEps: 3,
        ownedEps: 2,
        missingAlbums: '["Abbey Road"]',
        missingSingles: '["Let It Be"]',
        missingEps: '["Magical Mystery Tour"]',
        completenessPercentage: 85.5,
        efficiencyScore: 92.0,
        storageDebtBytes: 1024,
        totalSize: 2048,
        country: 'UK',
        activeYears: '1960-1970',
        artistType: 'Group',
        thumbUrl: 'http://example.com/thumb.jpg',
        lastSyncAt: '2025-01-01T00:00:00Z',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      }

      const result = toSnakeCaseArtistCompleteness(input)

      expect(result).toEqual({
        id: 1,
        artist_name: 'The Beatles',
        musicbrainz_id: 'mb-123',
        library_id: 'lib-1',
        total_albums: 12,
        owned_albums: 10,
        total_singles: 5,
        owned_singles: 4,
        total_eps: 3,
        owned_eps: 2,
        missing_albums: '["Abbey Road"]',
        missing_singles: '["Let It Be"]',
        missing_eps: '["Magical Mystery Tour"]',
        completeness_percentage: 85.5,
        efficiency_score: 92.0,
        storage_debt_bytes: 1024,
        total_size: 2048,
        country: 'UK',
        active_years: '1960-1970',
        artist_type: 'Group',
        thumb_url: 'http://example.com/thumb.jpg',
        last_sync_at: '2025-01-01T00:00:00Z',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
      })
    })

    it('maps raw SQLite snake_case fields correctly', () => {
      const input = {
        id: '2',
        artist_name: 'Pink Floyd',
        musicbrainz_id: 'mb-456',
        library_id: 'lib-2',
        total_albums: 15,
        owned_albums: 15,
        total_singles: 2,
        owned_singles: 2,
        total_eps: 1,
        owned_eps: 1,
        missing_albums: '[]',
        missing_singles: '[]',
        missing_eps: '[]',
        completeness_percentage: 100,
        efficiency_score: 95,
        storage_debt_bytes: 0,
        total_size: 4096,
        country: 'UK',
        active_years: '1965-1995',
        artist_type: 'Group',
        thumb_url: 'http://example.com/pf.jpg',
        last_sync_at: '2025-01-01T00:00:00Z',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
      }

      const result = toSnakeCaseArtistCompleteness(input)

      expect(result.id).toBe(2)
      expect(result.artist_name).toBe('Pink Floyd')
      expect(result.musicbrainz_id).toBe('mb-456')
      expect(result.completeness_percentage).toBe(100)
    })

    it('maps nested artist object wrapper structure', () => {
      const input = {
        artist: {
          id: 3,
          artistName: 'Radiohead',
          musicbrainzId: 'mb-789',
        },
      }

      const result = toSnakeCaseArtistCompleteness(input)

      expect(result.id).toBe(3)
      expect(result.artist_name).toBe('Radiohead')
      expect(result.musicbrainz_id).toBe('mb-789')
    })

    it('handles missing optional fields and provides default values', () => {
      const input = {}

      const result = toSnakeCaseArtistCompleteness(input)

      expect(result.id).toBeUndefined()
      expect(result.artist_name).toBe('')
      expect(result.musicbrainz_id).toBeUndefined()
      expect(result.library_id).toBeUndefined()
      expect(result.total_albums).toBe(0)
      expect(result.owned_albums).toBe(0)
      expect(result.total_singles).toBe(0)
      expect(result.owned_singles).toBe(0)
      expect(result.total_eps).toBe(0)
      expect(result.owned_eps).toBe(0)
      expect(result.missing_albums).toBe('[]')
      expect(result.missing_singles).toBe('[]')
      expect(result.missing_eps).toBe('[]')
      expect(result.completeness_percentage).toBe(0)
      expect(result.efficiency_score).toBeUndefined()
      expect(result.storage_debt_bytes).toBeUndefined()
      expect(result.total_size).toBeUndefined()
      expect(result.country).toBeUndefined()
      expect(result.active_years).toBeUndefined()
      expect(result.artist_type).toBeUndefined()
      expect(result.thumb_url).toBeUndefined()
      expect(result.last_sync_at).toBeUndefined()
      expect(result.created_at).toBeUndefined()
      expect(result.updated_at).toBeUndefined()
    })

    it('throws TypeError for non-object inputs', () => {
      expect(() => toSnakeCaseArtistCompleteness(null)).toThrow(TypeError)
      expect(() => toSnakeCaseArtistCompleteness(123)).toThrow(TypeError)
      expect(() => toSnakeCaseArtistCompleteness('invalid')).toThrow(TypeError)
      expect(() => toSnakeCaseArtistCompleteness([])).toThrow(TypeError)
    })
  })

  describe('toSnakeCaseMediaItem', () => {
    it('maps MediaItem and QualityScore fields correctly', () => {
      const itemRow = {
        id: '1',
        title: 'Inception',
        year: 2010,
        resolution: '1080p',
        sourceId: 'src-1',
        libraryId: 'lib-1',
        filePath: '/media/inception.mkv',
        fileSize: 5000000000,
        userFixedMatch: 1,
        tmdbId: '27205',
      }
      const qualityRow = {
        qualityTier: 'Tier A',
        overallScore: 90,
        needsUpgrade: 0,
        isLowQuality: 0,
      }

      const result = toSnakeCaseMediaItem(itemRow, qualityRow)

      expect(result.id).toBe('1')
      expect(result.title).toBe('Inception')
      expect(result.year).toBe(2010)
      expect(result.source_id).toBe('src-1')
      expect(result.quality_tier).toBe('Tier A')
      expect(result.overall_score).toBe(90)
    })
  })

  describe('toSnakeCaseQualityScore', () => {
    it('maps QualityScore fields correctly', () => {
      const row = {
        id: 10,
        mediaItemId: 1,
        qualityTier: 'Tier A',
        tierQuality: 'High',
        overallScore: 85,
        isLowQuality: false,
        needsUpgrade: false,
        issues: 'None',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
      }

      const result = toSnakeCaseQualityScore(row)

      expect(result.id).toBe(10)
      expect(result.media_item_id).toBe(1)
      expect(result.quality_tier).toBe('Tier A')
      expect(result.overall_score).toBe(85)
      expect(result.is_low_quality).toBe(false)
    })
  })

  describe('toSnakeCaseSeriesCompleteness', () => {
    it('maps SeriesCompleteness fields correctly', () => {
      const row = {
        id: 5,
        seriesTitle: 'Breaking Bad',
        totalSeasons: 5,
        ownedSeasons: 5,
        totalEpisodes: 62,
        ownedEpisodes: 62,
        missingSeasons: '[]',
        missingEpisodes: '[]',
        completenessPercentage: 100,
      }

      const result = toSnakeCaseSeriesCompleteness(row)

      expect(result.id).toBe(5)
      expect(result.series_title).toBe('Breaking Bad')
      expect(result.total_seasons).toBe(5)
      expect(result.completeness_percentage).toBe(100)
    })
  })
})
