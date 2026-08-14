import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TimelineResolutionEngine } from '@main/services/timelines/TimelineResolutionEngine'
import type { TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'

describe('TimelineResolutionEngine', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let engine: TimelineResolutionEngine

  beforeEach(async () => {
    db = await setupTestDb()
    engine = new TimelineResolutionEngine(db.drizzle)

    await db.sources.upsertSource({
      source_id: 'src-plex',
      source_type: 'plex',
      display_name: 'Plex Home',
      connection_config: '{}',
      is_enabled: 1,
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('matches movies strictly by TMDB or IMDb ID', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '1001',
      title: 'Star Trek II: The Wrath of Khan',
      type: 'movie',
      tmdb_id: '154',
      imdb_id: 'tt0084726',
      file_path: 'D:/Movies/Star Trek II (1982)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 6780,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-timeline',
      franchise: 'Star Trek',
      name: 'Test Star Trek Order',
      description: 'Testing movie resolution',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Star Trek II: The Wrath of Khan',
          identifiers: { tmdbId: 154, imdbId: 'tt0084726' },
        },
        {
          order: 2,
          type: 'movie',
          title: 'Star Trek III: The Search for Spock',
          identifiers: { tmdbId: 157, imdbId: 'tt0088170' },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline, 'src-plex')
    expect(result.totalCount).toBe(2)
    expect(result.matchedCount).toBe(1)
    expect(result.missingCount).toBe(1)
    expect(result.completionPercentage).toBe(50)

    expect(result.items[0].status).toBe('matched')
    expect(result.items[0].matchedMediaItem?.plexId).toBe('1001')
    expect(result.items[0].matchedMediaItem?.resolution).toBe('4K')

    expect(result.items[1].status).toBe('missing')
    expect(result.items[1].matchedMediaItem).toBeUndefined()
  })

  it('matches TV episodes strictly by series TMDB/TVDB ID and season/episode numbers', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '2001',
      title: 'Broken Bow',
      series_title: 'Star Trek: Enterprise',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Star Trek Enterprise/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-tv-timeline',
      franchise: 'Star Trek',
      name: 'Test TV Order',
      description: 'Testing TV resolution',
      version: 1,
      items: [
        {
          order: 1,
          type: 'episode',
          title: 'Broken Bow',
          seriesTitle: 'Star Trek: Enterprise',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
        },
        {
          order: 2,
          type: 'episode',
          title: 'Fight or Flight',
          seriesTitle: 'Star Trek: Enterprise',
          seasonNumber: 1,
          episodeNumber: 2,
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline)
    expect(result.totalCount).toBe(2)
    expect(result.matchedCount).toBe(1)
    expect(result.missingCount).toBe(1)
    expect(result.items[0].status).toBe('matched')
    expect(result.items[0].matchedMediaItem?.plexId).toBe('2001')
    expect(result.items[1].status).toBe('missing')
  })
})
