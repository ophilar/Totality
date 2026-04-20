import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MediaRepository } from '../../src/main/database/repositories/MediaRepository'
import { SourceRepository } from '../../src/main/database/repositories/SourceRepository'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('Database Constraint Validation (Real DB)', () => {
  let mediaRepo: MediaRepository
  let sourceRepo: SourceRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    mediaRepo = db.media
    sourceRepo = db.sources

    // Setup a source
    sourceRepo.upsertSource({
      source_id: 'src-1',
      source_type: 'plex',
      display_name: 'Test Source',
      connection_config: '{}',
      is_enabled: 1,
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should successfully upsert a quality score with minimal data', () => {
    const mediaId = mediaRepo.upsertItem({
      source_id: 'src-1',
      source_type: 'plex',
      plex_id: 'p1',
      title: 'Movie 1',
      type: 'movie',
      file_path: '/path/1',
      resolution: '1080p',
    } as any)

    const score = {
      media_item_id: mediaId,
      quality_tier: '1080p',
      overall_score: 85,
      resolution_score: 90,
      bitrate_score: 80,
      audio_score: 85,
      needs_upgrade: 0,
    }

    const id = mediaRepo.upsertQualityScore(score)
    expect(id).toBeGreaterThan(0)

    const saved = mediaRepo.getQualityScoreByMediaId(mediaId)
    expect(saved).toBeDefined()
    expect(saved.overall_score).toBe(85)
  })

  it('should successfully sync media item versions with full metadata', () => {
    const mediaId = mediaRepo.upsertItem({
      source_id: 'src-1',
      plex_id: 'p2',
      title: 'Movie 2',
      type: 'movie',
      file_path: '/path/2',
      resolution: '4K',
    } as any)

    const versions = [
      {
        version_source: 'primary',
        file_path: '/path/2',
        file_size: 1000000,
        duration: 3600,
        resolution: '4K',
        width: 3840,
        height: 2160,
        video_codec: 'hevc',
        video_bitrate: 20000,
        audio_codec: 'aac',
        audio_channels: 6,
        audio_bitrate: 640,
        is_best: 1,
        hdr_format: 'HDR10',
        color_bit_depth: 10
      }
    ]

    mediaRepo.syncItemVersions(mediaId, versions)

    const savedVersion = db.db.prepare('SELECT * FROM media_item_versions WHERE media_item_id = ?').get(mediaId) as any
    expect(savedVersion).toBeDefined()
    expect(savedVersion.hdr_format).toBe('HDR10')
    expect(savedVersion.color_bit_depth).toBe(10)
    expect(savedVersion.is_best).toBe(1)
  })
})
