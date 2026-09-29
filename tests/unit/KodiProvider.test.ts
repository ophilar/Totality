import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest'
import { KodiLocalProvider } from '@main/providers/kodi/KodiLocalProvider'
import { ProviderType } from '@main/types/database'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('KodiSqlBaseProvider Music Sync', () => {
    let db: Awaited<ReturnType<typeof setupTestDb>>

    beforeEach(async () => {
        db = await setupTestDb()
        await db.sources.upsertSource({
            source_id: 'src-1',
            source_type: ProviderType.KodiLocal,
            display_name: 'Kodi',
            connection_config: '{}',
            is_enabled: 1,
        })
    })

    afterEach(() => cleanupTestDb())

    test('scanMusicLibrary handles dbType music correctly', async () => {
        const provider = new KodiLocalProvider({ sourceId: 'src-1', displayName: 'Kodi', sourceType: ProviderType.KodiLocal, connectionConfig: {} })

        provider['queryAll'] = vi.fn().mockImplementation(async (sql, _params, dbType) => {
             expect(dbType).toBe('music')
             if (sql.includes('FROM artist a')) {
                 return [{ idArtist: 1, strArtist: 'Artist 1' }]
             } else if (sql.includes('FROM album al')) {
                 return [{ idAlbum: 1, strAlbum: 'Album 1', artistId: 1 }]
             } else if (sql.includes('FROM song s')) {
                 return [{ idSong: 1, strTitle: 'Song 1', idAlbum: 1, strPath: '/music', strFileName: 'song1.mp3' }]
             }
             return []
        })

        const result = await provider.scanMusicLibrary()
        expect(result.success).toBe(true)
        expect(result.errors).toEqual([])
        expect(result.itemsScanned).toBe(3)
        expect(await db.music.getArtists({ sourceId: 'src-1' })).toHaveLength(1)
        expect(await db.music.getAlbums({ sourceId: 'src-1' })).toHaveLength(1)
        expect(await db.music.getTracks({ sourceId: 'src-1' })).toHaveLength(1)
    })
})
