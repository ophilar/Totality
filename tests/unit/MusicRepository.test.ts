import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MusicRepository } from '@main/database/repositories/MusicRepository'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('MusicRepository (Real DB)', () => {
  let repo: MusicRepository
  let mediaRepo: MediaRepository
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.music
    mediaRepo = db.media
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
    }

    const id = await repo.upsertArtist(artist)
    expect(id).toBeGreaterThan(0)

    const retrieved = await repo.getMusicArtistByName('Artist 1', 'src-1')
    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe('Artist 1')
  })

  it('should upsert and retrieve an album', async () => {
    const artistId = await repo.upsertArtist({ source_id: 's1', source_type: 'local', provider_id: 'art1', name: 'A1' })

    const album = {
      source_id: 's1',
      source_type: 'local',
      provider_id: 'alb1',
      artist_id: artistId,
      artist_name: 'A1',
      title: 'Album 1',
    }

    const albumId = await repo.upsertAlbum(album)
    expect(albumId).toBeGreaterThan(0)

    const retrieved = await repo.getAlbumByName('Album 1', artistId!)
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
    }

    await repo.upsertTrack(track)

    const retrieved = await repo.getTrackByPath('/path/to/track.flac')
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe('T1')
  })

  it('uses artist identity as the descending pagination tie-breaker', async () => {
    const ids: number[] = []
    for (let index = 1; index <= 4; index += 1) {
      ids.push(await repo.upsertArtist({
        source_id: 's-pagination',
        source_type: 'local',
        provider_id: `artist-${index}`,
        name: `Artist ${index}`,
        sort_name: 'Same Artist Sort',
      }))
    }

    const firstPage = await repo.getArtists({ sourceId: 's-pagination', sortBy: 'name', sortOrder: 'desc', limit: 2, offset: 0 })
    const secondPage = await repo.getArtists({ sourceId: 's-pagination', sortBy: 'name', sortOrder: 'desc', limit: 2, offset: 2 })

    expect([...firstPage, ...secondPage].map(artist => artist.id)).toEqual([...ids].sort((a, b) => b - a))
  })

  it('uses album identity as the descending pagination tie-breaker', async () => {
    const artistId = await repo.upsertArtist({ source_id: 's-albums', source_type: 'local', provider_id: 'artist', name: 'Artist' })
    const ids: number[] = []
    for (let index = 1; index <= 4; index += 1) {
      ids.push(await repo.upsertAlbum({
        source_id: 's-albums',
        source_type: 'local',
        provider_id: `album-${index}`,
        artist_id: artistId,
        artist_name: 'Artist',
        title: `Album ${index}`,
        sort_title: 'Same Album Sort',
      }))
    }

    const firstPage = await repo.getAlbums({ sourceId: 's-albums', sortBy: 'title', sortOrder: 'desc', limit: 2, offset: 0 })
    const secondPage = await repo.getAlbums({ sourceId: 's-albums', sortBy: 'title', sortOrder: 'desc', limit: 2, offset: 2 })

    expect([...firstPage, ...secondPage].map(album => album.id)).toEqual([...ids].sort((a, b) => b - a))
  })

  it('uses track identity as the descending pagination tie-breaker', async () => {
    const ids: number[] = []
    for (let index = 1; index <= 4; index += 1) {
      ids.push(await repo.upsertTrack({
        source_id: 's-tracks',
        source_type: 'local',
        provider_id: `track-${index}`,
        artist_name: 'Artist',
        title: 'Same Track Title',
        file_path: `/music/track-${index}.flac`,
        audio_codec: 'flac',
      }))
    }

    const firstPage = await repo.getTracks({ sourceId: 's-tracks', sortBy: 'title', sortOrder: 'desc', limit: 2, offset: 0 })
    const secondPage = await repo.getTracks({ sourceId: 's-tracks', sortBy: 'title', sortOrder: 'desc', limit: 2, offset: 2 })

    expect([...firstPage, ...secondPage].map(track => track.id)).toEqual([...ids].sort((a, b) => b - a))
  })

  it('persists the canonical series identity for an episode with a series TMDB id', async () => {
    const episodeId = await mediaRepo.upsertItem({
      source_id: 'src-1',
      source_type: 'plex',
      library_id: 'lib-1',
      plex_id: 'episode-1',
      type: 'episode',
      title: 'Episode 1',
      series_title: 'Andor',
      series_tmdb_id: '83867',
      file_path: '/path/to/episode.mkv',
    })

    const episode = await mediaRepo.getItemById(episodeId)
    expect(episode?.series_identity_key).toBe('tmdb:83867')
  })

  it('sanitizes NaN and invalid release years on upsertAlbum', async () => {
    const artistId = await repo.upsertArtist({ source_id: 's1', source_type: 'local', provider_id: 'art2', name: 'A2' })

    const albumWithNaN = {
      source_id: 's1',
      source_type: 'local',
      provider_id: 'alb-nan',
      artist_id: artistId,
      artist_name: 'A2',
      title: 'Album NaN',
      year: NaN as unknown as number,
    }

    const albumId = await repo.upsertAlbum(albumWithNaN)
    const retrieved = await repo.getAlbumById(albumId)
    expect(retrieved?.year).toBeUndefined()

    const albumWithValidYear = {
      source_id: 's1',
      source_type: 'local',
      provider_id: 'alb-valid',
      artist_id: artistId,
      artist_name: 'A2',
      title: 'Album 2024',
      year: 2024,
    }

    const validId = await repo.upsertAlbum(albumWithValidYear)
    const validRetrieved = await repo.getAlbumById(validId)
    expect(validRetrieved?.year).toBe(2024)
  })
})
