import { beforeEach, describe, expect, it } from 'vitest'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'

describe('TVShowRepository identity joins', () => {
  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'
    const db = getDatabase()
    await db.initialize(':memory:')
    await db.sources.upsertSource({
      source_id: 'src-identities',
      source_type: 'local',
      display_name: 'Identity Source',
      connection_config: '{}',
      is_enabled: 1,
    })
  })

  it('keeps same-title identities distinct and sorts the rendered recoverable total', async () => {
    const db = getDatabase()
    const now = new Date().toISOString()

    await db.db.execute(`
      INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        tmdb_id, created_at, updated_at
      ) VALUES
        ('Shared Title', 'tmdb:101', 'src-identities', 'tv', 1, 1, 1, 1, '[]', '[]', 100, '101', '${now}', '${now}'),
        ('Shared Title', 'tmdb:202', 'src-identities', 'tv', 1, 1, 1, 1, '[]', '[]', 100, '202', '${now}', '${now}')
    `)

    const episode101 = await db.media.upsertItem({
      source_id: 'src-identities',
      library_id: 'tv',
      plex_id: 'episode-101',
      type: 'episode',
      title: 'Episode 1',
      series_title: 'Shared Title',
      series_identity_key: 'tmdb:101',
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/101/S01E01.mkv',
      file_size: 1_000,
    })
    const episode202 = await db.media.upsertItem({
      source_id: 'src-identities',
      library_id: 'tv',
      plex_id: 'episode-202',
      type: 'episode',
      title: 'Episode 1',
      series_title: 'Shared Title',
      series_identity_key: 'tmdb:202',
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/202/S01E01.mkv',
      file_size: 2_000,
    })

    await db.media.upsertQualityScore({
      media_item_id: episode101,
      quality_tier: '1080p',
      tier_quality: 'HIGH',
      storage_debt_bytes: 100,
      evidence_status: 'measured',
    })
    await db.media.upsertQualityScore({
      media_item_id: episode202,
      quality_tier: '1080p',
      tier_quality: 'HIGH',
      storage_debt_bytes: 500,
      evidence_status: 'measured',
    })

    const summaries = await db.tvShows.getSummaries({ sourceId: 'src-identities', libraryId: 'tv' })

    expect(summaries).toHaveLength(2)
    expect(summaries.map(show => show.series_identity_key).sort()).toEqual(['tmdb:101', 'tmdb:202'])
    expect(summaries.map(show => show.total_size).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1_000, 2_000])
    expect(await db.tvShows.count({ sourceId: 'src-identities', libraryId: 'tv' })).toBe(2)

    const sorted = await db.tvShows.getSummaries({
      sourceId: 'src-identities',
      libraryId: 'tv',
      sortBy: 'recoverable',
      sortOrder: 'desc',
    })
    expect(sorted.map(show => [show.series_identity_key, show.total_recoverable_bytes])).toEqual([
      ['tmdb:202', 500],
      ['tmdb:101', 100],
    ])

    const firstPage = await db.tvShows.getSummaries({
      sourceId: 'src-identities',
      libraryId: 'tv',
      sortBy: 'recoverable',
      sortOrder: 'desc',
      limit: 1,
      offset: 0,
    })
    const secondPage = await db.tvShows.getSummaries({
      sourceId: 'src-identities',
      libraryId: 'tv',
      sortBy: 'recoverable',
      sortOrder: 'desc',
      limit: 1,
      offset: 1,
    })
    expect(firstPage).toHaveLength(1)
    expect(secondPage).toHaveLength(1)
    expect(firstPage[0].series_identity_key).toBe('tmdb:202')
    expect(secondPage[0].series_identity_key).toBe('tmdb:101')

    const episodes101 = await db.tvShows.getEpisodes('Shared Title', 'src-identities', 'tmdb:101', 'tv')
    expect(episodes101).toHaveLength(1)
    expect(episodes101[0].series_identity_key).toBe('tmdb:101')
    expect(episodes101[0].file_size).toBe(1_000)
  })

  it('does not let unresolved title fallback borrow a resolved identity aggregate', async () => {
    const db = getDatabase()
    const now = new Date().toISOString()

    await db.db.execute(`
      INSERT INTO series_completeness (
        series_title, series_identity_key, source_id, library_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage,
        tmdb_id, created_at, updated_at
      ) VALUES
        ('Legacy Shared', NULL, 'src-identities', 'tv', 1, 1, 1, 1, '[]', '[]', 100, NULL, '${now}', '${now}'),
        ('Legacy Shared', 'tmdb:303', 'src-identities', 'tv', 1, 1, 1, 1, '[]', '[]', 100, '303', '${now}', '${now}')
    `)

    const unresolvedEpisode = await db.media.upsertItem({
      source_id: 'src-identities',
      library_id: 'tv',
      plex_id: 'episode-unresolved',
      type: 'episode',
      title: 'Legacy Episode',
      series_title: 'Legacy Shared',
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/legacy/S01E01.mkv',
      file_size: 3_000,
    })
    const resolvedEpisode = await db.media.upsertItem({
      source_id: 'src-identities',
      library_id: 'tv',
      plex_id: 'episode-303',
      type: 'episode',
      title: 'Resolved Episode',
      series_title: 'Legacy Shared',
      series_identity_key: 'tmdb:303',
      season_number: 1,
      episode_number: 1,
      file_path: '/tv/303/S01E01.mkv',
      file_size: 4_000,
    })

    await db.media.upsertQualityScore({
      media_item_id: unresolvedEpisode,
      quality_tier: '1080p',
      tier_quality: 'HIGH',
      storage_debt_bytes: 300,
      evidence_status: 'measured',
    })
    await db.media.upsertQualityScore({
      media_item_id: resolvedEpisode,
      quality_tier: '1080p',
      tier_quality: 'HIGH',
      storage_debt_bytes: 700,
      evidence_status: 'measured',
    })

    const summaries = await db.tvShows.getSummaries({ sourceId: 'src-identities', libraryId: 'tv' })
    const unresolved = summaries.find(show => show.series_identity_key == null)
    const resolved = summaries.find(show => show.series_identity_key === 'tmdb:303')

    expect(unresolved?.total_size).toBe(3_000)
    expect(unresolved?.total_recoverable_bytes).toBe(300)
    expect(resolved?.total_size).toBe(4_000)
    expect(resolved?.total_recoverable_bytes).toBe(700)
  })
})
