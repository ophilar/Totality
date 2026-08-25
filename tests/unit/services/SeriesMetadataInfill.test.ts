import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { SeriesCompletenessService, isPlaceholderEpisodeTitle } from '../../../src/main/services/SeriesCompletenessService'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '../../../src/main/database/BetterSQLiteService'
import { getTMDBService, resetTMDBServiceForTesting } from '../../../src/main/services/TMDBService'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

describe('SeriesMetadataInfill', () => {
  let db: ReturnType<typeof getDatabase>
  let tmdb: ReturnType<typeof getTMDBService>
  let service: SeriesCompletenessService
  let server: http.Server
  let serverPort: number

  const createEpisode = (overrides: Record<string, unknown>) => {
    return {
      type: 'episode',
      title: overrides.title !== undefined ? (overrides.title as string) : `Episode ${overrides.episode_number || 1}`,
      file_path: `/path/to/${overrides.series_title || 'show'}/S${overrides.season_number || 1}E${overrides.episode_number || 1}.mkv`,
      file_size: 500000000,
      duration: 1200000,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate: 3000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 192,
      ...overrides
    }
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url?.includes('/tv/1399')) {
        const baseData = {
          id: 1399,
          name: 'Game of Thrones',
          number_of_seasons: 1,
          number_of_episodes: 2,
          seasons: [
            { season_number: 1, episode_count: 2, air_date: '2011-04-17', poster_path: '/season1.jpg' }
          ],
          poster_path: '/poster.jpg',
          backdrop_path: '/backdrop.jpg',
          status: 'Ended',
          external_ids: {
            imdb_id: 'tt0944947',
            tvdb_id: 121361
          }
        }

        if (req.url?.includes('season/1') || req.url?.includes('season%2F1')) {
          res.end(JSON.stringify({
            ...baseData,
            'season/1': {
              season_number: 1,
              name: 'Season 1',
              poster_path: '/season1.jpg',
              episodes: [
                {
                  id: 63056,
                  season_number: 1,
                  episode_number: 1,
                  name: 'Winter Is Coming',
                  air_date: '2011-04-17',
                  overview: 'Lord Eddard Stark is asked by King Robert Baratheon to serve as Hand of the King.',
                  still_path: '/still1.jpg'
                },
                {
                  id: 63057,
                  season_number: 1,
                  episode_number: 2,
                  name: 'The Kingsroad',
                  air_date: '2011-04-24',
                  overview: 'The Lannisters plot against the Starks.',
                  still_path: '/still2.jpg'
                }
              ]
            }
          }))
        } else {
          res.end(JSON.stringify(baseData))
        }
      } else if (req.url?.includes('/search/tv')) {
        res.end(JSON.stringify({
          results: [{ id: 1399, name: 'Game of Thrones' }]
        }))
      } else {
        res.end(JSON.stringify({ results: [] }))
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Test server did not expose an address')
        serverPort = (address as AddressInfo).port
        resolve()
      })
    })
  })

  afterAll(async () => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    resetTMDBServiceForTesting()

    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'

    db = getDatabase()
    await db.initialize(':memory:')

    await db.config.setSetting('tmdb_api_key', 'test-key')
    await db.config.setSetting('tmdb_base_url', `http://127.0.0.1:${serverPort}`)

    tmdb = getTMDBService()
    await tmdb.initialize()

    service = new SeriesCompletenessService()
  })

  describe('isPlaceholderEpisodeTitle helper', () => {
    it('identifies placeholder and empty titles correctly', () => {
      expect(isPlaceholderEpisodeTitle('')).toBe(true)
      expect(isPlaceholderEpisodeTitle(null)).toBe(true)
      expect(isPlaceholderEpisodeTitle(undefined)).toBe(true)
      expect(isPlaceholderEpisodeTitle('Episode 1')).toBe(true)
      expect(isPlaceholderEpisodeTitle('Episode 01')).toBe(true)
      expect(isPlaceholderEpisodeTitle('Episode 12')).toBe(true)
      expect(isPlaceholderEpisodeTitle('episode 5')).toBe(true)
      expect(isPlaceholderEpisodeTitle('Episode 1 - Episode 1')).toBe(true)
      expect(isPlaceholderEpisodeTitle('S01E01')).toBe(true)
      expect(isPlaceholderEpisodeTitle('s1e2')).toBe(true)
      expect(isPlaceholderEpisodeTitle('1x01')).toBe(true)
      expect(isPlaceholderEpisodeTitle('Episode')).toBe(true)

      expect(isPlaceholderEpisodeTitle('Winter Is Coming')).toBe(false)
      expect(isPlaceholderEpisodeTitle('Pilot')).toBe(false)
      expect(isPlaceholderEpisodeTitle('The Kingsroad')).toBe(false)
    })
  })

  describe('Automated Metadata Infill during Series Analysis', () => {
    it('backfills missing external IDs (tmdb_id, tvdb_id, imdb_id) in series_completeness and identities table', async () => {
      await db.sources.upsertSource({
        source_id: 'src1',
        source_type: 'local',
        display_name: 'Local',
        connection_config: '{}',
        is_enabled: 1
      })

      await db.media.upsertItem(createEpisode({
        source_id: 'src1',
        library_id: 'tv',
        plex_id: 'got-s1e1',
        series_title: 'Game of Thrones',
        season_number: 1,
        episode_number: 1
      }))

      const completeness = await service.analyzeSeries('Game of Thrones', 'src1', 'tv')
      expect(completeness).not.toBeNull()
      expect(completeness!.tmdb_id).toBe('1399')
      expect(completeness!.tvdb_id).toBe('121361')

      // Check identities table
      const identities = await db.identities.getIdentities('series', completeness!.id!)
      const tmdbIdent = identities.find(i => i.provider === 'tmdb')
      const tvdbIdent = identities.find(i => i.provider === 'tvdb')
      const imdbIdent = identities.find(i => i.provider === 'imdb')

      expect(tmdbIdent).toBeDefined()
      expect(tmdbIdent!.externalId).toBe('1399')
      expect(tvdbIdent).toBeDefined()
      expect(tvdbIdent!.externalId).toBe('121361')
      expect(imdbIdent).toBeDefined()
      expect(imdbIdent!.externalId).toBe('tt0944947')
    })

    it('backfills missing episode title, air_date year, overview, still_path, and tmdb_id for local episodes', async () => {
      await db.sources.upsertSource({
        source_id: 'src2',
        source_type: 'local',
        display_name: 'Local',
        connection_config: '{}',
        is_enabled: 1
      })

      // Insert episode with placeholder title and missing metadata
      await db.media.upsertItem(createEpisode({
        source_id: 'src2',
        library_id: 'tv',
        plex_id: 'got-ep-1',
        series_title: 'Game of Thrones',
        season_number: 1,
        episode_number: 1,
        title: 'Episode 1',
        year: null,
        summary: null,
        episode_thumb_url: null,
        tmdb_id: null
      }))

      await service.analyzeSeries('Game of Thrones', 'src2', 'tv', '1399')

      const updatedItem = await db.media.getItemByProviderId('got-ep-1', 'src2')
      expect(updatedItem).not.toBeNull()
      expect(updatedItem!.title).toBe('Winter Is Coming')
      expect(updatedItem!.year).toBe(2011)
      expect(updatedItem!.summary).toBe('Lord Eddard Stark is asked by King Robert Baratheon to serve as Hand of the King.')
      expect(updatedItem!.episode_thumb_url).toBe('https://image.tmdb.org/t/p/w500/still1.jpg')
      expect(updatedItem!.tmdb_id).toBe('63056')
      expect(updatedItem!.series_tmdb_id).toBe('1399')
      expect(updatedItem!.season_poster_url).toBe('https://image.tmdb.org/t/p/w500/season1.jpg')
      expect(updatedItem!.poster_url).toBe('https://image.tmdb.org/t/p/w500/poster.jpg')
    })

    it('protects user-locked episodes from being overwritten during analysis', async () => {
      await db.sources.upsertSource({
        source_id: 'src3',
        source_type: 'local',
        display_name: 'Local',
        connection_config: '{}',
        is_enabled: 1
      })

      // Insert episode with custom user-fixed title and locked flag
      await db.media.upsertItem(createEpisode({
        source_id: 'src3',
        library_id: 'tv',
        plex_id: 'got-ep-locked',
        series_title: 'Game of Thrones',
        season_number: 1,
        episode_number: 1,
        title: 'Custom User Title',
        summary: 'Custom User Summary',
        user_fixed_match: 1
      }))

      await service.analyzeSeries('Game of Thrones', 'src3', 'tv', '1399')

      const item = await db.media.getItemByProviderId('got-ep-locked', 'src3')
      expect(item).not.toBeNull()
      expect(item!.title).toBe('Custom User Title')
      expect(item!.summary).toBe('Custom User Summary')
    })

    it('protects user-locked identities from being overwritten during analysis', async () => {
      await db.sources.upsertSource({
        source_id: 'src4',
        source_type: 'local',
        display_name: 'Local',
        connection_config: '{}',
        is_enabled: 1
      })

      // Create existing completeness with user fixed match and custom locked identity
      const id = await db.tvShows.upsertCompleteness({
        series_title: 'Game of Thrones',
        source_id: 'src4',
        library_id: 'tv',
        total_seasons: 1,
        total_episodes: 2,
        owned_seasons: 1,
        owned_episodes: 1,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 50,
        tmdb_id: '999999',
        user_fixed_match: true
      })

      await db.identities.upsertIdentity({
        entityType: 'series',
        entityId: id,
        provider: 'tmdb',
        externalId: '999999',
        locked: true,
        lockSource: 'manual'
      })

      await db.media.upsertItem(createEpisode({
        source_id: 'src4',
        library_id: 'tv',
        plex_id: 'got-ep-1-src4',
        series_title: 'Game of Thrones',
        season_number: 1,
        episode_number: 1,
        series_tmdb_id: '999999'
      }))

      await service.analyzeSeries('Game of Thrones', 'src4', 'tv', '1399')

      const identities = await db.identities.getIdentities('series', id)
      const tmdbIdent = identities.find(i => i.provider === 'tmdb')
      expect(tmdbIdent).toBeDefined()
      expect(tmdbIdent!.externalId).toBe('999999')
      expect(tmdbIdent!.locked).toBe(true)
    })
  })
})
