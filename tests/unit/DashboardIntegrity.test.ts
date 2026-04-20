import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StatsRepository } from '../../src/main/database/repositories/StatsRepository'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('Dashboard Integrity (Real DB)', () => {
  let db: any
  let statsRepo: StatsRepository

  beforeEach(async () => {
    db = await setupTestDb()
    statsRepo = new StatsRepository(db.db)
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const insertMediaItem = (id: number, title: string, sourceId = 's1', type = 'movie') => {
    db.db.prepare(`
      INSERT INTO media_items (id, source_id, plex_id, title, type, file_path, file_size, duration, resolution, width, height, video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate)
      VALUES (?, ?, ?, ?, ?, '/path', 0, 0, '1080p', 1920, 1080, 'h264', 0, 'aac', 2, 0)
    `).run(id, sourceId, `p${id}`, title, type)
  }

  const insertQualityScore = (mediaId: number, needsUpgrade = 0) => {
    db.db.prepare(`
      INSERT INTO quality_scores (media_item_id, overall_score, resolution_score, bitrate_score, audio_score, needs_upgrade)
      VALUES (?, 80, 80, 80, 80, ?)
    `).run(mediaId, needsUpgrade)
  }

  const setupSource = (sourceId: string) => {
    db.db.prepare('INSERT INTO media_sources (source_id, source_type, display_name) VALUES (?, ?, ?)')
      .run(sourceId, 'plex', 'Test Source')
  }

  it('should include items from enabled sources only', () => {
    setupSource('s1')
    insertMediaItem(1, 'Item 1', 's1')
    insertQualityScore(1, 1) // Needs upgrade

    setupSource('s2')
    db.db.prepare('UPDATE media_sources SET is_enabled = 0 WHERE source_id = ?').run('s2')
    insertMediaItem(2, 'Item 2', 's2')
    insertQualityScore(2, 1)

    const summary = statsRepo.getDashboardSummary()
    expect(summary.movieUpgrades).toHaveLength(1)
    expect(summary.movieUpgrades[0].title).toBe('Item 1')
  })

  it('should filter summary by sourceId', () => {
    setupSource('s1')
    insertMediaItem(1, 'Item 1', 's1')
    insertQualityScore(1, 1)

    setupSource('s2')
    insertMediaItem(2, 'Item 2', 's2')
    insertQualityScore(2, 1)

    const summary = statsRepo.getDashboardSummary('s1')
    expect(summary.movieUpgrades).toHaveLength(1)
    expect(summary.movieUpgrades[0].title).toBe('Item 1')
  })

  describe('Denormalized Stats', () => {
    it('should correctly count items by source', () => {
      setupSource('s1')
      insertMediaItem(100, 'M1', 's1')
      expect(statsRepo.getItemsCountBySource('s1')).toBe(1)
      expect(statsRepo.getItemsCountBySource('non-existent')).toBe(0)
    })
  })
})
