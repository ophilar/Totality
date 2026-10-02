import { beforeEach, describe, expect, it } from 'vitest'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'

describe('TVShowRepository duplicate consolidation', () => {
  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    process.env.NODE_ENV = 'test'
    await getDatabase().initialize(':memory:')
  })

  it('consolidates duplicate summaries only for the same verified provider identity and owner', async () => {
    const db = getDatabase()
    const sourceId = 'verified-duplicate-source'
    const libraryId = 'tv-main'
    const now = new Date().toISOString()
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_unique')
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_tmdb')
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_tvdb')
    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert')
    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id, total_seasons,
        total_episodes, owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, tvdb_id, created_at, updated_at
      ) VALUES
        ('Star Trek', 'legacy:star-trek-one', ?, ?, 5, 50, 1, 10, '[]', '[]', 20, '253', '371980', ?, ?),
        ('Different local title', 'legacy:star-trek-two', ?, ?, 5, 50, 1, 5, '[]', '[]', 10, '253', '371980', ?, ?),
        ('Star Trek', 'tmdb:253', ?, 'tv-other', 5, 50, 1, 8, '[]', '[]', 16, '253', '371980', ?, ?)` ,
      args: [sourceId, libraryId, now, now, sourceId, libraryId, now, now, sourceId, now, now],
    })

    const outcome = await db.tvShows.mergeDuplicateShowsWithOutcome(sourceId, libraryId)
    expect(outcome).toEqual({ merged: 1, preservedLocked: 0, ambiguous: 0 })
    const owned = await db.tvShows.getAllCompleteness(sourceId, libraryId)
    expect(owned).toHaveLength(1)
    expect(owned[0].series_identity_key).toBe('tmdb:253')
    expect(await db.tvShows.getAllCompleteness(sourceId, 'tv-other')).toHaveLength(1)
  })

  it('preserves locked summaries when duplicate provider identity is shared', async () => {
    const db = getDatabase()
    const sourceId = 'locked-duplicate-source'
    const libraryId = 'tv'
    const now = new Date().toISOString()
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_unique')
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_tmdb')
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_tvdb')
    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert')
    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id, total_seasons,
        total_episodes, owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, user_fixed_match, created_at, updated_at
      ) VALUES
        ('Same title', 'legacy:locked-one', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '999', 1, ?, ?),
        ('Unrelated title', 'legacy:locked-two', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '999', 0, ?, ?)` ,
      args: [sourceId, libraryId, now, now, sourceId, libraryId, now, now],
    })

    const outcome = await db.tvShows.mergeDuplicateShowsWithOutcome(sourceId, libraryId)
    expect(outcome).toEqual({ merged: 0, preservedLocked: 1, ambiguous: 0 })
    expect(await db.tvShows.getAllCompleteness(sourceId, libraryId)).toHaveLength(2)
  })

  it('reports and preserves duplicate groups with conflicting provider identities', async () => {
    const db = getDatabase()
    const sourceId = 'conflicting-duplicate-source'
    const libraryId = 'tv'
    const now = new Date().toISOString()
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_unique')
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_tmdb')
    await db.db.execute('DROP INDEX IF EXISTS idx_series_completeness_tvdb')
    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert')
    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id, total_seasons,
        total_episodes, owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, tvdb_id, created_at, updated_at
      ) VALUES
        ('First title', 'legacy:first', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '123', '456', ?, ?),
        ('Second title', 'legacy:second', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '123', '789', ?, ?)` ,
      args: [sourceId, libraryId, now, now, sourceId, libraryId, now, now],
    })

    const outcome = await db.tvShows.mergeDuplicateShowsWithOutcome(sourceId, libraryId)
    expect(outcome).toEqual({ merged: 0, preservedLocked: 0, ambiguous: 1 })
    expect(await db.tvShows.getAllCompleteness(sourceId, libraryId)).toHaveLength(2)
  })

  it('does not let one unresolved row bridge distinct resolved same-title identities', async () => {
    const db = getDatabase()
    const sourceId = 'duplicate-source'
    const libraryId = 'tv'
    const title = 'Shared Bridge Title'
    const unresolvedKey = deriveSeriesIdentityKey({
      sourceId,
      libraryId,
      folderRelativePath: title,
    })
    const now = new Date().toISOString()

    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        tmdb_id, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, NULL, ?, ?),
        (?, 'tmdb:601', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '601', ?, ?),
        (?, 'tmdb:602', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '602', ?, ?)`,
      args: [
        title, unresolvedKey, sourceId, libraryId, now, now,
        title, sourceId, libraryId, now, now,
        title, sourceId, libraryId, now, now,
      ],
    })

    await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'episode-unresolved-bridge',
      type: 'episode',
      title: 'Unresolved Episode',
      series_title: title,
      series_identity_key: unresolvedKey,
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/unresolved/S01E01.mkv',
    })
    await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'episode-601-bridge',
      type: 'episode',
      title: 'Resolved 601 Episode',
      series_title: title,
      series_identity_key: 'tmdb:601',
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/601/S01E01.mkv',
    })
    await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'episode-602-bridge',
      type: 'episode',
      title: 'Resolved 602 Episode',
      series_title: title,
      series_identity_key: 'tmdb:602',
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/602/S01E01.mkv',
    })

    expect(await db.tvShows.mergeDuplicateShows(sourceId, libraryId)).toBe(0)

    const rows = (await db.tvShows.getAllCompleteness(sourceId, libraryId))
      .filter(row => row.series_title === title)
    expect(rows.map(row => row.series_identity_key).sort()).toEqual([
      'tmdb:601',
      'tmdb:602',
      unresolvedKey,
    ].sort())

    expect((await db.tvShows.getEpisodes(title, sourceId, unresolvedKey, libraryId)).map(item => item.file_path))
      .toEqual(['/tv/unresolved/S01E01.mkv'])
    expect((await db.tvShows.getEpisodes(title, sourceId, 'tmdb:601', libraryId)).map(item => item.file_path))
      .toEqual(['/tv/601/S01E01.mkv'])
    expect((await db.tvShows.getEpisodes(title, sourceId, 'tmdb:602', libraryId)).map(item => item.file_path))
      .toEqual(['/tv/602/S01E01.mkv'])
  })

  it('preserves unresolved and resolved same-title rows without identity ownership', async () => {
    const db = getDatabase()
    const sourceId = 'duplicate-source'
    const libraryId = 'tv'
    const title = 'Single Resolved Title'
    const unresolvedKey = deriveSeriesIdentityKey({ sourceId, libraryId, folderRelativePath: title })
    const now = new Date().toISOString()

    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        tmdb_id, created_at, updated_at
      ) VALUES
        (?, ?, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, NULL, ?, ?),
        (?, 'tmdb:701', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '701', ?, ?)`,
      args: [
        title, unresolvedKey, sourceId, libraryId, now, now,
        title, sourceId, libraryId, now, now,
      ],
    })

    await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'episode-unresolved-single',
      type: 'episode',
      title: 'Episode A',
      series_title: title,
      series_identity_key: unresolvedKey,
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/single-unresolved/S01E01.mkv',
    })
    await db.media.upsertItem({
      source_id: sourceId,
      library_id: libraryId,
      plex_id: 'episode-701-single',
      type: 'episode',
      title: 'Episode B',
      series_title: title,
      series_identity_key: 'tmdb:701',
      season_number: 1,
      episode_number: 2,
      file_path: '/tv/701/S01E02.mkv',
    })

    expect(await db.tvShows.mergeDuplicateShows(sourceId, libraryId)).toBe(0)

    const rows = (await db.tvShows.getAllCompleteness(sourceId, libraryId))
      .filter(row => row.series_title === title)
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.series_identity_key).sort()).toEqual([unresolvedKey, 'tmdb:701'].sort())
    expect((await db.tvShows.getEpisodes(title, sourceId, 'tmdb:701', libraryId)).map(item => item.file_path).sort())
      .toEqual(['/tv/701/S01E02.mkv'])
  })

  it('preserves unresolved duplicates and ambiguous resolved identities with the same title', async () => {
    const db = getDatabase()
    const sourceId = 'duplicate-source'
    const libraryId = 'tv'
    const title = 'Ambiguous Legacy Title'
    const unresolvedKey = deriveSeriesIdentityKey({ sourceId, libraryId, folderRelativePath: title })
    const now = new Date().toISOString()

    await db.db.execute('DROP TRIGGER IF EXISTS trg_series_completeness_identity_insert')
    await db.db.execute({
      sql: `INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        tmdb_id, created_at, updated_at
      ) VALUES
        (?, NULL, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, NULL, ?, ?),
        (?, NULL, ?, ?, 1, 1, 1, 1, '[]', '[]', 100, NULL, ?, ?),
        (?, 'tmdb:801', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '801', ?, ?),
        (?, 'tmdb:802', ?, ?, 1, 1, 1, 1, '[]', '[]', 100, '802', ?, ?)`,
      args: [
        title, sourceId, libraryId, now, now,
        title, sourceId, libraryId, now, now,
        title, sourceId, libraryId, now, now,
        title, sourceId, libraryId, now, now,
      ],
    })

    expect(await db.tvShows.mergeDuplicateShows(sourceId, libraryId)).toBe(0)

    const rows = (await db.tvShows.getAllCompleteness(sourceId, libraryId))
      .filter(row => row.series_title === title)
    expect(rows).toHaveLength(4)
    expect(rows.map(row => row.series_identity_key).filter(Boolean).sort()).toEqual(['tmdb:801', 'tmdb:802'])
    expect(rows.filter(row => !row.series_identity_key)).toHaveLength(2)
  })

  it('does not consume an unresolved row when upserting a second resolved same-title identity', async () => {
    const db = getDatabase()
    const sourceId = 'duplicate-source'
    const libraryId = 'tv'
    const title = 'Ambiguous Upsert Title'
    const unresolvedKey = deriveSeriesIdentityKey({ sourceId, libraryId, folderRelativePath: title })
    const completeness = {
      source_id: sourceId,
      library_id: libraryId,
      series_title: title,
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: 100,
    }

    await db.tvShows.upsertCompleteness({ ...completeness, series_identity_key: unresolvedKey })
    await db.tvShows.upsertCompleteness({ ...completeness, series_identity_key: 'tmdb:901', tmdb_id: '901' })
    await db.tvShows.upsertCompleteness({ ...completeness, series_identity_key: 'tmdb:902', tmdb_id: '902' })

    const rows = (await db.tvShows.getAllCompleteness(sourceId, libraryId))
      .filter(row => row.series_title === title)
    expect(rows.map(row => row.series_identity_key).sort()).toEqual([
      unresolvedKey,
      'tmdb:901',
      'tmdb:902',
    ].sort())
  })
})
