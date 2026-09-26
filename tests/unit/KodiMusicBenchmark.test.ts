import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { KodiLocalProvider } from '@main/providers/kodi/KodiLocalProvider'
import { ProviderType } from '@main/types/database'
import type { KodiMusicSongResult } from '@main/providers/kodi/KodiMusicDatabaseSchema'

describe('Kodi Music Sync Benchmark', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  test('Benchmark song scanning performance', async () => {
    const provider = new KodiLocalProvider({
      sourceId: 'bench-src',
      displayName: 'Kodi Bench',
      sourceType: ProviderType.KodiLocal,
      connectionConfig: {},
    })

    const songCount = 500
    const mockSongs: KodiMusicSongResult[] = []
    for (let i = 1; i <= songCount; i++) {
      mockSongs.push({
        idSong: i,
        strTitle: `Song ${i}`,
        idAlbum: 1,
        strPath: '/music/album1/',
        strFileName: `song${i}.mp3`,
        iTrack: i,
        iDuration: 180,
        strMusicBrainzTrackID: null,
        albumTitle: 'Album 1',
        artistDisp: 'Artist 1',
        mood: null,
      })
    }

    provider['queryAll'] = vi.fn().mockImplementation(async (sql, _params, dbType) => {
      if (dbType === 'music') {
        if (sql.includes('FROM artist')) {
          return [{ idArtist: 1, strArtist: 'Artist 1', strSortName: 'Artist 1' }]
        } else if (sql.includes('FROM album')) {
          return [{ idAlbum: 1, strAlbum: 'Album 1', artistId: 1, strArtistDisp: 'Artist 1' }]
        } else if (sql.includes('FROM song')) {
          return mockSongs
        }
      }
      return []
    })

    const start = performance.now()
    const result = await provider.scanMusicLibrary()
    const duration = performance.now() - start

    if (result.errors.length > 0) {
      console.log('Result errors:', result.errors)
    }

    expect(result.success).toBe(true)
    expect(result.itemsScanned).toBe(1 + 1 + songCount)
    console.log(`[BENCHMARK] Scanned ${songCount} songs in ${duration.toFixed(2)} ms`)
  })
})
