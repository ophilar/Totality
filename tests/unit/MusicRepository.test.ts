import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MusicRepository } from '../../src/main/database/repositories/MusicRepository'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('MusicRepository (Real DB)', () => {
  let repo: MusicRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.music
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should upsert and retrieve an artist', async () => {
    const artist = {
      source_id: 'src-1',
      source_type: 'local',
      provider_id: 'p1',
      name: 'Artist 1',
    } as any

    const id = await repo.upsertArtist(artist)
    expect(id).toBeGreaterThan(0)

    const retrieved = repo.getMusicArtistByName('Artist 1', 'src-1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe('Artist 1')
  })

  it('should upsert and retrieve an album', async () => {
    const artistId = await repo.upsertArtist({ source_id: 's1', source_type: 'local', provider_id: 'art1', name: 'A1' } as any)
    
    const album = {
      source_id: 's1',
      source_type: 'local',
      provider_id: 'alb1',
      artist_id: artistId,
      artist_name: 'A1',
      title: 'Album 1',
    } as any

    const albumId = await repo.upsertAlbum(album)
    expect(albumId).toBeGreaterThan(0)

    const retrieved = repo.getAlbumByName('Album 1', artistId!)
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe('Album 1')
  })

  it('should get track by path', async () => {
    const track = {
      source_id: 's1',
      source_type: 'local',
      provider_id: 't1',
      artist_name: 'A1',
      title: 'T1',
      file_path: '/path/to/track.flac',
      audio_codec: 'flac'
    } as any

    await repo.upsertTrack(track)
    
    const retrieved = repo.getTrackByPath('/path/to/track.flac')
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe('T1')
  })
})
