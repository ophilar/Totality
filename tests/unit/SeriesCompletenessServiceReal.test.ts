import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { SeriesCompletenessService } from '../../src/main/services/SeriesCompletenessService'
import { getBetterSQLiteService, resetBetterSQLiteServiceForTesting } from '../../src/main/database/BetterSQLiteService'
import { getTMDBService, resetTMDBServiceForTesting } from '../../src/main/services/TMDBService'
import http from 'node:http'

describe('SeriesCompletenessService (No Mocks)', () => {
  let db: any
  let tmdb: any
  let service: SeriesCompletenessService
  let server: http.Server
  let serverPort: number

  const createEpisode = (overrides: any) => {
    return {
      type: 'episode',
      title: overrides.title || `Episode ${overrides.episode_number || 1}`,
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
    // Setup local TMDB mock server
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url?.includes('/tv/1399')) { // Game of Thrones
         const baseData = {
           id: 1399,
           name: 'Game of Thrones',
           number_of_seasons: 8,
           number_of_episodes: 73,
           seasons: [
             { season_number: 1, episode_count: 10, air_date: '2011-04-17', poster_path: '/season1.jpg' }
           ],
           poster_path: '/poster.jpg',
           backdrop_path: '/backdrop.jpg',
           status: 'Ended'
         }

         if (req.url?.includes('append_to_response=season/1') || req.url?.includes('append_to_response=season%2F1')) {
            res.end(JSON.stringify({
              ...baseData,
              'season/1': {
                season_number: 1,
                episodes: [
                  { id: 1, season_number: 1, episode_number: 1, name: 'Winter Is Coming', air_date: '2011-04-17', still_path: '/still1.jpg' },
                  { id: 2, season_number: 1, episode_number: 2, name: 'The Kingsroad', air_date: '2011-04-24', still_path: '/still2.jpg' }
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
        const address = server.address() as any
        serverPort = address.port
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

    db = getBetterSQLiteService()
    db.initialize()
    
    db.setSetting('tmdb_api_key', 'test-key')
    db.setSetting('tmdb_base_url', `http://127.0.0.1:${serverPort}`)

    tmdb = getTMDBService()
    await tmdb.initialize()

    service = new SeriesCompletenessService()
  })

  it('should analyze a series and find missing episodes', async () => {
    db.upsertMediaSource({ source_id: 's1', source_type: 'plex', display_name: 'S1', is_enabled: 1 })
    
    // Only own S1E1
    db.upsertMediaItem(createEpisode({
      source_id: 's1',
      library_id: 'tvshows',
      plex_id: 'p1',
      series_title: 'Game of Thrones',
      season_number: 1,
      episode_number: 1,
      series_tmdb_id: '1399'
    }))

    const completeness = await service.analyzeSeries('Game of Thrones', 's1', 'tvshows', '1399')
    
    expect(completeness).not.toBeNull()
    expect(completeness!.series_title).toBe('Game of Thrones')
    expect(completeness!.owned_episodes).toBe(1)
    
    const missing = JSON.parse(completeness!.missing_episodes)
    // S1E2 is missing (based on our mock season 1 having 2 episodes)
    // Note: Analysis engine uses 'S1E2' key format.
    expect(missing).toContainEqual(expect.objectContaining({
      season_number: 1,
      episode_number: 2
    }))
    })

    it('should update artwork for local sources during analysis', async () => {
    db.upsertMediaSource({ source_id: 'local1', source_type: 'local', display_name: 'Local', is_enabled: 1 })

    db.upsertMediaItem(createEpisode({
      source_id: 'local1',
      library_id: 'tvshows',
      plex_id: 'local-ep-1',
      series_title: 'Game of Thrones',
      season_number: 1,
      episode_number: 1,
      series_tmdb_id: '1399'
    }))

    await service.analyzeSeries('Game of Thrones', 'local1', 'tvshows', '1399')

    const item = db.mediaRepo.getMediaItemByProviderId('local-ep-1', 'local1')
    expect(item).not.toBeNull()
    expect(item!.poster_url).toBe(`https://image.tmdb.org/t/p/w500/poster.jpg`)
    expect(item!.episode_thumb_url).toBe(`https://image.tmdb.org/t/p/w500/still1.jpg`)
    expect(item!.season_poster_url).toBe(`https://image.tmdb.org/t/p/w500/season1.jpg`)
    })
})
