import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StatsRepository } from '@main/database/repositories/StatsRepository'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { SourceRepository } from '@main/database/repositories/SourceRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('StatsRepository (Real DB)', () => {
  let repo: StatsRepository
  let mediaRepo: MediaRepository
  let sourceRepo: SourceRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.stats
    mediaRepo = db.media
    sourceRepo = db.sources
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should return correct library stats', async () => {
    // Setup sources
    await sourceRepo.upsertSource({
      source_id: 's1',
      source_type: 'local',
      display_name: 'Source 1',
      connection_config: '{}',
      is_enabled: 1
    })

    // Setup library scan (must be enabled)
    await db.db.execute("INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('s1', 'l1', 'Movies', 'movie', 1, 0, datetime('now'), datetime('now'))")

    // Add media items
    const movie1Id = await mediaRepo.upsertItem({
      source_id: 's1',
      library_id: 'l1',
      type: 'movie',
      title: 'Movie 1',
      plex_id: 'p1',
      file_path: '/path/1.mkv'
    } as any)

    const movie2Id = await mediaRepo.upsertItem({
      source_id: 's1',
      library_id: 'l1',
      type: 'movie',
      title: 'Movie 2',
      plex_id: 'p2',
      file_path: '/path/2.mkv'
    } as any)

    // Add quality scores
    await mediaRepo.upsertQualityScore({
      media_item_id: movie1Id,
      overall_score: 90,
      needs_upgrade: 0,
      is_low_quality: 0,
      efficiency_score: 95
    } as any)

    await mediaRepo.upsertQualityScore({
      media_item_id: movie2Id,
      overall_score: 40,
      needs_upgrade: 1,
      is_low_quality: 1,
      efficiency_score: 50
    } as any)

    const stats = await repo.getLibraryStats()
    expect(stats.totalMovies).toBe(2)
    expect(stats.needsUpgradeCount).toBe(1)
    expect(stats.lowQualityCount).toBe(1)
    expect(stats.averageQualityScore).toBe(65) // (90 + 40) / 2
  })

  it('should filter stats by source', async () => {
    await sourceRepo.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
    await sourceRepo.upsertSource({ source_id: 's2', source_type: 'local', display_name: 'S2', connection_config: '{}', is_enabled: 1 })
    
    await db.db.execute("INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('s1', 'l1', 'M1', 'movie', 1, 0, datetime('now'), datetime('now'))")
    await db.db.execute("INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('s2', 'l2', 'M2', 'movie', 1, 0, datetime('now'), datetime('now'))")

    await mediaRepo.upsertItem({ source_id: 's1', library_id: 'l1', type: 'movie', title: 'M1', plex_id: 'p1', file_path: '/p1.mkv' } as any)
    await mediaRepo.upsertItem({ source_id: 's2', library_id: 'l2', type: 'movie', title: 'M2', plex_id: 'p2', file_path: '/p2.mkv' } as any)

    const statsS1 = await repo.getLibraryStats('s1')
    expect(statsS1.totalMovies).toBe(1)

    const statsS2 = await repo.getLibraryStats('s2')
    expect(statsS2.totalMovies).toBe(1)
  })
})
