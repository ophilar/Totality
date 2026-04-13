
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import { MediaRepository } from '../../src/main/database/repositories/MediaRepository'
import { MusicRepository } from '../../src/main/database/repositories/MusicRepository'
import * as fs from 'fs'
import * as path from 'path'

describe('Repository Deep Dive (No Mocks)', () => {
  let db: DatabaseSync
  const dbPath = path.join(__dirname, 'repo-deep-dive.db')
  let mediaRepo: MediaRepository
  let musicRepo: MusicRepository

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    db = new DatabaseSync(dbPath)
    runMigrations(db as any)
    mediaRepo = new MediaRepository(db)
    musicRepo = new MusicRepository(db)
    
    // Add source
    db.prepare("INSERT INTO media_sources (source_id, source_type, display_name) VALUES (?, ?, ?)").run('s1', 'local', 'S1')
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  describe('MediaRepository Coverage', () => {
    it('should exercise all CRUD and filter paths', () => {
      // 1. Add items using specialized upsert
      const item1: any = {
        title: 'Movie A', type: 'movie', source_id: 's1', plex_id: 'p1', file_path: 'f1', file_size: 1, duration: 1,
        resolution: '1080p', width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 1, audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      }
      
      const item2: any = {
        title: 'Show A', series_title: 'Show A', type: 'episode', season_number: 1, episode_number: 1, source_id: 's1', plex_id: 'p2', file_path: 'f2', file_size: 1, duration: 1,
        resolution: '720p', width: 1280, height: 720, video_codec: 'h264', video_bitrate: 1, audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      }

      const id1 = mediaRepo.upsertItem(item1)
      const id2 = mediaRepo.upsertItem(item2)

      // 2. Query filters
      expect(mediaRepo.getMediaItems({ type: 'movie' }).length).toBe(1)
      expect(mediaRepo.getMediaItems({ sourceId: 's1' }).length).toBe(2)
      expect(mediaRepo.getItemByProviderId('p1', 's1')).toBeDefined()
      expect(mediaRepo.getItemByPath('f1')).toBeDefined()
      expect(mediaRepo.getEpisodesForSeries('Show A', 's1').length).toBe(1)

      // 3. Updates
      mediaRepo.updatePathAndStats(id1, 'f1_new', { fileSize: 2000, video: { resolution: '4K' } })
      expect(mediaRepo.getItem(id1)?.file_path).toBe('f1_new')

      // 4. Versions
      db.prepare(`
        INSERT INTO media_item_versions (media_item_id, version_source, file_path, file_size, duration, resolution, width, height, video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate)
        VALUES (?, ?, ?, 1, 1, '1', 1, 1, '1', 1, '1', 1, 1)
      `).run(id1, 'alt', 'f1_v2')
      const versions = db.prepare('SELECT * FROM media_item_versions WHERE media_item_id = ?').all(id1)
      expect(versions.length).toBe(1)

      // 5. Cleanup
      mediaRepo.delete(id1)
      expect(mediaRepo.getItem(id1)).toBeNull()
      mediaRepo.deleteItemsForSource('s1')
      expect(mediaRepo.getMediaItems({}).length).toBe(0)
    })
  })

  describe('MusicRepository Coverage', () => {
    it('should exercise all artist, album, and track paths', () => {
      // 1. Add data
      const artistId = musicRepo.upsertMusicArtist({ 
        source_id: 's1', source_type: 'local', provider_id: 'pa1', name: 'Artist A', library_id: 'l1' 
      } as any)
      
      const albumId = musicRepo.upsertMusicAlbum({ 
        source_id: 's1', source_type: 'local', provider_id: 'pal1', title: 'Album A', artist_id: artistId, artist_name: 'Artist A', library_id: 'l1' 
      } as any)
      
      const trackId = musicRepo.upsertMusicTrack({ 
        source_id: 's1', source_type: 'local', provider_id: 'pt1', title: 'Track 1', album_id: albumId, artist_id: artistId, artist_name: 'Artist A', album_name: 'Album A', 
        library_id: 'l1', file_path: 'f1', duration: 100, bitrate: 320, 
        audio_codec: 'mp3', channels: 2, sample_rate: 44100, is_lossless: 0, is_hi_res: 0
      } as any)

      // 2. Query
      expect(musicRepo.getMusicArtists({}).length).toBe(1)
      expect(musicRepo.getMusicAlbums({}).length).toBe(1)
      expect(musicRepo.getMusicTracks({ albumId }).length).toBe(1)
      expect(musicRepo.getMusicArtistByName('Artist A', 's1')).toBeDefined()
      
      // 3. Quality Scores
      musicRepo.upsertMusicQualityScore({
        album_id: albumId, quality_tier: 'LOSSY_HIGH', tier_quality: 'HIGH', tier_score: 90,
        codec_score: 100, bitrate_score: 100, efficiency_score: 50, storage_debt_bytes: 0,
        needs_upgrade: false, issues: '[]'
      })
      expect(musicRepo.getMusicQualityScore(albumId)).toBeDefined()

      // 4. Statistics
      const stats = musicRepo.getMusicStats('s1')
      expect(stats.totalArtists).toBe(1)
      expect(stats.totalAlbums).toBe(1)

      // 5. Cleanup
      musicRepo.deleteMusicTrack(trackId)
      expect(musicRepo.getMusicTracks({ albumId }).length).toBe(0)
    })
  })
})
