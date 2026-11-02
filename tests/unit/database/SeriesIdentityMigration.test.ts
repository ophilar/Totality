import { beforeEach, describe, expect, it } from 'vitest'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import { runMigrations } from '@main/database/DatabaseMigration'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'

describe('series identity migration', () => {
  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    process.env.NODE_ENV = 'test'
    await getDatabase().initialize(':memory:')
  })

  it('backfills canonical identities for historical completeness and episode rows', async () => {
    const db = getDatabase()
    const sourceId = 'legacy-source'
    const libraryId = 'legacy-tv'

    const resolvedCompletenessId = await db.tvShows.upsertCompleteness({
      series_title: 'Resolved Legacy Show',
      series_identity_key: 'tmdb:701',
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: 100,
      tmdb_id: '701',
    })
    const unresolvedCompletenessId = await db.tvShows.upsertCompleteness({
      series_title: 'Unresolved Legacy Show',
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: 100,
      series_identity_key: 'unresolved:legacy-source:legacy-tv:unresolved-legacy-show',
    })

    const resolvedEpisodeId = await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'legacy-resolved-episode',
      type: 'episode',
      title: 'Episode 1',
      series_title: 'Resolved Legacy Show',
      series_tmdb_id: '701',
      season_number: 1,
      episode_number: 1,
      file_path: '/legacy/resolved/S01E01.mkv',
    })
    const unresolvedEpisodeId = await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'legacy-unresolved-episode',
      type: 'episode',
      title: 'Episode 1',
      series_title: 'Unresolved Legacy Show',
      season_number: 1,
      episode_number: 1,
      file_path: '/legacy/unresolved/S01E01.mkv',
    })

    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert')
    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_update')
    await db.db.execute({
      sql: 'UPDATE series_completeness SET series_identity_key = NULL WHERE id IN (?, ?)',
      args: [resolvedCompletenessId, unresolvedCompletenessId],
    })
    await db.db.execute({
      sql: 'UPDATE media_items SET series_identity_key = NULL WHERE id IN (?, ?)',
      args: [resolvedEpisodeId, unresolvedEpisodeId],
    })

    await runMigrations(db.db)

    const completenessRows = await db.tvShows.getAllCompleteness(sourceId, libraryId)
    const resolvedCompleteness = completenessRows.find(row => row.id === resolvedCompletenessId)
    const unresolvedCompleteness = completenessRows.find(row => row.id === unresolvedCompletenessId)
    const expectedUnresolvedKey = deriveSeriesIdentityKey({
      sourceId,
      libraryId,
      folderRelativePath: 'Unresolved Legacy Show',
    })

    expect(resolvedCompleteness?.series_identity_key).toBe('tmdb:701')
    expect(unresolvedCompleteness?.series_identity_key).toBe(expectedUnresolvedKey)

    const resolvedEpisodes = await db.tvShows.getEpisodes('Resolved Legacy Show', sourceId, 'tmdb:701', libraryId)
    const unresolvedEpisodes = await db.tvShows.getEpisodes('Unresolved Legacy Show', sourceId, expectedUnresolvedKey, libraryId)
    expect(resolvedEpisodes.map(episode => episode.id)).toEqual([resolvedEpisodeId])
    expect(unresolvedEpisodes.map(episode => episode.id)).toEqual([unresolvedEpisodeId])
  })

  it('rejects completeness rows without a canonical identity after migration', async () => {
    const db = getDatabase()
    const now = new Date().toISOString()

    await expect(db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, ?, ?)`,
      args: ['Missing Identity', 'source', 'tv', now, now],
    })).rejects.toThrow()
  })

  it('rejects duplicate canonical identities in the same source and library', async () => {
    const db = getDatabase()
    const now = new Date().toISOString()

    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, ?, ?)`,
      args: ['Unique Identity A', 'unresolved:source:tv:unique-identity', 'source', 'tv', now, now],
    })

    await expect(db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, ?, ?)`,
      args: ['Unique Identity B', 'unresolved:source:tv:unique-identity', 'source', 'tv', now, now],
    })).rejects.toThrow()
  })

  it('backfills and deduplicates legacy null identities while an old unique index exists', async () => {
    const db = getDatabase()
    const now = new Date().toISOString()
    const identityKey = deriveSeriesIdentityKey({
      sourceId: 'legacy-source',
      libraryId: 'legacy-tv',
      folderRelativePath: 'Duplicate Show',
    })

    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert')
    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_update')
    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        created_at, updated_at
      ) VALUES
        (?, NULL, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, ?, ?),
        (?, NULL, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, ?, ?)`,
      args: [
        'Duplicate Show', 'legacy-source', 'legacy-tv', now, now,
        'Duplicate Show', 'legacy-source', 'legacy-tv', now, now,
      ],
    })

    await runMigrations(db.db)

    const rows = (await db.tvShows.getAllCompleteness('legacy-source', 'legacy-tv'))
      .filter(row => row.series_identity_key === identityKey)
    expect(rows).toHaveLength(1)

    await expect(db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, ?, ?)`,
      args: ['Duplicate Show Again', identityKey, 'legacy-source', 'legacy-tv', now, now],
    })).rejects.toThrow()
  })

  it('realigns mismatched per-episode identity keys to canonical series key and recovers all episodes', async () => {
    const db = getDatabase()
    const sourceId = 'src-plex'
    const libraryId = '2'
    const seriesTmdbId = '83867'
    const now = new Date().toISOString()

    // Simulate scanned episodes where each episode got its own individual episode TMDB ID as series_identity_key
    const ep1Id = await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'ep-1',
      type: 'episode',
      title: 'Episode 1',
      series_title: 'Example Series',
      series_tmdb_id: seriesTmdbId,
      series_identity_key: 'tmdb:3745389', // individual episode 1 ID
      season_number: 1,
      episode_number: 1,
      file_path: '/media/Example Series/S01E01.mkv',
    })
    const ep2Id = await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'ep-2',
      type: 'episode',
      title: 'Episode 2',
      series_title: 'Example Series',
      series_tmdb_id: seriesTmdbId,
      series_identity_key: 'tmdb:3745391', // individual episode 2 ID
      season_number: 1,
      episode_number: 2,
      file_path: '/media/Example Series/S01E02.mkv',
    })
    const ep3Id = await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'ep-3',
      type: 'episode',
      title: 'Episode 3',
      series_title: 'Example Series',
      series_tmdb_id: seriesTmdbId,
      series_identity_key: 'tmdb:5747440', // individual episode 3 ID
      season_number: 2,
      episode_number: 1,
      file_path: '/media/Example Series/S02E01.mkv',
    })

    // Simulate series_completeness having only episode 3's key
    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert')
    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_update')
    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 2, 24, 1, 1, '[]', '[]', 4, ?, ?)`,
      args: ['Example Series', 'tmdb:5747440', sourceId, libraryId, seriesTmdbId, now, now],
    })

    // Before migration, querying with series_completeness's key returns ONLY 1 episode
    const episodesBefore = await db.tvShows.getEpisodes('Example Series', sourceId, 'tmdb:5747440', libraryId)
    expect(episodesBefore).toHaveLength(1)

    // Run migration
    await runMigrations(db.db)

    // After migration, series_identity_key for all 3 episodes is aligned to tmdb:83867
    const canonicalKey = `tmdb:${seriesTmdbId}`
    const episodesAfter = await db.tvShows.getEpisodes('Example Series', sourceId, canonicalKey, libraryId)
    expect(episodesAfter).toHaveLength(3)
    expect(episodesAfter.map(e => e.id)).toEqual([ep1Id, ep2Id, ep3Id])

    // Series completeness row is also updated to the canonical key
    const compRows = (await db.tvShows.getAllCompleteness(sourceId, libraryId))
      .filter(r => r.series_title === 'Example Series')
    expect(compRows).toHaveLength(1)
    expect(compRows[0].series_identity_key).toBe(canonicalKey)

    // Summaries returns all 3 owned episodes
    const summaries = await db.tvShows.getSummaries({ sourceId, libraryId })
    const exampleSeriesSummary = summaries.find(s => s.series_title === 'Example Series')
    expect(exampleSeriesSummary?.owned_episodes).toBe(3)
  })
})
