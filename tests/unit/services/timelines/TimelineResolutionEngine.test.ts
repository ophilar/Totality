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

  it('retains deliberate appearances and flags unintended duplicate episode identities', async () => {
    await db.media.upsertItem({ source_id: 'src-plex', source_type: 'plex', plex_id: 'mando-1', title: 'Chapter 1', series_title: 'The Mandalorian', series_identity_key: 'tmdb:82856', series_tmdb_id: '82856', type: 'episode', season_number: 1, episode_number: 1, library_id: 'tv', file_path: 'D:/Acceptance/mando.mkv' })
    const episode = { order: 1, type: 'episode' as const, title: 'Chapter 1', seriesTitle: 'The Mandalorian', seasonNumber: 1, episodeNumber: 1, identifiers: { tmdbId: 82856 } }
    const guide: TimelineDefinition = { id: 'mando', franchise: 'Star Wars', name: 'Order', description: '', version: 1, items: [episode, { ...episode, order: 2 }] }
    const result = await engine.resolveTimeline(guide, 'src-plex')
    expect(result.items.map(item => item.status)).toEqual(['matched', 'ambiguous'])
    guide.items[1].deliberateRepeat = true
    expect((await engine.resolveTimeline(guide, 'src-plex')).matchedCount).toBe(2)
    guide.items = [{ ...episode, identifiers: { tmdbId: 83867 } }]
    expect((await engine.resolveTimeline(guide, 'src-plex')).matchedCount).toBe(0)
  })

  it('does not resolve against every server when no source is selected', async () => {
    await db.media.upsertItem({ source_id: 'src-plex', source_type: 'plex', plex_id: 'movie', title: 'Movie', type: 'movie', tmdb_id: '1', file_path: 'D:/Acceptance/movie.mkv' })
    const guide: TimelineDefinition = { id: 'unselected', franchise: 'Acceptance', name: 'Order', description: '', version: 1, items: [{ order: 1, type: 'movie', title: 'Movie', identifiers: { tmdbId: 1 } }] }
    const result = await engine.resolveTimeline(guide)
    expect(result.matchedCount).toBe(0)
    expect(result.items[0].reason).toContain('Select a media source')
  })

  it('rejects contradictory canonical identifiers', async () => {
    await db.media.upsertItem({ source_id: 'src-plex', source_type: 'plex', plex_id: 'movie', title: 'Movie', type: 'movie', tmdb_id: '1', imdb_id: 'tt2', file_path: 'D:/Acceptance/movie.mkv' })
    const guide: TimelineDefinition = { id: 'contradiction', franchise: 'Acceptance', name: 'Order', description: '', version: 1, items: [{ order: 1, type: 'movie', title: 'Movie', identifiers: { tmdbId: 1, imdbId: 'tt3' } }] }
    expect((await engine.resolveTimeline(guide, 'src-plex')).matchedCount).toBe(0)
  })

  it('matches movies strictly by TMDB or IMDb ID', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '1001',
      title: 'Example Saga II: The Wrath of Khan',
      type: 'movie',
      tmdb_id: '154',
      imdb_id: 'tt0084726',
      file_path: 'D:/Movies/Example Saga II (1982)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 6780,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-timeline',
      franchise: 'Example Saga',
      name: 'Test Example Saga Order',
      description: 'Testing movie resolution',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Example Saga II: The Wrath of Khan',
          identifiers: { tmdbId: 154, imdbId: 'tt0084726' },
        },
        {
          order: 2,
          type: 'movie',
          title: 'Example Saga III: The Search for Spock',
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
      series_title: 'Example Saga: Enterprise',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Example Saga Enterprise/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-tv-timeline',
      franchise: 'Example Saga',
      name: 'Test TV Order',
      description: 'Testing TV resolution',
      version: 1,
      items: [
        {
          order: 1,
          type: 'episode',
          title: 'Broken Bow',
          seriesTitle: 'Example Saga: Enterprise',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
        },
        {
          order: 2,
          type: 'episode',
          title: 'Fight or Flight',
          seriesTitle: 'Example Saga: Enterprise',
          seasonNumber: 1,
          episodeNumber: 2,
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline, 'src-plex')
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
      title: 'Example Saga: The Motion Picture - Director\'s Edition',
      type: 'movie',
      year: 1979,
      file_path: 'D:/Movies/Example Saga 1 (1979)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 8000,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '3002',
      title: 'Example Saga 6 - The Undiscovered Country',
      type: 'movie',
      year: 1991,
      file_path: 'D:/Movies/Example Saga 6 (1991)/movie.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 6600,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '3003',
      title: 'Example Saga Into Darkness',
      type: 'movie',
      year: 2013,
      file_path: 'D:/Movies/Example Saga Into Darkness (2013)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 7900,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-movies-alias',
      franchise: 'Example Saga',
      name: 'Example Saga Movie Test',
      description: 'Testing movie aliases',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Example Saga: The Motion Picture',
          identifiers: {},
        },
        {
          order: 2,
          type: 'movie',
          title: 'Example Saga VI: The Undiscovered Country',
          identifiers: {},
        },
        {
          order: 3,
          type: 'movie',
          title: 'Example Saga Into Darkness',
          identifiers: {},
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline, 'src-plex')
    expect(result.totalCount).toBe(3)
    expect(result.matchedCount).toBe(2)
    expect(result.items[0].status).toBe('missing')
    expect(result.items[0].matchedMediaItem).toBeUndefined()
    expect(result.items[1].status).toBe('matched')
    expect(result.items[1].matchedMediaItem?.plexId).toBe('3002')
    expect(result.items[2].status).toBe('matched')
    expect(result.items[2].matchedMediaItem?.plexId).toBe('3003')
  })

  it('requires canonical identities for series shorthand aliases', async () => {
    // TOS shorthand "Example Saga"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4001',
      title: 'The Man Trap',
      series_title: 'Example Saga',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/Example Saga/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 3000,
    } as never)

    // TNG shorthand "Example Saga TNG"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4002',
      title: 'Encounter at Farpoint',
      series_title: 'Example Saga TNG',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      file_path: 'D:/TV/Example Saga TNG/S01E01.mkv',
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

    // SNW shorthand "Example Saga SNW"
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '4005',
      title: 'Strange New Worlds',
      series_title: 'Example Saga SNW',
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
      franchise: 'Example Saga',
      name: 'Example Saga Shorthand Order',
      description: 'Testing series aliases',
      version: 1,
      items: [
        {
          order: 1,
          type: 'episode',
          title: 'The Man Trap',
          seriesTitle: 'Example Saga: The Original Series',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 2,
          type: 'episode',
          title: 'Encounter at Farpoint',
          seriesTitle: 'Example Saga: The Next Generation',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 3,
          type: 'episode',
          title: 'Emissary',
          seriesTitle: 'Example Saga: Deep Space Nine',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 4,
          type: 'episode',
          title: 'Caretaker',
          seriesTitle: 'Example Saga: Voyager',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
        {
          order: 5,
          type: 'episode',
          title: 'Strange New Worlds',
          seriesTitle: 'Example Saga: Strange New Worlds',
          seasonNumber: 1,
          episodeNumber: 1,
          identifiers: {},
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline, 'src-plex')
    expect(result.totalCount).toBe(5)
    expect(result.matchedCount).toBe(0)
    expect(result.items.every(item => item.status === 'missing')).toBe(true)
  })

  it('matches IMDb IDs formatted with or without tt prefix', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: '5001',
      title: 'Example Saga IV: The Voyage Home',
      type: 'movie',
      imdb_id: '0092007', // Stored without tt prefix in local metadata
      file_path: 'D:/Movies/Example Saga 4/movie.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 7100,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-imdb-tt',
      franchise: 'Example Saga',
      name: 'IMDb Prefix Test',
      description: 'Testing IMDb ID normalization',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Example Saga IV: The Voyage Home',
          identifiers: { imdbId: 'tt0092007' }, // Specified with tt prefix in timeline recipe
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline, 'src-plex')
    expect(result.matchedCount).toBe(1)
    expect(result.items[0].status).toBe('matched')
    expect(result.items[0].matchedMediaItem?.plexId).toBe('5001')
  })

  it('never matches an item from a different selected source', async () => {
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
      title: 'Example Saga: First Contact',
      type: 'movie',
      tmdb_id: '199',
      file_path: 'D:/Jellyfin/Example Saga First Contact.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 6600,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'test-cross-source',
      franchise: 'Example Saga',
      name: 'Cross Source Test',
      description: 'Testing global library fallback',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Example Saga: First Contact',
          identifiers: { tmdbId: 199 },
        },
      ],
    }

    // Resolving with 'src-plex' prioritizes src-plex but falls back to src-jellyfin
    const result = await engine.resolveTimeline(timeline, 'src-plex')
    expect(result.matchedCount).toBe(0)
    expect(result.items[0].status).toBe('missing')
    expect(result.items[0].matchedMediaItem).toBeUndefined()
  })

  it('generically resolves Example Galaxy movies and series using standard IDs and title normalization', async () => {
    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'sw-1001',
      title: 'Example Galaxy: Episode IV - A New Hope',
      type: 'movie',
      tmdb_id: '11',
      imdb_id: 'tt0076759',
      year: 1977,
      file_path: 'D:/Movies/Example Galaxy A New Hope (1977)/movie.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 7200,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'sw-2001',
      title: 'Chapter 1: Example Series',
      series_title: 'Example Series',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:82856',
      file_path: 'D:/TV/Example Series/S01E01.mkv',
      resolution: '4K',
      video_codec: 'hevc',
      duration: 2400,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'star-wars-test',
      franchise: 'Example Galaxy',
      name: 'Example Galaxy Test Order',
      description: 'Testing generic Example Galaxy matching',
      version: 1,
      items: [
        {
          order: 1,
          type: 'movie',
          title: 'Example Galaxy: Episode IV - A New Hope',
          airDate: '1977-05-25',
          identifiers: { tmdbId: 11, imdbId: 'tt0076759' },
        },
        {
          order: 2,
          type: 'episode',
          title: 'Chapter 1: Example Series',
          seriesTitle: 'Example Series',
          seasonNumber: 1,
          episodeNumber: 1,
          airDate: '2019-11-12',
          identifiers: { tmdbId: 82856, tvdbId: 361753 },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline, 'src-plex')
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
      franchise: 'Example Universe',
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

    const result = await engine.resolveTimeline(timeline, 'src-plex')
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
      series_title: 'Example Saga: Enterprise',
      type: 'episode',
      season_number: 1,
      episode_number: 1,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Example Saga Enterprise/S01E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 5400,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'ent-102',
      title: 'Fight or Flight',
      series_title: 'Example Saga: Enterprise',
      type: 'episode',
      season_number: 1,
      episode_number: 2,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Example Saga Enterprise/S01E02.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 2600,
    } as never)

    await db.media.upsertItem({
      source_id: 'src-plex',
      source_type: 'plex',
      plex_id: 'ent-201',
      title: 'Shockwave: Part 2',
      series_title: 'Example Saga: Enterprise',
      type: 'episode',
      season_number: 2,
      episode_number: 1,
      series_identity_key: 'tmdb:1478',
      file_path: 'D:/TV/Example Saga Enterprise/S02E01.mkv',
      resolution: '1080p',
      video_codec: 'h264',
      duration: 2600,
    } as never)

    const timeline: TimelineDefinition = {
      id: 'star-trek-show-expansion',
      franchise: 'Example Saga',
      name: 'Example Saga Show Test',
      description: 'Testing full show expansion',
      version: 1,
      items: [
        {
          order: 1,
          type: 'show',
          title: 'Example Saga: Enterprise',
          seriesTitle: 'Example Saga: Enterprise',
          identifiers: { tmdbId: 1478, tvdbId: 75711 },
        },
      ],
    }

    const result = await engine.resolveTimeline(timeline, 'src-plex')
    expect(result.totalCount).toBe(3)
    expect(result.matchedCount).toBe(3)
    expect(result.items.map(item => item.order)).toEqual([1, 2, 3])
    expect(result.items.length).toBe(3)
    expect(result.items.every((i) => i.type === 'episode')).toBe(true)
    expect(result.items[0].matchedMediaItem?.plexId).toBe('ent-101')
    expect(result.items[1].matchedMediaItem?.plexId).toBe('ent-102')
    expect(result.items[2].matchedMediaItem?.plexId).toBe('ent-201')
  })
})
