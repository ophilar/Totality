import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { MusicRepository } from '../../src/main/database/repositories/MusicRepository'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import type { MusicArtist, MusicAlbum } from '../../src/main/types/database'

describe('MusicRepository', () => {
  let db: Database.Database
  let repo: MusicRepository

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    repo = new MusicRepository(db)
  })

  describe('upsertArtist', () => {
    it('should return correct ID on insert', () => {
      const id = repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
      } as MusicArtist)
      expect(id).toBe(1)
    })

    it('should return same ID on update', () => {
      const id1 = repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
      } as MusicArtist)

      repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-2',
        name: 'Led Zeppelin',
      } as MusicArtist)

      const id3 = repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd (updated)',
      } as MusicArtist)

      expect(id3).toBe(id1)
    })
  })

  describe('upsertAlbum', () => {
    let artistId: number

    beforeEach(() => {
      artistId = repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
      } as MusicArtist)
    })

    it('should return correct ID on insert', () => {
      const id = repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
      } as MusicAlbum)
      expect(id).toBe(1)
    })
  })

  describe('filtering', () => {
    beforeEach(() => {
      const artistId = repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
      } as MusicArtist)
      repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'Animals',
        year: 1977
      } as MusicAlbum)
    })

    it('should filter by searchQuery', () => {
      const albums = repo.getMusicAlbums({ searchQuery: 'Animals' })
      expect(albums).toHaveLength(1)
      expect(albums[0].title).toBe('Animals')
    })

    it('should filter by artistId', () => {
      const albums = repo.getMusicAlbums({ artistId: 1 })
      expect(albums).toHaveLength(1)
    })
  })
})
