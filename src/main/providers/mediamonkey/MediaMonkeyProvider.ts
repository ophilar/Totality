/**
 * MediaMonkey 5 Provider
 * 
 * Implements the MediaProvider interface for MediaMonkey 5.
 * Connects directly to the MM5 SQLite database (mm5.db).
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import {
  BaseMediaProvider,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  SourceConfig,
  ProviderType,
  LibraryType,
} from '@main/providers/base/MediaProvider'
import type { MusicArtist, MusicAlbum, MusicTrack } from '@main/types/database'
import { getLoggingService } from '@main/services/LoggingService'
import { getDatabase } from '@main/database/getDatabase'
import {
  isLosslessCodec,
  isHiRes,
  calculateAlbumStats,
} from '@main/providers/base/MusicScannerUtils'

export interface MediaMonkeyConfig {
  databasePath: string
}

export class MediaMonkeyProvider extends BaseMediaProvider {
  readonly providerType: ProviderType = 'mediamonkey' as ProviderType

  private databasePath: string = ''
  private db: DatabaseSync | null = null
  private musicScanCancelled = false

  constructor(config: SourceConfig) {
    super(config)

    if (config.connectionConfig) {
      const cc = config.connectionConfig as MediaMonkeyConfig
      this.databasePath = cc.databasePath || ''
    }
  }

  // ============================================================================
  // AUTHENTICATION & CONNECTION
  // ============================================================================

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    const config = credentials as unknown as MediaMonkeyConfig
    if (!config.databasePath) {
      return { success: false, error: 'Database path is required' }
    }

    if (!fs.existsSync(config.databasePath)) {
      return { success: false, error: `Database file not found: ${config.databasePath}` }
    }

    this.databasePath = config.databasePath
    return { success: true }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.databasePath && fs.existsSync(this.databasePath)
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      // node:sqlite doesn't have a close() yet in some versions, 
      // but nulling it out allows GC.
      this.db = null
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      if (!this.databasePath) {
        return { success: false, error: 'Database path not configured' }
      }

      if (!fs.existsSync(this.databasePath)) {
        return { success: false, error: `File not found: ${this.databasePath}` }
      }

      const testDb = new DatabaseSync(this.databasePath, { readOnly: true })
      testDb.prepare('SELECT COUNT(*) as count FROM Songs').get()
      
      return {
        success: true
      }
    } catch (error: any) {
      return { success: false, error: `Failed to open MediaMonkey database: ${error.message}` }
    }
  }

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  async getLibraries(): Promise<MediaLibrary[]> {
    // MediaMonkey 5 usually has "Collections", but we'll return a standard Music library for now
    return [
      {
        id: 'mm5-music',
        name: 'MediaMonkey Music',
        type: LibraryType.Music,
        itemCount: 0 // Will be populated by scan
      }
    ]
  }

  async scanLibrary(libraryId: string, _options?: ScanOptions): Promise<ScanResult> {
    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0
    }

    try {
      if (!this.databasePath) throw new Error('Database path not configured')
      
      this.db = new DatabaseSync(this.databasePath, { readOnly: true })
      const db = getDatabase()
      const musicRepo = (db as any).musicRepo

      getLoggingService().info('[MediaMonkeyProvider]', `Starting scan of MediaMonkey database: ${this.databasePath}`)

      // 1. Get all Artists
      const artists = this.db.prepare(`
        SELECT ID, Artist, SortArtist
        FROM Artists
        WHERE Artist != ''
      `).all() as any[]

      // 2. Get all Albums
      const albums = this.db.prepare(`
        SELECT ID, Album, IDArtist, AlbumArtist, ReleaseYear, SortAlbum
        FROM Albums
        WHERE Album != ''
      `).all() as any[]

      // 3. Get all Songs
      const songs = this.db.prepare(`
        SELECT 
          ID, SongTitle, IDAlbum, IDArtist, Artist, Album, 
          TrackNumber, DiscNumber, SongLength, SongPath, FileLength,
          Bitrate, SampleRate, Channels, AudioCodec, DateAdded,
          MusicBrainzTrackID, MusicBrainzArtistID, MusicBrainzAlbumID,
          Mood
        FROM Songs
      `).all() as any[]

      result.itemsScanned = songs.length
      db.startBatch()

      try {
        const artistIdMap = new Map<number, number>() // MM5 Artist ID -> Totality Music Artist ID
        const albumIdMap = new Map<number, number>()  // MM5 Album ID -> Totality Music Album ID
        const albumTracksMap = new Map<number, MusicTrack[]>() // MM5 Album ID -> Totality MusicTrack[]

        // Process Artists
        for (const artist of artists) {
          const totalityArtist: MusicArtist = {
            source_id: this.sourceId,
            source_type: this.providerType,
            library_id: libraryId,
            provider_id: `artist_${artist.ID}`,
            name: artist.Artist,
            sort_name: artist.SortArtist || undefined,
          }
          const id = musicRepo.upsertMusicArtist(totalityArtist)
          artistIdMap.set(artist.ID, id)
        }

        // Process Albums
        for (const album of albums) {
          const totalityAlbum: MusicAlbum = {
            source_id: this.sourceId,
            source_type: this.providerType,
            library_id: libraryId,
            provider_id: `album_${album.ID}`,
            artist_id: artistIdMap.get(album.IDArtist),
            artist_name: album.AlbumArtist || 'Unknown Artist',
            title: album.Album,
            sort_title: album.SortAlbum || undefined,
            year: album.ReleaseYear || undefined,
          }
          const id = musicRepo.upsertMusicAlbum(totalityAlbum)
          albumIdMap.set(album.ID, id)
        }

        // Process Songs
        for (const song of songs) {
          if (this.musicScanCancelled) break

          const audioCodec = (song.AudioCodec || '').toLowerCase()
          
          // Parse Mood (MM5 usually uses semicolon or null)
          const moods = song.Mood ? song.Mood.split(';').map((m: string) => m.trim()).filter(Boolean) : []

          const totalityTrack: MusicTrack = {
            source_id: this.sourceId,
            source_type: this.providerType,
            library_id: libraryId,
            provider_id: `track_${song.ID}`,
            album_id: albumIdMap.get(song.IDAlbum),
            artist_id: artistIdMap.get(song.IDArtist),
            album_name: song.Album,
            artist_name: song.Artist,
            title: song.SongTitle,
            track_number: song.TrackNumber,
            disc_number: song.DiscNumber || 1,
            duration: song.SongLength,
            file_path: song.SongPath,
            file_size: song.FileLength,
            audio_codec: audioCodec,
            audio_bitrate: song.Bitrate ? song.Bitrate / 1000 : undefined, // MM5 usually in bps
            sample_rate: song.SampleRate,
            channels: song.Channels,
            is_lossless: isLosslessCodec(audioCodec),
            is_hi_res: isHiRes(song.SampleRate, 0, isLosslessCodec(audioCodec)),
            musicbrainz_id: song.MusicBrainzTrackID,
            mood: JSON.stringify(moods),
            added_at: song.DateAdded ? new Date(song.DateAdded * 1000).toISOString() : undefined
          }

          musicRepo.upsertMusicTrack(totalityTrack)

          // Add to tracks map for album stat calculation
          if (song.IDAlbum) {
            if (!albumTracksMap.has(song.IDAlbum)) albumTracksMap.set(song.IDAlbum, [])
            albumTracksMap.get(song.IDAlbum)!.push(totalityTrack)
          }
        }

        // 4. Update stats for artists and albums
        // Update album totals using calculateAlbumStats
        for (const [mm5AlbumId, tracks] of albumTracksMap.entries()) {
          const stats = calculateAlbumStats(tracks as any[])
          const totalityAlbumId = albumIdMap.get(mm5AlbumId)
          if (totalityAlbumId) {
            // Find the original album data from our local albums array to avoid another DB hit
            const originalAlbum = albums.find(a => a.ID === mm5AlbumId)
            if (originalAlbum) {
              musicRepo.upsertMusicAlbum({
                source_id: this.sourceId,
                source_type: this.providerType,
                library_id: libraryId,
                provider_id: `album_${mm5AlbumId}`,
                artist_id: artistIdMap.get(originalAlbum.IDArtist),
                artist_name: originalAlbum.AlbumArtist || 'Unknown Artist',
                title: originalAlbum.Album,
                sort_title: originalAlbum.SortAlbum || undefined,
                year: originalAlbum.ReleaseYear || undefined,
                track_count: tracks.length,
                total_duration: stats.totalDuration,
                total_size: stats.totalSize,
                best_audio_codec: stats.bestCodec,
                best_audio_bitrate: stats.bestBitrate,
                best_sample_rate: stats.bestSampleRate,
                best_bit_depth: stats.bestBitDepth,
                avg_audio_bitrate: stats.avgBitrate
              })
            }
          }
        }

        // Bulk update all artist counts for this source
        musicRepo.updateAllMusicArtistCounts(this.sourceId)

        result.success = true
      } finally {
        db.endBatch()
      }

      result.durationMs = Date.now() - startTime
      return result
    } catch (error: any) {
      getLoggingService().error('[MediaMonkeyProvider]', 'Scan failed:', error)
      result.errors.push(error.message)
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  async getItemMetadata(_itemId: string): Promise<MediaMetadata> {
    throw new Error('getItemMetadata not implemented for MediaMonkey (Music only)')
  }

  cancelMusicScan(): void {
    this.musicScanCancelled = true
  }
}
