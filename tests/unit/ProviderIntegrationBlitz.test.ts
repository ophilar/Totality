/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { JellyfinProvider } from '@main/providers/jellyfin-emby/JellyfinProvider'
import { KodiProvider } from '@main/providers/kodi/KodiProvider'
import { MediaMonkeyProvider } from '@main/providers/mediamonkey/MediaMonkeyProvider'
import { setupTestDb, cleanupTestDb, LocalIntegratedApiServer, createTempDir } from '@tests/TestUtils'
import { ProviderType } from '@main/types/database'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

describe('Provider Integration (No Mocks)', () => {
  let server: LocalIntegratedApiServer

  beforeEach(async () => {
    await setupTestDb()
    server = new LocalIntegratedApiServer()
    await server.start()
  })

  afterEach(async () => {
    await cleanupTestDb()
    await server.stop()
  })

  describe('Plex Integration', () => {
    it('should authenticate and fetch libraries through real networking', async () => {
      server.setResponse('/pins', { id: 12345, code: 'TEST-CODE' }, 201)
      server.setResponse('/pins/12345', { id: 12345, authToken: 'valid-token' }, 200)
      
      const provider = new PlexProvider({
        sourceId: 'p1',
        sourceType: ProviderType.Plex,
        displayName: 'Plex',
        connectionConfig: { plexApiUrl: server.url }
      })

      const pin = await provider.requestAuthPin()
      expect(pin.id).toBe(12345)
      
      const token = await provider.checkAuthPin(pin.id)
      expect(token).toBe('valid-token')

      provider.setSelectedServer({
          name: 'Test Server',
          host: '127.0.0.1',
          address: '127.0.0.1',
          port: 32400,
          uri: server.url,
          scheme: 'http',
          machineIdentifier: 's1',
          version: '1.0.0',
          accessToken: 'valid-token',
          owned: true
      })
      
      server.setResponse('/library/sections', {
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Movies', type: 'movie' },
            { key: '2', title: 'TV Shows', type: 'show' }
          ]
        }
      }, 200, { 'Content-Type': 'application/json' })

      const libraries = await provider.getLibraries()
      expect(libraries).toHaveLength(2)
      expect(libraries[0].name).toBe('Movies')
    })
  })

  describe('Jellyfin Integration', () => {
    it('should authenticate and fetch libraries through real networking', async () => {
      const provider = new JellyfinProvider({
        sourceId: 'j1',
        sourceType: ProviderType.Jellyfin,
        displayName: 'Jellyfin',
        connectionConfig: { serverUrl: server.url }
      })

      server.setResponse('/Users/AuthenticateByName', {
        AccessToken: 'jelly-token',
        ServerId: 'server-1',
        User: { Id: 'u1', Name: 'test' }
      })
      
      server.setResponse('/Library/VirtualFolders', [
        { Name: 'Movies', CollectionType: 'movies', Id: 'l1' },
        { Name: 'TV', CollectionType: 'tvshows', Id: 'l2' }
      ])

      const auth = await provider.authenticate({ serverUrl: server.url, username: 'test', password: 'password' })
      expect(auth.success).toBe(true)

      const libraries = await provider.getLibraries()
      expect(libraries).toHaveLength(2)
    })
  })

  describe('Kodi Integration', () => {
    it('should fetch libraries and movies through RPC protocol', async () => {
      server.setHandler('/jsonrpc', (req, body) => {
        const { method } = body
        if (method === 'VideoLibrary.GetMovies') {
          return {
            status: 200,
            body: {
              result: {
                movies: [
                  { movieid: 1, title: 'Kodi Movie', file: '/path/movie.mkv', streamdetails: { video: [{ width: 1920, height: 1080 }], audio: [{ codec: 'ac3', channels: 6 }] } }
                ]
              }
            }
          }
        }
        if (method === 'JSONRPC.Version') {
          return { status: 200, body: { result: { version: { major: 19, minor: 0, revision: 0 } } } }
        }
        return { status: 404, body: { error: 'Unknown method' } }
      })

      const provider = new KodiProvider({
        sourceId: 'k1',
        sourceType: ProviderType.Kodi,
        displayName: 'Kodi',
        connectionConfig: { 
            host: '127.0.0.1', 
            port: parseInt(server.url.split(':')[2])
        }
      })

      const testResult = await provider.testConnection()
      expect(testResult.success).toBe(true)

      const libraries = await provider.getLibraries()
      expect(libraries).length.greaterThan(0)
    })
  })

  describe('MediaMonkey Integration', () => {
    it('should scan local MM5 database through real SQLite implementation', async () => {
      const temp = createTempDir('mm5')
      const dbPath = path.join(temp.path, 'mm5.db')
      
      const mmDb = new DatabaseSync(dbPath)
      mmDb.exec(`
        CREATE TABLE Artists (ID INTEGER PRIMARY KEY, Artist TEXT, SortArtist TEXT);
        CREATE TABLE Albums (ID INTEGER PRIMARY KEY, Album TEXT, SortAlbum TEXT, IDArtist INTEGER, ReleaseYear INTEGER, AlbumArtist TEXT);
        CREATE TABLE Songs (
          ID INTEGER PRIMARY KEY, SongTitle TEXT, IDAlbum INTEGER, IDArtist INTEGER, Artist TEXT, Album TEXT,
          TrackNumber INTEGER, DiscNumber INTEGER, SongLength INTEGER, SongPath TEXT, FileLength INTEGER,
          Bitrate INTEGER, SampleRate INTEGER, Channels INTEGER, AudioCodec TEXT, DateAdded REAL,
          MusicBrainzTrackID TEXT, MusicBrainzArtistID TEXT, MusicBrainzAlbumID TEXT, Mood TEXT
        );
      `)
      
      mmDb.prepare('INSERT INTO Artists (ID, Artist) VALUES (?, ?)').run(1, 'Pink Floyd')
      mmDb.prepare('INSERT INTO Albums (ID, Album, IDArtist, AlbumArtist) VALUES (?, ?, ?, ?)').run(1, 'The Wall', 1, 'Pink Floyd')
      mmDb.prepare('INSERT INTO Songs (ID, SongTitle, IDAlbum, IDArtist, Artist, Album, SongPath, AudioCodec, Bitrate, SampleRate, Channels) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(1, 'In The Flesh?', 1, 1, 'Pink Floyd', 'The Wall', 'C:\\Music\\wall.flac', 'FLAC', 1000000, 44100, 2)

      const provider = new MediaMonkeyProvider({
        sourceId: 'm1',
        sourceType: 'mediamonkey' as ProviderType,
        displayName: 'MediaMonkey',
        connectionConfig: { databasePath: dbPath }
      })

      const auth = await provider.authenticate({ databasePath: dbPath })
      expect(auth.success).toBe(true)

      const libraries = await provider.getLibraries()
      expect(libraries).toHaveLength(1)

      const scanResult = await provider.scanLibrary('entire_library')
      if (!scanResult.success) {
          console.error('Scan errors:', scanResult.errors)
      }
      expect(scanResult.success).toBe(true)
      expect(scanResult.itemsScanned).toBe(1)

      temp.cleanup()
    })
  })
})
