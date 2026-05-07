import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StatsRepository } from '@main/database/repositories/StatsRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('Dashboard Integrity (Real DB)', () => {
  let db: any
  let statsRepo: StatsRepository

  beforeEach(async () => {
    db = await setupTestDb()
    statsRepo = db.stats
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const insertMediaItem = async (id: number, title: string, sourceId = 's1', type = 'movie') => {
    await db.db.execute({
      sql: `INSERT INTO media_items (id, source_id, source_type, plex_id, title, type, file_path, file_size, duration, resolution, width, height, video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate, version_count, created_at, updated_at)
            VALUES (?, ?, 'plex', ?, ?, ?, '/path', 0, 0, '1080p', 1920, 1080, 'h264', 0, 'aac', 2, 0, 1, datetime('now'), datetime('now'))`,
      args: [id, sourceId, `p${id}`, title, type]
    })
  }

  const insertQualityScore = async (mediaId: number, needsUpgrade = 0) => {
    await db.db.execute({
      sql: `INSERT INTO quality_scores (media_item_id, quality_tier, tier_quality, tier_score, bitrate_tier_score, audio_tier_score, overall_score, resolution_score, bitrate_score, audio_score, needs_upgrade, is_low_quality, issues, created_at, updated_at)
            VALUES (?, '1080p', 'MEDIUM', 80, 80, 80, 80, 80, 80, 80, ?, 0, '[]', datetime('now'), datetime('now'))`,
      args: [mediaId, needsUpgrade]
    })
  }

  const setupSource = async (sourceId: string) => {
    await db.db.execute({
      sql: "INSERT INTO media_sources (source_id, source_type, display_name, connection_config, is_enabled, created_at, updated_at) VALUES (?, 'plex', 'Test Source', '{}', 1, datetime('now'), datetime('now'))",
      args: [sourceId]
    })
  }

  it('should include items from enabled sources only', async () => {
    await setupSource('s1')
    await insertMediaItem(1, 'Item 1', 's1')
    await insertQualityScore(1, 1) // Needs upgrade

    await setupSource('s2')
    await db.db.execute({ sql: 'UPDATE media_sources SET is_enabled = 0 WHERE source_id = ?', args: ['s2'] })
    await insertMediaItem(2, 'Item 2', 's2')
    await insertQualityScore(2, 1)

    const summary = await statsRepo.getDashboardSummary()
    expect(summary.movieUpgrades).toHaveLength(1)
    expect(summary.movieUpgrades[0].title).toBe('Item 1')
  })

  it('should filter summary by sourceId', async () => {
    await setupSource('s1')
    await insertMediaItem(1, 'Item 1', 's1')
    await insertQualityScore(1, 1)

    await setupSource('s2')
    await insertMediaItem(2, 'Item 2', 's2')
    await insertQualityScore(2, 1)

    const summary = await statsRepo.getDashboardSummary('s1')
    expect(summary.movieUpgrades).toHaveLength(1)
    expect(summary.movieUpgrades[0].title).toBe('Item 1')
  })

  describe('Denormalized Stats', () => {
    it('should correctly count items by source', async () => {
      await setupSource('s1')
      await insertMediaItem(100, 'M1', 's1')
      expect(await statsRepo.getItemsCountBySource('s1')).toBe(1)
      expect(await statsRepo.getItemsCountBySource('non-existent')).toBe(0)
    })
  })
})



