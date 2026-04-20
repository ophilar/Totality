import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MovieCollectionService } from '../../src/main/services/MovieCollectionService'
import { getBetterSQLiteService, resetBetterSQLiteServiceForTesting } from '../../src/main/database/BetterSQLiteService'
import { getTMDBService, resetTMDBServiceForTesting } from '../../src/main/services/TMDBService'
import http from 'node:http'

describe('MovieCollectionService (No Mocks)', () => {
  let db: any
  let tmdb: any
  let service: MovieCollectionService
  let server: http.Server
  let serverPort: number

  const createMovie = (overrides: any) => {
    return {
      type: 'movie',
      file_path: `/path/to/${overrides.title || 'movie'}.mkv`,
      file_size: 1000000000,
      duration: 8340000,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate: 5000,
      audio_codec: 'ac3',
      audio_channels: 6,
      audio_bitrate: 640,
      ...overrides
    }
  }

  beforeAll(async () => {
    // Setup local TMDB mock server
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (req.url?.includes('/movie/550')) {
        res.end(JSON.stringify({
          id: 550,
          title: 'Fight Club',
          belongs_to_collection: { id: 10, name: 'Fight Club Collection' },
          poster_path: '/poster.jpg'
        }))
      } else if (req.url?.includes('/collection/10')) {
        res.end(JSON.stringify({
          id: 10,
          name: 'Fight Club Collection',
          parts: [
            { id: 550, title: 'Fight Club', release_date: '1999-10-15' },
            { id: 551, title: 'Fight Club 2', release_date: '2025-01-01' }
          ]
        }))
      } else if (req.url?.includes('/search/movie')) {
         res.end(JSON.stringify({
           results: [{ id: 550, title: 'Fight Club', release_date: '1999-10-15' }]
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

    // Ensure we use in-memory DB for tests
    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'

    db = getBetterSQLiteService()
    await db.initialize()
    
    db.config.setSetting('tmdb_api_key', 'test-key')
    db.config.setSetting('tmdb_base_url', `http://127.0.0.1:${serverPort}`)

    tmdb = getTMDBService()
    await tmdb.initialize()

    service = new MovieCollectionService()
  })

  it('should deduplicate movies by TMDB ID', async () => {
    // Insert duplicate movies from different sources
    db.sources.upsertSource({ source_id: 's1', source_type: 'plex', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
    db.sources.upsertSource({ source_id: 's2', source_type: 'jellyfin', display_name: 'S2', connection_config: '{}', is_enabled: 1 })

    db.media.upsertItem(createMovie({
      source_id: 's1',
      plex_id: 'p1',
      title: 'Fight Club',
      tmdb_id: '550',
      video_bitrate: 5000
    }))

    db.media.upsertItem(createMovie({
      source_id: 's2',
      plex_id: 'p2',
      title: 'Fight Club',
      tmdb_id: '550',
      video_bitrate: 8000,
      audio_codec: 'dts',
      audio_bitrate: 1500
    }))

    // @ts-ignore - accessing private method for testing
    const deduplicated = await service.getMoviesDeduplicatedByTmdbId()
    
    expect(deduplicated).toHaveLength(1)
    expect(deduplicated[0].video_bitrate).toBe(8000)
    expect(deduplicated[0].source_id).toBe('s2')
  })

  it('should analyze collections and find missing movies', async () => {
     db.sources.upsertSource({ source_id: 's1', source_type: 'plex', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
     db.media.upsertItem(createMovie({
      source_id: 's1',
      plex_id: 'p1',
      title: 'Fight Club',
      tmdb_id: '550'
    }))

    await service.analyzeAllCollections()

    const collections = service.getCollections()
    expect(collections).toHaveLength(1)
    expect(collections[0].collection_name).toBe('Fight Club Collection')
    expect(collections[0].owned_movies).toBe(1)
    expect(collections[0].total_movies).toBe(2)
    
    const missing = JSON.parse(collections[0].missing_movies)
    expect(missing).toHaveLength(1)
    expect(missing[0].title).toBe('Fight Club 2')
  })

  it('should lookup missing TMDB IDs for local sources', async () => {
    db.sources.upsertSource({ source_id: 'local1', source_type: 'local', display_name: 'Local', connection_config: '{}', is_enabled: 1 })
    db.media.upsertItem(createMovie({
      source_id: 'local1',
      plex_id: 'local-file-1',
      title: 'Fight Club',
      year: 1999,
      tmdb_id: null // Ensure it's null for lookup test
    }))

    // @ts-ignore
    await service.getMoviesDeduplicatedByTmdbId()

    const item = db.media.getItemByProviderId('local-file-1', 'local1')
    expect(item.tmdb_id).toBe('550')
  })
})
