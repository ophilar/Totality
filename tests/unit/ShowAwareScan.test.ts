import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { getSeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { MediaItemType } from '@main/types/database'

describe('Show Analysis & Metadata Integrity', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('uses owned episode inventory when completeness evidence is unavailable', async () => {
    const service = getSeriesCompletenessService()

    await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'Local', connection_config: '{}', is_enabled: 1 })
    await db.media.upsertItem({
      source_id: 's1',
      library_id: '2',
      plex_id: 'ep1',
      title: 'Episode 1',
      type: MediaItemType.Episode,
      series_title: 'Unmatched Show',
      season_number: 1,
      episode_number: 1,
      file_path: '/path/to/ep1.mkv',
      poster_url: 'provider-poster-url'
    })

    await db.config.setSetting('tmdb_api_key', '')
    const analysis = await service.analyzeSeries('Unmatched Show', 's1', '2')

    expect(analysis).not.toBeNull()
    expect(analysis!.total_episodes).toBe(1)
    expect(analysis!.owned_episodes).toBe(1)
    expect(analysis!.poster_url).toBe('provider-poster-url')
    expect(analysis!.completeness_percentage).toBe(-1)
  })

  it('preserves verified identity metadata when completeness cannot be refreshed', async () => {
    const service = getSeriesCompletenessService()

    await db.tvShows.upsertCompleteness({
      series_title: 'Matched Show',
      source_id: 's1',
      library_id: '2',
      total_seasons: 5,
      total_episodes: 100,
      owned_seasons: 1,
      owned_episodes: 1,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: 1,
      tmdb_id: '12345',
      poster_url: 'existing-poster-url'
    })

    await db.media.upsertItem({
      source_id: 's1',
      library_id: '2',
      plex_id: 'ep2',
      title: 'Ep 1',
      type: MediaItemType.Episode,
      series_title: 'Matched Show',
      season_number: 1,
      episode_number: 1,
      file_path: '/p2.mkv'
    })

    await db.config.setSetting('tmdb_api_key', '')
    const analysis = await service.analyzeSeries('Matched Show', 's1', '2')

    expect(analysis!.tmdb_id).toBe('12345')
    expect(analysis!.poster_url).toBe('existing-poster-url')
  })
})
