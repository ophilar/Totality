/**
 * MusicRepository Integration Tests
 *
 * Tests music upsert methods with a real in-memory SQL.js database
 * to verify ID lookups, OR logic in album queries, and upsert behavior.
 */

import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'

// Unmock sql.js so we get a real in-memory database
vi.unmock('sql.js')

import initSqlJs, { type Database } from 'sql.js'
import { MusicRepository } from '../../src/main/services/database/MusicRepository'
import { DATABASE_SCHEMA } from '../../src/main/database/schema'

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs()
})

describe('MusicRepository', () => {
  let db: Database
  let repo: MusicRepository
  let saveCallback: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = new SQL.Database()
    db.run(DATABASE_SCHEMA)
    // Add user_fixed_match columns (added via migration in prod)
    db.run('ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0')
    db.run('ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0')

    saveCallback = vi.fn()
    repo = new MusicRepository(() => db, saveCallback)
  })

  // ============================================================================
  // ARTIST UPSERT — ID LOOKUP BY UNIQUE KEY
  // ============================================================================

  describe('upsertArtist', () => {
    it('should return correct ID on insert', async () => {
      const id = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })
      expect(id).toBe(1)
    })

    it('should return same ID on update (not lastInsertRowid)', async () => {
      const id1 = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })

      // Insert a second artist to advance lastInsertRowid
      await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-2',
        name: 'Led Zeppelin',
        created_at: '',
        updated_at: '',
      })

      // Update the first artist — lastInsertRowid would be 2, but we want 1
      const id3 = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd (updated)',
        created_at: '',
        updated_at: '',
      })

      expect(id3).toBe(id1)
    })

    it('should preserve user_fixed_match musicbrainz_id on update', async () => {
      // Insert artist
      await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        musicbrainz_id: 'original-mbid',
        created_at: '',
        updated_at: '',
      })

      // Set user_fixed_match
      db.run('UPDATE music_artists SET user_fixed_match = 1 WHERE id = 1')

      // Re-upsert with different mbid
      await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        musicbrainz_id: 'new-mbid',
        created_at: '',
        updated_at: '',
      })

      const result = db.exec('SELECT musicbrainz_id FROM music_artists WHERE id = 1')
      expect(result[0].values[0][0]).toBe('original-mbid')
    })
  })

  // ============================================================================
  // ALBUM UPSERT — ID LOOKUP BY UNIQUE KEY
  // ============================================================================

  describe('upsertAlbum', () => {
    let artistId: number

    beforeEach(async () => {
      artistId = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })
    })

    it('should return correct ID on insert', async () => {
      const id = await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        created_at: '',
        updated_at: '',
      })
      expect(id).toBe(1)
    })

    it('should return same ID on update (not lastInsertRowid)', async () => {
      const id1 = await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        created_at: '',
        updated_at: '',
      })

      // Insert second album to advance lastInsertRowid
      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-2',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'Wish You Were Here',
        created_at: '',
        updated_at: '',
      })

      // Update first album
      const id3 = await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon (Remaster)',
        created_at: '',
        updated_at: '',
      })

      expect(id3).toBe(id1)
    })
  })

  // ============================================================================
  // TRACK UPSERT — ID LOOKUP BY UNIQUE KEY
  // ============================================================================

  describe('upsertTrack', () => {
    it('should return correct ID on insert', async () => {
      const id = await repo.upsertTrack({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'track-1',
        artist_name: 'Pink Floyd',
        title: 'Time',
        audio_codec: 'flac',
        created_at: '',
        updated_at: '',
      })
      expect(id).toBe(1)
    })

    it('should return same ID on update (not lastInsertRowid)', async () => {
      const id1 = await repo.upsertTrack({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'track-1',
        artist_name: 'Pink Floyd',
        title: 'Time',
        audio_codec: 'flac',
        created_at: '',
        updated_at: '',
      })

      // Insert second track
      await repo.upsertTrack({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'track-2',
        artist_name: 'Pink Floyd',
        title: 'Money',
        audio_codec: 'flac',
        created_at: '',
        updated_at: '',
      })

      // Update first track
      const id3 = await repo.upsertTrack({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'track-1',
        artist_name: 'Pink Floyd',
        title: 'Time (Remastered)',
        audio_codec: 'flac',
        created_at: '',
        updated_at: '',
      })

      expect(id3).toBe(id1)
    })

    it('should link track to album and artist via FK', async () => {
      const artistId = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })

      const albumId = await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        created_at: '',
        updated_at: '',
      })

      const trackId = await repo.upsertTrack({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'track-1',
        artist_id: artistId,
        album_id: albumId,
        artist_name: 'Pink Floyd',
        album_name: 'The Dark Side of the Moon',
        title: 'Time',
        audio_codec: 'flac',
        created_at: '',
        updated_at: '',
      })

      const track = repo.getTrackById(trackId)
      expect(track).not.toBeNull()
      expect(track!.album_id).toBe(albumId)
      expect(track!.artist_id).toBe(artistId)
    })
  })

  // ============================================================================
  // ALBUM QUERIES — OR LOGIC (artistId + artistName)
  // ============================================================================

  describe('getAlbums with artistId + artistName OR logic', () => {
    it('should find albums by artistId only', async () => {
      const artistId = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })

      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        created_at: '',
        updated_at: '',
      })

      const albums = repo.getAlbums({ artistId })
      expect(albums).toHaveLength(1)
      expect(albums[0].title).toBe('The Dark Side of the Moon')
    })

    it('should find albums by artistName only', async () => {
      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_name: 'Pink Floyd',
        title: 'The Wall',
        created_at: '',
        updated_at: '',
      })

      const albums = repo.getAlbums({ artistName: 'Pink Floyd' })
      expect(albums).toHaveLength(1)
    })

    it('should find albums with mismatched FK via OR logic', async () => {
      const artistId = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })

      // Album with correct FK
      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        created_at: '',
        updated_at: '',
      })

      // Album from different source with no FK but same artist_name
      await repo.upsertAlbum({
        source_id: 'src-2',
        source_type: 'jellyfin',
        provider_id: 'album-2',
        artist_name: 'Pink Floyd',
        title: 'Wish You Were Here',
        created_at: '',
        updated_at: '',
      })

      // Query with both artistId AND artistName (OR logic)
      const albums = repo.getAlbums({ artistId, artistName: 'Pink Floyd' })
      expect(albums).toHaveLength(2)
    })

    it('should be case-insensitive for artistName', async () => {
      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_name: 'Pink Floyd',
        title: 'Animals',
        created_at: '',
        updated_at: '',
      })

      const albums = repo.getAlbums({ artistName: 'pink floyd' })
      expect(albums).toHaveLength(1)
    })
  })

  // ============================================================================
  // COUNT ALBUMS — matching OR logic
  // ============================================================================

  describe('countAlbums with artistId + artistName OR logic', () => {
    it('should count albums matching OR condition', async () => {
      const artistId = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })

      // Album with FK
      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        created_at: '',
        updated_at: '',
      })

      // Album without FK but matching name
      await repo.upsertAlbum({
        source_id: 'src-2',
        source_type: 'jellyfin',
        provider_id: 'album-2',
        artist_name: 'Pink Floyd',
        title: 'Wish You Were Here',
        created_at: '',
        updated_at: '',
      })

      const count = repo.countAlbums({ artistId, artistName: 'Pink Floyd' })
      expect(count).toBe(2)
    })

    it('should count zero when no match', () => {
      const count = repo.countAlbums({ artistId: 999 })
      expect(count).toBe(0)
    })
  })

  // ============================================================================
  // ALBUM FILTERING
  // ============================================================================

  describe('album filtering', () => {
    beforeEach(async () => {
      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-a',
        artist_name: 'Pink Floyd',
        title: 'Animals',
        year: 1977,
        created_at: '',
        updated_at: '',
      })
      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-d',
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        year: 1973,
        created_at: '',
        updated_at: '',
      })
      await repo.upsertAlbum({
        source_id: 'src-2',
        source_type: 'jellyfin',
        provider_id: 'album-b',
        artist_name: 'Led Zeppelin',
        title: '1 (Greatest Hits)',
        year: 2000,
        created_at: '',
        updated_at: '',
      })
    })

    it('should filter by sourceId', () => {
      const albums = repo.getAlbums({ sourceId: 'src-1' })
      expect(albums).toHaveLength(2)
    })

    it('should filter by searchQuery', () => {
      const albums = repo.getAlbums({ searchQuery: 'dark side' })
      expect(albums).toHaveLength(1)
      expect(albums[0].title).toBe('The Dark Side of the Moon')
    })

    it('should filter by alphabetFilter', () => {
      const albums = repo.getAlbums({ alphabetFilter: 'A' })
      expect(albums).toHaveLength(1)
      expect(albums[0].title).toBe('Animals')
    })

    it('should filter by # for non-alpha titles', () => {
      const albums = repo.getAlbums({ alphabetFilter: '#' })
      expect(albums).toHaveLength(1)
      expect(albums[0].title).toBe('1 (Greatest Hits)')
    })

    it('should sort by year', () => {
      const albums = repo.getAlbums({ sortBy: 'year', sortOrder: 'asc' })
      expect(albums[0].year).toBe(1973)
    })

    it('should apply limit and offset', () => {
      const albums = repo.getAlbums({ limit: 1, offset: 1 })
      expect(albums).toHaveLength(1)
    })
  })

  // ============================================================================
  // ARTIST QUERIES
  // ============================================================================

  describe('artist queries', () => {
    beforeEach(async () => {
      await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })
      await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-2',
        name: 'Led Zeppelin',
        created_at: '',
        updated_at: '',
      })
    })

    it('should get artist by ID', () => {
      const artist = repo.getArtistById(1)
      expect(artist).not.toBeNull()
      expect(artist!.name).toBe('Pink Floyd')
    })

    it('should get artist by name and source (case-insensitive)', () => {
      const artist = repo.getArtistByName('pink floyd', 'src-1')
      expect(artist).not.toBeNull()
      expect(artist!.name).toBe('Pink Floyd')
    })

    it('should return null for non-existent artist', () => {
      expect(repo.getArtistById(999)).toBeNull()
      expect(repo.getArtistByName('Nobody', 'src-1')).toBeNull()
    })

    it('should count artists with filters', () => {
      expect(repo.countArtists()).toBe(2)
      expect(repo.countArtists({ searchQuery: 'floyd' })).toBe(1)
    })

    it('should filter artists by alphabetFilter', () => {
      const artists = repo.getArtists({ alphabetFilter: 'P' })
      expect(artists).toHaveLength(1)
      expect(artists[0].name).toBe('Pink Floyd')
    })

    it('should update artist counts', async () => {
      await repo.updateArtistCounts(1, 14, 165)
      const artist = repo.getArtistById(1)
      expect(artist!.album_count).toBe(14)
      expect(artist!.track_count).toBe(165)
    })

    it('should update artist MusicBrainz ID (non-fixed only)', async () => {
      await repo.updateArtistMbid(1, 'mbid-123')
      let artist = repo.getArtistById(1)
      expect(artist!.musicbrainz_id).toBe('mbid-123')

      // Set user_fixed_match — should not update
      db.run('UPDATE music_artists SET user_fixed_match = 1 WHERE id = 1')
      await repo.updateArtistMbid(1, 'mbid-999')
      artist = repo.getArtistById(1)
      expect(artist!.musicbrainz_id).toBe('mbid-123')
    })
  })

  // ============================================================================
  // TRACK QUERIES
  // ============================================================================

  describe('track queries', () => {
    beforeEach(async () => {
      await repo.upsertTrack({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'track-1',
        artist_name: 'Pink Floyd',
        title: 'Time',
        audio_codec: 'flac',
        file_path: '/music/time.flac',
        created_at: '',
        updated_at: '',
      })
    })

    it('should get track by ID', () => {
      const track = repo.getTrackById(1)
      expect(track).not.toBeNull()
      expect(track!.title).toBe('Time')
    })

    it('should get track by file path', () => {
      const track = repo.getTrackByPath('/music/time.flac')
      expect(track).not.toBeNull()
      expect(track!.title).toBe('Time')
    })

    it('should return null for non-existent track', () => {
      expect(repo.getTrackById(999)).toBeNull()
      expect(repo.getTrackByPath('/nonexistent')).toBeNull()
    })

    it('should delete track', async () => {
      await repo.deleteTrack(1)
      expect(repo.getTrackById(1)).toBeNull()
    })
  })

  // ============================================================================
  // ALBUM RETRIEVAL
  // ============================================================================

  describe('album retrieval', () => {
    let artistId: number

    beforeEach(async () => {
      artistId = await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Pink Floyd',
        created_at: '',
        updated_at: '',
      })

      await repo.upsertAlbum({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'album-1',
        artist_id: artistId,
        artist_name: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        year: 1973,
        created_at: '',
        updated_at: '',
      })
    })

    it('should get album by ID', () => {
      const album = repo.getAlbumById(1)
      expect(album).not.toBeNull()
      expect(album!.title).toBe('The Dark Side of the Moon')
    })

    it('should get album by name and artist ID', () => {
      const album = repo.getAlbumByName('The Dark Side of the Moon', artistId)
      expect(album).not.toBeNull()
    })

    it('should get albums by artist name', () => {
      const albums = repo.getAlbumsByArtistName('Pink Floyd')
      expect(albums).toHaveLength(1)
    })

    it('should return null for non-existent album', () => {
      expect(repo.getAlbumById(999)).toBeNull()
      expect(repo.getAlbumByName('Nonexistent', artistId)).toBeNull()
    })
  })

  // ============================================================================
  // SAVE CALLBACK
  // ============================================================================

  describe('save callback', () => {
    it('should call save after upsert operations', async () => {
      await repo.upsertArtist({
        source_id: 'src-1',
        source_type: 'plex',
        provider_id: 'artist-1',
        name: 'Test',
        created_at: '',
        updated_at: '',
      })
      expect(saveCallback).toHaveBeenCalled()
    })
  })
})
