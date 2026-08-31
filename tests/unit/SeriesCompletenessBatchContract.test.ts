import { beforeEach, describe, expect, it } from 'vitest'
import {
  getDatabase,
  resetBetterSQLiteServiceForTesting,
} from '../../src/main/database/BetterSQLiteService'
import { SeriesCompletenessService } from '../../src/main/services/SeriesCompletenessService'
import { MediaItemType } from '../../src/main/types/database'

describe('SeriesCompletenessService batch contract', () => {
  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'
    await getDatabase().initialize(':memory:')
  })

  it('analyzes every media-backed series when episodes already have a canonical identity key', async () => {
    const db = getDatabase()
    await db.sources.upsertSource({
      source_id: 'plex-source',
      source_type: 'plex',
      display_name: 'Plex',
      connection_config: '{}',
      is_enabled: 1,
    })

    await db.media.upsertItem({
      source_id: 'plex-source',
      library_id: 'tv',
      plex_id: 'episode-1',
      type: MediaItemType.Episode,
      title: 'Episode 1',
      series_title: 'Game of Thrones',
      series_identity_key: 'tmdb:1399',
      season_number: 1,
      episode_number: 1,
      file_path: '/library/Game of Thrones/S01E01.mkv',
      file_size: 1_000_000,
      duration: 1_000,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate: 3_000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 192,
    })

    const result = await new SeriesCompletenessService().analyzeAllSeries('plex-source', 'tv')

    expect(result.totalSeries).toBe(1)
    expect(result.analyzed).toBe(1)
    expect(result.errors).toEqual([])

    const summaries = await db.tvShows.getSummaries({ sourceId: 'plex-source', libraryId: 'tv' })
    expect(summaries).toHaveLength(1)
    expect(summaries[0].series_title).toBe('Game of Thrones')
    expect(summaries[0].owned_episodes).toBe(1)
  })
})
