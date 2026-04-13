import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { BetterSQLiteService } from '../../src/main/database/BetterSQLiteService'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import { MediaRepository } from '../../src/main/database/repositories/MediaRepository'
import { SourceRepository } from '../../src/main/database/repositories/SourceRepository'

describe('Database Constraint Validation', () => {
  let db: DatabaseSync
  let service: BetterSQLiteService
  let mediaRepo: MediaRepository
  let sourceRepo: SourceRepository

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    
    // Create service and inject the in-memory DB
    service = new BetterSQLiteService()
    ;(service as any).db = db
    ;(service as any)._isInitialized = true
    
    // Inject repositories
    mediaRepo = new MediaRepository(db)
    sourceRepo = new SourceRepository(db)
    ;(service as any)._mediaRepo = mediaRepo
    ;(service as any)._sourceRepo = sourceRepo

    // Setup a source
    sourceRepo.upsertMediaSource({
      source_id: 'src-1',
      source_type: 'plex',
      display_name: 'Test Plex',
      connection_config: '{}',
      is_enabled: true,
    })
  })

  it('should successfully upsert a quality score with minimal data using the updated service', () => {
    // First, add a media item
    const mediaId = mediaRepo.upsertItem({
      source_id: 'src-1',
      source_type: 'plex',
      plex_id: 'item-1',
      title: 'Test Movie',
      type: 'movie',
      file_path: '/path/movie.mkv',
      file_size: 1000,
      duration: 3600,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate: 5000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 192,
    })

    // Upsert quality score with only basic fields
    // The service should provide defaults for the NOT NULL columns
    const scoreId = service.media.upsertQualityScore({
      media_item_id: mediaId,
      overall_score: 85,
      needs_upgrade: false
    })

    expect(scoreId).toBeGreaterThan(0)
    
    const savedScore = db.prepare('SELECT * FROM quality_scores WHERE id = ?').get(scoreId) as any
    expect(savedScore).toBeDefined()
    expect(savedScore.quality_tier).toBe('SD') // Default from service
    expect(savedScore.overall_score).toBe(85)
  })

  it('should successfully sync media item versions with full metadata', () => {
    const mediaId = mediaRepo.upsertItem({
      source_id: 'src-1',
      source_type: 'plex',
      plex_id: 'item-2',
      title: 'Test Movie 2',
      type: 'movie',
      file_path: '/path/movie2.mkv',
      file_size: 1000,
      duration: 3600,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate: 5000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 192,
    })

    const versions = [
      {
        version_source: 'plex_media_1',
        file_path: '/path/movie2.mkv',
        file_size: 1000,
        duration: 3600,
        resolution: '1080p',
        width: 1920,
        height: 1080,
        video_codec: 'h264',
        video_bitrate: 5000,
        audio_codec: 'aac',
        audio_channels: 2,
        audio_bitrate: 192,
        hdr_format: 'HDR10',
        color_bit_depth: 10,
        is_best: true
      }
    ]

    service.media.syncItemVersions(mediaId, versions)

    const savedVersion = db.prepare('SELECT * FROM media_item_versions WHERE media_item_id = ?').get(mediaId) as any
    expect(savedVersion).toBeDefined()
    expect(savedVersion.hdr_format).toBe('HDR10')
    expect(savedVersion.color_bit_depth).toBe(10)
    expect(savedVersion.is_best).toBe(1)
  })
})
