import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '@main/database/DatabaseMigration'
import { cleanupTestDb, setupTestDb } from '@tests/TestUtils'
import type { MediaItem, MusicQualityScore, QualityScore, SeriesCompleteness } from '@main/types/database'
import { QualityScoreSchema } from '@main/validation/schemas'

describe('evidence-based score persistence', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => cleanupTestDb())

  it('accepts nullable numeric evidence and rejects an unknown provenance value', () => {
    const score = {
      media_item_id: 1,
      overall_score: null,
      needs_upgrade: false,
      quality_tier: '1080p',
      tier_score: null,
      efficiency_score: null,
      storage_debt_bytes: null,
      evidence_status: 'insufficient',
      confidence: 'none',
      savings_basis: 'insufficient_data',
    }

    expect(QualityScoreSchema.safeParse(score).success).toBe(true)
    expect(QualityScoreSchema.safeParse({ ...score, confidence: 'certain' }).success).toBe(false)
  })

  it('round-trips a media score whose numeric evidence is insufficient', async () => {
    const mediaItemId = await db.media.upsertItem({
      source_id: 'evidence-source',
      source_type: 'local',
      library_id: 'evidence-library',
      plex_id: 'evidence-media',
      title: 'Evidence Movie',
      type: 'movie',
      file_path: '/media/evidence.mkv',
      resolution: '1080p',
    } as MediaItem)

    await db.media.upsertQualityScore({
      media_item_id: mediaItemId,
      quality_tier: '1080p',
      tier_quality: 'MEDIUM',
      tier_score: null,
      bitrate_tier_score: null,
      audio_tier_score: null,
      overall_score: null,
      resolution_score: null,
      bitrate_score: null,
      audio_score: null,
      efficiency_score: null,
      storage_debt_bytes: null,
      is_low_quality: false,
      needs_upgrade: false,
      issues: '[]',
      evidence_status: 'insufficient',
      confidence: 'none',
      savings_basis: 'insufficient_data',
    } satisfies QualityScore)

    await expect(db.media.getQualityScoreByMediaId(mediaItemId)).resolves.toMatchObject({
      media_item_id: mediaItemId,
      tier_score: null,
      storage_debt_bytes: null,
      evidence_status: 'insufficient',
      confidence: 'none',
      savings_basis: 'insufficient_data',
    })
  })

  it('round-trips music evidence metadata without coercing a zero saving', async () => {
    const artistId = await db.music.upsertArtist({
      source_id: 'evidence-source',
      source_type: 'local',
      provider_id: 'evidence-artist',
      name: 'Evidence Artist',
    })
    const albumId = await db.music.upsertAlbum({
      source_id: 'evidence-source',
      source_type: 'local',
      provider_id: 'evidence-album',
      artist_id: artistId,
      artist_name: 'Evidence Artist',
      title: 'Evidence Album',
    })

    await db.music.upsertQualityScore({
      album_id: albumId,
      quality_tier: 'LOSSLESS',
      tier_quality: 'HIGH',
      tier_score: 0,
      codec_score: null,
      bitrate_score: null,
      efficiency_score: null,
      storage_debt_bytes: null,
      needs_upgrade: false,
      issues: '[]',
      evidence_status: 'estimated',
      confidence: 'low',
      savings_basis: 'audio_transcode_model',
    } satisfies MusicQualityScore)

    await expect(db.music.getQualityScore(albumId)).resolves.toMatchObject({
      album_id: albumId,
      tier_score: 0,
      codec_score: null,
      storage_debt_bytes: null,
      evidence_status: 'estimated',
      confidence: 'low',
      savings_basis: 'audio_transcode_model',
    })
  })

  it('round-trips aggregate series evidence metadata', async () => {
    await db.tvShows.upsertCompleteness({
      series_title: 'Evidence Series',
      source_id: 'evidence-source',
      library_id: 'evidence-library',
      total_seasons: 1,
      total_episodes: 8,
      owned_seasons: 1,
      owned_episodes: 8,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: 100,
      efficiency_score: null,
      storage_debt_bytes: null,
      evidence_status: 'estimated',
      confidence: 'medium',
      savings_basis: 'video_sample_encode',
    } satisfies SeriesCompleteness)

    await expect(db.tvShows.getCompletenessByTitle('Evidence Series', 'evidence-source', 'evidence-library')).resolves.toMatchObject({
      efficiency_score: null,
      storage_debt_bytes: null,
      evidence_status: 'estimated',
      confidence: 'medium',
      savings_basis: 'video_sample_encode',
    })
  })

  it('marks legacy zero values as insufficient without changing those values', async () => {
    const mediaItemId = await db.media.upsertItem({
      source_id: 'legacy-source',
      source_type: 'local',
      library_id: 'legacy-library',
      plex_id: 'legacy-media',
      title: 'Legacy Movie',
      type: 'movie',
      file_path: '/media/legacy.mkv',
      resolution: '1080p',
    } as MediaItem)

    await db.db.execute('DROP TABLE quality_scores')
    await db.db.execute(`CREATE TABLE quality_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_item_id INTEGER NOT NULL UNIQUE,
      quality_tier TEXT NOT NULL DEFAULT 'SD',
      tier_quality TEXT NOT NULL DEFAULT 'MEDIUM',
      tier_score INTEGER NOT NULL,
      bitrate_tier_score INTEGER NOT NULL,
      audio_tier_score INTEGER NOT NULL,
      overall_score INTEGER NOT NULL,
      resolution_score INTEGER NOT NULL,
      bitrate_score INTEGER NOT NULL,
      audio_score INTEGER NOT NULL,
      efficiency_score INTEGER,
      storage_debt_bytes INTEGER,
      is_low_quality INTEGER NOT NULL,
      needs_upgrade INTEGER NOT NULL,
      issues TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
    await db.db.execute({
      sql: `INSERT INTO quality_scores (
        media_item_id, tier_score, bitrate_tier_score, audio_tier_score,
        overall_score, resolution_score, bitrate_score, audio_score,
        efficiency_score, storage_debt_bytes, is_low_quality, needs_upgrade,
        issues, created_at, updated_at
      ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '[]', datetime('now'), datetime('now'))`,
      args: [mediaItemId],
    })

    await runMigrations(db.db)

    await expect(db.db.execute({
      sql: 'SELECT tier_score, storage_debt_bytes, evidence_status, confidence, savings_basis FROM quality_scores WHERE media_item_id = ?',
      args: [mediaItemId],
    })).resolves.toMatchObject({
      rows: [{
        tier_score: 0,
        storage_debt_bytes: 0,
        evidence_status: 'insufficient',
        confidence: 'none',
        savings_basis: 'insufficient_data',
      }],
    })

    await expect(db.db.execute({
      sql: 'UPDATE quality_scores SET tier_score = NULL, storage_debt_bytes = NULL WHERE media_item_id = ?',
      args: [mediaItemId],
    })).resolves.toBeDefined()

    await expect(db.db.execute({
      sql: 'SELECT tier_score, storage_debt_bytes, evidence_status, confidence, savings_basis FROM quality_scores WHERE media_item_id = ?',
      args: [mediaItemId],
    })).resolves.toMatchObject({
      rows: [{
        tier_score: null,
        storage_debt_bytes: null,
      }],
    })
  })

  it('does not relabel an explicitly measured zero as legacy insufficient data', async () => {
    await db.tvShows.upsertCompleteness({
      series_title: 'Measured Zero Series',
      source_id: 'measured-source',
      library_id: 'measured-library',
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: 100,
      efficiency_score: 0,
      storage_debt_bytes: 0,
      evidence_status: 'measured',
      confidence: 'high',
      savings_basis: 'video_sample_encode',
    } satisfies SeriesCompleteness)

    await runMigrations(db.db)

    await expect(db.tvShows.getCompletenessByTitle('Measured Zero Series', 'measured-source', 'measured-library')).resolves.toMatchObject({
      efficiency_score: 0,
      storage_debt_bytes: 0,
      evidence_status: 'measured',
      confidence: 'high',
      savings_basis: 'video_sample_encode',
    })
  })
})
