import { expect, test, describe, vi } from 'vitest'
import { KodiLocalProvider } from '@main/providers/kodi/KodiLocalProvider'

vi.mock('@main/database/BetterSQLiteService', () => {
    return {
        getDatabase: () => ({
            startBatch: vi.fn(),
            endBatch: vi.fn(),
            music: {
                upsertArtist: vi.fn(),
                upsertAlbum: vi.fn(),
                upsertTrack: vi.fn(),
                getArtistByProviderId: vi.fn().mockReturnValue({id: 1}),
                getAlbumByProviderId: vi.fn().mockReturnValue({id: 2, artist_id: 1}),
            },
            sources: {
                updateSourceScanTime: vi.fn()
            }
        })
    }
})
vi.mock('@main/services/LoggingService', () => {
    return {
        getLoggingService: () => ({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn()
        })
    }
})

describe('KodiSqlBaseProvider Music Sync', () => {
    test('scanMusicLibrary handles dbType music correctly', async () => {
        const provider = new KodiLocalProvider({ id: 'src-1', name: 'Kodi', type: 'kodi-local' } as any)

        provider['queryAll'] = vi.fn().mockImplementation(async (sql, params, dbType) => {
             expect(dbType).toBe('music')
             if (sql.includes('artist')) {
                 return [{ idArtist: 1, strArtist: 'Artist 1' }]
             } else if (sql.includes('album')) {
                 return [{ idAlbum: 1, strAlbum: 'Album 1', artistId: 1 }]
             } else if (sql.includes('song')) {
                 return [{ idSong: 1, strTitle: 'Song 1', idAlbum: 1, strPath: '/music', strFileName: 'song1.mp3' }]
             }
             return []
        })

        const result = await provider.scanMusicLibrary()
        expect(result.success).toBe(true)
        expect(result.itemsScanned).toBe(3)
    })
})
