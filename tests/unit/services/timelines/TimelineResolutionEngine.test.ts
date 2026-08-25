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

  it('matches movies by title subtitles and aliases without external IDs', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '3001',
      title: 'Star Trek: The Motion Picture - Director\'s Edition',
      type: 'movie',
      year: 1979,
      file_path: 'D:/Movies/Star Trek 1 (1979)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 8000,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '3002',
      title: 'Star Trek 6 - The Undiscovered Country',
      type: 'movie',
      year: 1991,
      file_path: 'D:/Movies/Star Trek 6 (1991)/movie.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 6600,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '3003',
      title: 'Star Trek Into Darkness',
      type: 'movie',
      year: 2013,
      file_path: 'D:/Movies/Star Trek Into Darkness (2013)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 7900,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-movies-alias',
      franchise: 'Star Trek',
      name: 'Star Trek Movie Test',
      description: 'Testing movie aliases',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Star Trek: The Motion Picture',
          identifiers: {},
        },
        {
          order: 2,
          type: 'movie',
          title: 'Star Trek VI: The Undiscovered Country',
          identifiers: {},
        },
        {
          order: 3,
          type: 'movie',
          title: 'Star Trek Into Darkness',
          identifiers: {},
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline)
    expect(result.totalCount).toBe(3)
    expect(result.matchedCount).toBe(3)
    expect(result.items[0].status).toBe('matched')
    expect(result.items[0].matchedMediaItem?.plexId).toBe('3001')
    expect(result.items[1].status).toBe('matched')
    expect(result.items[1].matchedMediaItem?.plexId).toBe('3002')
    expect(result.items[2].status).toBe('matched')
    expect(result.items[2].matchedMediaItem?.plexId).toBe('3003')
  })

  it('matches Star Trek episodes by common series title shorthand aliases', async () => {
    // TOS shorthand "Star Trek"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4001',
      title: 'The Man Trap',
      series_title: 'Star Trek',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/Star Trek/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 3000,
    } as never)

    // TNG shorthand "Star Trek TNG"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4002',
      title: 'Encounter at Farpoint',
      series_title: 'Star Trek TNG',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/Star Trek TNG/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    // DS9 shorthand "Deep Space Nine"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4003',
      title: 'Emissary',
      series_title: 'Deep Space Nine',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/DS9/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    // Voyager shorthand "Voyager"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4004',
      title: 'Caretaker',
      series_title: 'Voyager',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/Voyager/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    // SNW shorthand "Star Trek SNW"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4005',
      title: 'Strange New Worlds',
      series_title: 'Star Trek SNW',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/SNW/S01E01.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 3600,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-shorthand-timeline',
      franchise: 'Star Trek',
      name: 'Star Trek Shorthand Order',
      description: 'Testing series aliases',
      version: 1,
      items: [
        {
          order: 1,
          type: 'episode',
          title: 'The Man Trap',
          seriesTitle: 'Star Trek: The Original Series',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 2,
          type: 'episode',
          title: 'Encounter at Farpoint',
          seriesTitle: 'Star Trek: The Next Generation',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 3,
          type: 'episode',
          title: 'Emissary',
          seriesTitle: 'Star Trek: Deep Space Nine',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 4,
          type: 'episode',
          title: 'Caretaker',
          seriesTitle: 'Star Trek: Voyager',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 5,
          type: 'episode',
          title: 'Strange New Worlds',
          seriesTitle: 'Star Trek: Strange New Worlds',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline)
    expect(result.totalCount).toBe(5)
    expect(result.matchedCount).toBe(5)
    expect(result.items[0].matchedMediaItem?.plexId).toBe('4001')
    expect(result.items[1].matchedMediaItem?.plexId).toBe('4002')
    expect(result.items[2].matchedMediaItem?.plexId).toBe('4003')
    expect(result.items[3].matchedMediaItem?.plexId).toBe('4004')
    expect(result.items[4].matchedMediaItem?.plexId).toBe('4005')
  })

  it('matches IMDb IDs formatted with or without tt prefix', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '5001',
      title: 'Star Trek IV: The Voyage Home',
      type: 'movie',
      imdb_id: '0092007', // Stored without tt prefix in local metadata
      file_path: 'D:/Movies/Star Trek 4/movie.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 7100,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-imdb-tt',
      franchise: 'Star Trek',
      name: 'IMDb Prefix Test',
      description: 'Testing IMDb ID normalization',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Star Trek IV: The Voyage Home',
          identifiers: { imdbId: 'tt0092007' }, // Specified with tt prefix in timeline recipe
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline)
    expect(result.matchedCount).toBe(1)
    expect(result.items[0].status).toBe('matched')
    expect(result.items[0].matchedMediaItem?.plexId).toBe('5001')
  })

  it('falls back to matching across all sources if item exists in a different source', async () => {
    await db.sources.upsertSource({
      source_id: 'src-jellyfin',
      source_type: 'jellyfin',
      display_name: 'Jellyfin Server',
      connection_config: '{}',
      is_enabled: 1,
    })

    await db.media.upsertItem({
      source_id: 'src-jellyfin',
      source_type: 'jellyfin',
      plex_id: 'jf-9001',
      title: 'Star Trek: First Contact',
      type: 'movie',
      tmdb_id: '199',
      file_path: 'D:/Jellyfin/Star Trek First Contact.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 6600,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-cross-source',
      franchise: 'Star Trek',
      name: 'Cross Source Test',
      description: 'Testing global library fallback',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Star Trek: First Contact',
          identifiers: { tmdbId: 199 },
        },
      ],
    }

    // Resolving with 'src-plex' prioritizes src-plex but falls back to src-jellyfin
    const result = await engine.resolveTimeline(timeline, 'src-plex')
    expect(result.matchedCount).toBe(1)
    expect(result.items[0].status).toBe('matched')
    expect(result.items[0].matchedMediaItem?.sourceId).toBe('src-jellyfin')
    expect(result.items[0].matchedMediaItem?.plexId).toBe('jf-9001')
  })

  it('generically resolves Star Wars movies and series using standard IDs and title normalization', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'sw-1001',
      title: 'Star Wars: Episode IV - A New Hope',
      type: 'movie',
      tmdb_id: '11',
      imdb_id: 'tt0076759',
      year: 1977,
      file_path: 'D:/Movies/Star Wars A New Hope (1977)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 7200,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'sw-2001',
      title: 'Chapter 1: The Mandalorian',
      series_title: 'The Mandalorian',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:82856',
      file_path: 'D:/TV/The Mandalorian/S01E01.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 2400,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'star-wars-test',
      franchise: 'Star Wars',
      name: 'Star Wars Test Order',
      description: 'Testing generic Star Wars matching',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Star Wars: Episode IV - A New Hope',
          airDate: '1977-05-25',
          identifiers: { tmdbId: 11, imdbId: 'tt0076759' },
        },
        {
          order: 2,
          type: 'episode',
          title: 'Chapter 1: The Mandalorian',
          seriesTitle: 'The Mandalorian',
          seasonNumber: 1,
          episodeNumber: 1,
          airDate: '2019-11-12',
          identifiers: { tmdbId: 82856, tvdbId: 361753 },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline)
    expect(result.totalCount).toBe(2)
    expect(result.matchedCount).toBe(2)
    expect(result.items[0].status).toBe('matched')
    expect(result.items[0].matchedMediaItem?.plexId).toBe('sw-1001')
    expect(result.items[1].status).toBe('matched')
    expect(result.items[1].matchedMediaItem?.plexId).toBe('sw-2001')
  })

  it('generically resolves MCU films and series using standard IDs and title normalization', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'mcu-1001',
      title: 'Iron Man 2',
      type: 'movie',
      tmdb_id: '10138',
      year: 2010,
      file_path: 'D:/Movies/Iron Man 2/movie.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 7400,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'mcu-2001',
      title: 'Filmed Before a Live Studio Audience',
      series_title: 'WandaVision',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:85271',
      file_path: 'D:/TV/WandaVision/S01E01.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 1800,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'mcu-test',
      franchise: 'Marvel Cinematic Universe',
      name: 'MCU Test Order',
      description: 'Testing generic MCU matching',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Iron Man 2',
          airDate: '2010-05-07',
          identifiers: { tmdbId: 10138, imdbId: 'tt1228705' },
        },
        {
          order: 2,
          type: 'episode',
          title: 'Filmed Before a Live Studio Audience',
          seriesTitle: 'WandaVision',
          seasonNumber: 1,
          episodeNumber: 1,
          airDate: '2021-01-15',
          identifiers: { tmdbId: 85271, tvdbId: 363456 },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline)
    expect(result.totalCount).toBe(2)
    expect(result.matchedCount).toBe(2)
    expect(result.items[0].matchedMediaItem?.plexId).toBe('mcu-1001')
    expect(result.items[1].matchedMediaItem?.plexId).toBe('mcu-2001')
  })

  it('expands full show timeline items into all constituent episodes in sequential order', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'ent-101',
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

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'ent-102',
      title: 'Fight or Flight',
      series_title: 'Star Trek: Enterprise',
      type: 'episode',
      season_number: 1,
      episode_number: 2,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Star Trek Enterprise/S01E02.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 2600,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'ent-201',
      title: 'Shockwave: Part 2',
      series_title: 'Star Trek: Enterprise',
      type: 'episode',
      season_number: 2,
      episode_number: 1,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Star Trek Enterprise/S02E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 2600,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'star-trek-show-expansion',
      franchise: 'Star Trek',
      name: 'Star Trek Show Test',
      description: 'Testing full show expansion',
      version: 1,
      items: [
        {
          order: 1,
          type: 'show',
          title: 'Star Trek: Enterprise',
          seriesTitle: 'Star Trek: Enterprise',
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline)
    expect(result.totalCount).toBe(1)
    expect(result.matchedCount).toBe(1)
    expect(result.items.length).toBe(3)
    expect(result.items.every((i) => i.type === 'episode')).toBe(true)
    expect(result.items[0].matchedMediaItem?.plexId).toBe('ent-101')
    expect(result.items[1].matchedMediaItem?.plexId).toBe('ent-102')
    expect(result.items[2].matchedMediaItem?.plexId).toBe('ent-201')
  })
})
