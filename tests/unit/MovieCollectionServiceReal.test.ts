import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { MovieCollectionService } from '@main/services/MovieCollectionService'
import { getTMDBService, resetTMDBServiceForTesting } from '@main/services/TMDBService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import http from 'node:http'
import path from 'node:path'

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
      plex_id: overrides.plex_id || `plex-${Math.random()}`,
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
      } else if (req.url?.includes('/search/collection')) {
         res.end(JSON.stringify({
           results: [{ id: 10, name: 'Fight Club Collection' }]
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
    resetTMDBServiceForTesting()
    db = await setupTestDb()
    
    await db.config.setSetting('tmdb_api_key', 'test-key')
    await db.config.setSetting('tmdb_base_url', `http://127.0.0.1:${serverPort}`)

    tmdb = getTMDBService()
    await tmdb.initialize()

    service = new MovieCollectionService()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should deduplicate movies by TMDB ID', async () => {
    // Insert duplicate movies from different sources
    await db.sources.upsertSource({ source_id: 's1', source_type: 'plex', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
    await db.sources.upsertSource({ source_id: 's2', source_type: 'jellyfin', display_name: 'S2', connection_config: '{}', is_enabled: 1 })

    await db.media.upsertItem(createMovie({
      source_id: 's1',
      plex_id: 'p1',
      title: 'Fight Club',
      tmdb_id: '550',
      video_bitrate: 5000
    }))

    await db.media.upsertItem(createMovie({
      source_id: 's2',
      plex_id: 'p2',
      title: 'Fight Club',
      tmdb_id: '550',
      video_bitrate: 8000 // Better version
    }))

    const deduplicated = await service.getMoviesDeduplicatedByTmdbId()

    expect(deduplicated).toHaveLength(1)
    expect(deduplicated[0].video_bitrate).toBe(8000)
    expect(deduplicated[0].source_id).toBe('s2')
  })

  it('should analyze collections and find missing movies', async () => {
     await db.sources.upsertSource({ source_id: 's1', source_type: 'plex', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
     await db.media.upsertItem(createMovie({
      source_id: 's1',
      plex_id: 'p1',
      title: 'Fight Club',
      tmdb_id: '550'
    }))

    await service.analyzeAllCollections()

    const collections = await service.getCollections()
    expect(collections).toHaveLength(1)
    expect(collections[0].collection_name).toBe('Fight Club Collection')
    expect(collections[0].owned_movies).toBe(1)
    expect(collections[0].total_movies).toBe(2)
    
    const missing = JSON.parse(collections[0].missing_movies)
    expect(missing).toHaveLength(1)
    expect(missing[0].title).toBe('Fight Club 2')
  })

  it('should lookup missing TMDB IDs for local sources', async () => {
    await db.sources.upsertSource({ source_id: 'local1', source_type: 'local', display_name: 'Local', connection_config: '{}', is_enabled: 1 })
    await db.media.upsertItem(createMovie({
      source_id: 'local1',
      plex_id: 'local-file-1',
      title: 'Fight Club',
      year: 1999,
      tmdb_id: null
    }))

    await service.analyzeAllCollections('local1')

    const item = await db.media.getItemByProviderId('local-file-1', 'local1')
    expect(item.tmdb_id).toBe('550')
  })
})



