import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseDatabaseError } from '../../../src/main/services/utils/errorUtils'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '../../../src/main/database/BetterSQLiteService'
import { SeriesCompletenessService } from '../../../src/main/services/SeriesCompletenessService'
import { resetTMDBServiceForTesting } from '../../../src/main/services/TMDBService'

describe('SeriesDatabaseDiagnostics and Conflict Resolution', () => {
  let db: ReturnType<typeof getDatabase>
  let service: SeriesCompletenessService

  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    resetTMDBServiceForTesting()
    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'
    db = getDatabase()
    await db.initialize(':memory:')
    service = new SeriesCompletenessService()
  })

  describe('parseDatabaseError', () => {
    it('extracts constraint name and cause from SQLite UNIQUE constraint error', () => {
      const err = new Error('UNIQUE constraint failed: series_completeness.source_id, series_completeness.library_id, series_completeness.tmdb_id')
      const parsed = parseDatabaseError(err)

      expect(parsed.isDatabaseError).toBe(true)
      expect(parsed.constraint).toBe('series_completeness.source_id, series_completeness.library_id, series_completeness.tmdb_id')
      expect(parsed.cause).toContain('UNIQUE constraint failed')
    })

    it('extracts inner cause and code when present', () => {
      const innerCause = { message: 'SQLITE_CONSTRAINT: foreign key violation', code: 'SQLITE_CONSTRAINT_FOREIGNKEY' }
      const err = new Error('Query execution failed')
      ;(err as unknown as { cause: unknown }).cause = innerCause

      const parsed = parseDatabaseError(err)
      expect(parsed.isDatabaseError).toBe(true)
      expect(parsed.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
      expect(parsed.cause).toContain('foreign key violation')
    })

    it('identifies non-database errors correctly', () => {
      const err = new Error('getaddrinfo ENOTFOUND api.themoviedb.org')
      const parsed = parseDatabaseError(err)
      expect(parsed.isDatabaseError).toBe(false)
      expect(parsed.constraint).toBeUndefined()
    })
  })

  describe('Star Trek unique constraint conflict resolution in TVShowRepository', () => {
    it('updates target and resolves conflict without throwing UNIQUE constraint failed', async () => {
      await db.sources.upsertSource({
        source_id: 'src-st',
        source_type: 'local',
        display_name: 'Star Trek Source',
        connection_config: '{}',
        is_enabled: 1
      })

      const unresolvedId = await db.tvShows.upsertCompleteness({
        series_title: 'Star Trek (1966)',
        source_id: 'src-st',
        library_id: 'tv',
        total_seasons: 3,
        total_episodes: 79,
        owned_seasons: 3,
        owned_episodes: 79,
        completeness_percentage: null,
        series_identity_key: 'unresolved:src-st:tv:star-trek-1966',
        user_fixed_match: false
      })

      const canonicalId = await db.tvShows.upsertCompleteness({
        series_title: 'Star Trek: The Original Series',
        source_id: 'src-st',
        library_id: 'tv',
        total_seasons: 3,
        total_episodes: 79,
        owned_seasons: 3,
        owned_episodes: 79,
        completeness_percentage: 100,
        tmdb_id: '253',
        series_identity_key: 'tmdb:253',
        user_fixed_match: false
      })

      expect(unresolvedId).not.toBe(canonicalId)

      const resultId = await db.tvShows.upsertCompleteness({
        series_title: 'Star Trek (1966)',
        source_id: 'src-st',
        library_id: 'tv',
        total_seasons: 3,
        total_episodes: 79,
        owned_seasons: 3,
        owned_episodes: 79,
        completeness_percentage: 100,
        tmdb_id: '253',
        series_identity_key: 'tmdb:253',
        user_fixed_match: false
      })

      expect(resultId).toBe(canonicalId)

      const allRows = await db.tvShows.getAllCompleteness('src-st', 'tv')
      expect(allRows.length).toBe(1)
      expect(allRows[0].id).toBe(canonicalId)
      expect(allRows[0].tmdb_id).toBe('253')
    })
  })

  describe('analyzeAllSeries independent transaction and diagnostic reporting', () => {
    it('isolates database failure on one series and captures decomposed diagnostic without aborting entire run', async () => {
      await db.sources.upsertSource({
        source_id: 'src-multi',
        source_type: 'local',
        display_name: 'Multi Source',
        connection_config: '{}',
        is_enabled: 1
      })

      await db.media.upsertItem({
        source_id: 'src-multi',
        library_id: 'tv',
        plex_id: 'ep-a',
        series_title: 'Show A',
        season_number: 1,
        episode_number: 1,
        type: 'episode',
        file_path: '/tv/Show A/S01E01.mkv',
        file_size: 1000,
        title: 'Episode 1'
      })

      await db.media.upsertItem({
        source_id: 'src-multi',
        library_id: 'tv',
        plex_id: 'ep-b',
        series_title: 'Show B',
        season_number: 1,
        episode_number: 1,
        type: 'episode',
        file_path: '/tv/Show B/S01E01.mkv',
        file_size: 1000,
        title: 'Episode 1'
      })

      vi.spyOn(service, 'analyzeSeries').mockImplementation(async (title) => {
        if (title === 'Show A') {
          const dbErr = new Error('UNIQUE constraint failed: series_completeness.series_identity_key')
          throw dbErr
        }
        return {
          series_title: 'Show B',
          completeness_percentage: 100
        } as any
      })

      const outcome = await service.analyzeAllSeries('src-multi', 'tv')

      expect(outcome.status).toBe('partial')
      expect(outcome.completedCount).toBe(1)
      expect(outcome.failedCount).toBe(1)
      expect(outcome.diagnostics.length).toBe(1)

      const diag = outcome.diagnostics[0]
      expect(diag.itemType).toBe('series')
      expect(diag.itemName).toBe('Show A')
      expect(diag.category).toBe('database')
      expect(diag.code).toContain('CONSTRAINT')
      expect(diag.cause).toContain('series_completeness.series_identity_key')
    })
  })
})
