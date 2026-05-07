import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { SourceRepository } from '@main/database/repositories/SourceRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('Database Constraint Validation (Real DB)', () => {
  let mediaRepo: MediaRepository
  let sourceRepo: SourceRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    mediaRepo = db.media
    sourceRepo = db.sources

    // Setup a source
    await sourceRepo.upsertSource({
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

  it('should successfully upsert a quality score with minimal data', async () => {
    const mediaId = await mediaRepo.upsertItem({
      source_id: 'src-1',
      source_type: 'plex',
      plex_id: 'p1',
      title: 'Movie 1',
      type: 'movie',
      file_path: '/path/1',
      resolution: '1080p',
      file_size: 1000,
      duration: 100,
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate: 1000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate: 128
    } as any)

    const score: any = {
      media_item_id: mediaId,
      quality_tier: '1080p',
      tier_quality: 'MEDIUM',
      tier_score: 85,
      bitrate_tier_score: 80,
      audio_tier_score: 85,
      overall_score: 85,
      resolution_score: 90,
      bitrate_score: 80,
      audio_score: 85,
      needs_upgrade: 0,
      is_low_quality: 0
    }

    const id = await mediaRepo.upsertQualityScore(score)
    expect(id).toBeGreaterThan(0)

    const saved = await mediaRepo.getQualityScoreByMediaId(mediaId)
    expect(saved).toBeDefined()
    expect(saved?.overall_score).toBe(85)
  })

  it('should successfully sync media item versions with full metadata', async () => {
    const mediaId = await mediaRepo.upsertItem({
      source_id: 'src-1',
      plex_id: 'p2',
      title: 'Movie 2',
      type: 'movie',
      file_path: '/path/2',
      resolution: '4K',
      file_size: 2000,
      duration: 200,
      width: 3840,
      height: 2160,
      video_codec: 'hevc',
      video_bitrate: 5000,
      audio_codec: 'aac',
      audio_channels: 6,
      audio_bitrate: 640
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

    await mediaRepo.syncItemVersions(mediaId, versions as any)

    const savedVersion = (await db.db.execute({
        sql: 'SELECT * FROM media_item_versions WHERE media_item_id = ?',
        args: [mediaId]
    })).rows[0] as any
    expect(savedVersion).toBeDefined()
    expect(savedVersion.hdr_format).toBe('HDR10')
    expect(savedVersion.color_bit_depth).toBe(10)
    expect(savedVersion.is_best).toBe(1)
  })
})
