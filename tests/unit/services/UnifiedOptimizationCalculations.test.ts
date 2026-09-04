import { describe, it, expect, beforeEach } from 'vitest'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '../../../src/main/database/BetterSQLiteService'

describe('Unified Optimization Metrics Calculations', () => {
  let db: ReturnType<typeof getDatabase>

  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'
    db = getDatabase()
    await db.initialize(':memory:')

    await db.sources.upsertSource({
      source_id: 'src-opt',
      source_type: 'local',
      display_name: 'Optimization Source',
      connection_config: '{}',
      is_enabled: 1
    })
  })

  describe('MediaRepository.getOptimizationMetricsSummary (Movies)', () => {
    it('returns unknown status and null metrics when no items are scored', async () => {
      await db.media.upsertItem({
        source_id: 'src-opt',
        library_id: 'movies',
        plex_id: 'movie-1',
        title: 'Unscored Movie 1',
        type: 'movie',
        file_path: '/movies/m1.mkv',
        file_size: 2000000000
      })

      const summary = await db.media.getOptimizationMetricsSummary({ type: 'movie' })

      expect(summary.status).toBe('unknown')
      expect(summary.totalCount).toBe(1)
      expect(summary.knownCount).toBe(0)
      expect(summary.overallEfficiencyScore).toBeNull()
      expect(summary.totalStorageDebtBytes).toBeNull()
      expect(summary.recoverableWasteBytes).toBeNull()
      expect(summary.confidenceScore).toBe(0)
    })

    it('returns partial status when only a subset of items are scored', async () => {
      const item1Id = await db.media.upsertItem({
        source_id: 'src-opt',
        library_id: 'movies',
        plex_id: 'movie-1',
        title: 'Scored Movie 1',
        type: 'movie',
        file_path: '/movies/m1.mkv',
        file_size: 2000000000
      })

      await db.media.upsertQualityScore({
        media_item_id: item1Id,
        efficiency_score: 80,
        storage_debt_bytes: 500000000,
        evidence_status: 'measured',
        quality_tier: '1080p'
      })

      await db.media.upsertItem({
        source_id: 'src-opt',
        library_id: 'movies',
        plex_id: 'movie-2',
        title: 'Unscored Movie 2',
        type: 'movie',
        file_path: '/movies/m2.mkv',
        file_size: 3000000000
      })

      const summary = await db.media.getOptimizationMetricsSummary({ type: 'movie' })

      expect(summary.status).toBe('partial')
      expect(summary.totalCount).toBe(2)
      expect(summary.knownCount).toBe(1)
      expect(summary.overallEfficiencyScore).toBe(80)
      expect(summary.recoverableWasteBytes).toBe(500000000)
      expect(summary.confidenceScore).toBe(50)
    })

    it('returns complete status when all items are scored', async () => {
      const item1Id = await db.media.upsertItem({
        source_id: 'src-opt',
        library_id: 'movies',
        plex_id: 'movie-1',
        title: 'Movie 1',
        type: 'movie',
        file_path: '/movies/m1.mkv',
        file_size: 2000000000
      })
      await db.media.upsertQualityScore({
        media_item_id: item1Id,
        efficiency_score: 60,
        storage_debt_bytes: 400000000,
        evidence_status: 'measured'
      })

      const item2Id = await db.media.upsertItem({
        source_id: 'src-opt',
        library_id: 'movies',
        plex_id: 'movie-2',
        title: 'Movie 2',
        type: 'movie',
        file_path: '/movies/m2.mkv',
        file_size: 2000000000
      })
      await db.media.upsertQualityScore({
        media_item_id: item2Id,
        efficiency_score: 80,
        storage_debt_bytes: 100000000,
        evidence_status: 'measured'
      })

      const summary = await db.media.getOptimizationMetricsSummary({ type: 'movie' })

      expect(summary.status).toBe('complete')
      expect(summary.totalCount).toBe(2)
      expect(summary.knownCount).toBe(2)
      expect(summary.overallEfficiencyScore).toBe(70)
      expect(summary.recoverableWasteBytes).toBe(500000000)
      expect(summary.confidenceScore).toBe(100)
    })

    it('supports sorting by efficiency and waste aliases', async () => {
      const item1Id = await db.media.upsertItem({
        source_id: 'src-opt',
        library_id: 'movies',
        plex_id: 'movie-1',
        title: 'Low Efficiency',
        type: 'movie',
        file_path: '/movies/m1.mkv',
        file_size: 1000
      })
      await db.media.upsertQualityScore({
        media_item_id: item1Id,
        efficiency_score: 40,
        storage_debt_bytes: 600,
        evidence_status: 'measured'
      })

      const item2Id = await db.media.upsertItem({
        source_id: 'src-opt',
        library_id: 'movies',
        plex_id: 'movie-2',
        title: 'High Efficiency',
        type: 'movie',
        file_path: '/movies/m2.mkv',
        file_size: 1000
      })
      await db.media.upsertQualityScore({
        media_item_id: item2Id,
        efficiency_score: 90,
        storage_debt_bytes: 100,
        evidence_status: 'measured'
      })

      const sortedByEfficiency = await db.media.getItems({ type: 'movie', sortBy: 'efficiency', sortOrder: 'desc' })
      expect(sortedByEfficiency[0].title).toBe('High Efficiency')

      const sortedByWaste = await db.media.getItems({ type: 'movie', sortBy: 'waste', sortOrder: 'desc' })
      expect(sortedByWaste[0].title).toBe('Low Efficiency')
    })
  })

  describe('TVShowRepository.getOptimizationMetricsSummary', () => {
    it('returns unknown status when shows have no efficiency scored', async () => {
      await db.tvShows.upsertCompleteness({
        series_title: 'Unscored Series',
        source_id: 'src-opt',
        library_id: 'tv',
        total_seasons: 1,
        total_episodes: 10,
        owned_seasons: 1,
        owned_episodes: 10,
        completeness_percentage: 100,
        efficiency_score: undefined
      })

      const summary = await db.tvShows.getOptimizationMetricsSummary({ sourceId: 'src-opt', libraryId: 'tv' })

      expect(summary.status).toBe('unknown')
      expect(summary.knownCount).toBe(0)
      expect(summary.overallEfficiencyScore).toBeNull()
      expect(summary.recoverableWasteBytes).toBeNull()
    })

    it('returns partial and complete status as efficiency scores populate', async () => {
      await db.tvShows.upsertCompleteness({
        series_title: 'Series A',
        source_id: 'src-opt',
        library_id: 'tv',
        total_seasons: 1,
        total_episodes: 10,
        owned_seasons: 1,
        owned_episodes: 10,
        completeness_percentage: 100,
        efficiency_score: 75,
        storage_debt_bytes: 1000000,
        evidence_status: 'measured',
        total_size: 10000000
      })

      await db.tvShows.upsertCompleteness({
        series_title: 'Series B',
        source_id: 'src-opt',
        library_id: 'tv',
        total_seasons: 1,
        total_episodes: 10,
        owned_seasons: 1,
        owned_episodes: 10,
        completeness_percentage: 100,
        efficiency_score: undefined,
        total_size: 10000000
      })

      let summary = await db.tvShows.getOptimizationMetricsSummary({ sourceId: 'src-opt', libraryId: 'tv' })
      expect(summary.status).toBe('partial')
      expect(summary.knownCount).toBe(1)
      expect(summary.totalCount).toBe(2)
      expect(summary.overallEfficiencyScore).toBe(75)
      expect(summary.recoverableWasteBytes).toBe(1000000)

      // Update Series B
      await db.tvShows.upsertCompleteness({
        series_title: 'Series B',
        source_id: 'src-opt',
        library_id: 'tv',
        total_seasons: 1,
        total_episodes: 10,
        owned_seasons: 1,
        owned_episodes: 10,
        completeness_percentage: 100,
        efficiency_score: 85,
        storage_debt_bytes: 2000000,
        evidence_status: 'measured',
        total_size: 10000000
      })

      summary = await db.tvShows.getOptimizationMetricsSummary({ sourceId: 'src-opt', libraryId: 'tv' })
      expect(summary.status).toBe('complete')
      expect(summary.knownCount).toBe(2)
      expect(summary.totalCount).toBe(2)
      expect(summary.overallEfficiencyScore).toBe(80)
      expect(summary.recoverableWasteBytes).toBe(3000000)
    })
  })
})
