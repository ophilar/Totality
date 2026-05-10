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
      file_path: '/path/1.mkv',
      file_size: 1000,
      duration: 120
    } as any)

    const movie2Id = await mediaRepo.upsertItem({
      source_id: 's1',
      library_id: 'l1',
      type: 'movie',
      title: 'Movie 2',
      plex_id: 'p2',
      file_path: '/path/2.mkv',
      file_size: 2000,
      duration: 150
    } as any)

    // Add quality scores
    await mediaRepo.upsertQualityScore({
      media_item_id: movie1Id,
      quality_tier: '1080p',
      tier_quality: 'HIGH',
      tier_score: 90,
      bitrate_tier_score: 90,
      audio_tier_score: 90,
      overall_score: 90,
      resolution_score: 90,
      bitrate_score: 90,
      audio_score: 90,
      efficiency_score: 95,
      storage_debt_bytes: 0,
      needs_upgrade: false,
      is_low_quality: false,
      issues: '[]'
    })

    await mediaRepo.upsertQualityScore({
      media_item_id: movie2Id,
      quality_tier: 'SD',
      tier_quality: 'LOW',
      tier_score: 40,
      bitrate_tier_score: 40,
      audio_tier_score: 40,
      overall_score: 40,
      resolution_score: 40,
      bitrate_score: 40,
      audio_score: 40,
      efficiency_score: 50,
      storage_debt_bytes: 1000,
      needs_upgrade: true,
      is_low_quality: true,
      issues: '[]'
    })

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

    await mediaRepo.upsertItem({ source_id: 's1', library_id: 'l1', type: 'movie', title: 'M1', plex_id: 'p1', file_path: '/p1.mkv', file_size: 10, duration: 10 } as any)
    await mediaRepo.upsertItem({ source_id: 's2', library_id: 'l2', type: 'movie', title: 'M2', plex_id: 'p2', file_path: '/p2.mkv', file_size: 10, duration: 10 } as any)

    const statsS1 = await repo.getLibraryStats('s1')
    expect(statsS1.totalMovies).toBe(1)

    const statsS2 = await repo.getLibraryStats('s2')
    expect(statsS2.totalMovies).toBe(1)
  })

  it('should return correct aggregated source stats', async () => {
    // Setup sources
    await sourceRepo.upsertSource({
      source_id: 's1',
      source_type: 'local',
      display_name: 'Source 1',
      connection_config: '{}',
      is_enabled: 1
    })
    await sourceRepo.upsertSource({
      source_id: 's2',
      source_type: 'local',
      display_name: 'Source 2',
      connection_config: '{}',
      is_enabled: 0 // Disabled source
    })

    // Setup library scan for s1
    await db.db.execute("INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('s1', 'l1', 'Movies', 'movie', 1, 0, datetime('now'), datetime('now'))")

    // Add media items to s1
    await mediaRepo.upsertItem({
      source_id: 's1',
      library_id: 'l1',
      type: 'movie',
      title: 'Movie 1',
      plex_id: 'p1',
      file_path: '/path/1.mkv',
      file_size: 10,
      duration: 10
    } as any)

    const stats = await repo.getAggregatedSourceStats()
    
    expect(stats.totalSources).toBe(2) // Both s1 and s2
    expect(stats.enabledSources).toBe(1) // Only s1
    expect(stats.totalItems).toBe(1)
    expect(stats.bySource).toHaveLength(2)
    const s1Stats = stats.bySource.find(s => s.sourceId === 's1')
    expect(s1Stats?.itemCount).toBe(1)
    expect(s1Stats?.isEnabled).toBe(true)
  })

  describe('Music Statistics', () => {
    beforeEach(async () => {
      // Setup source and library for music
      await sourceRepo.upsertSource({ source_id: 'ms1', source_type: 'local', display_name: 'Music Source', connection_config: '{}', is_enabled: 1 })
      await db.db.execute("INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('ms1', 'ml1', 'Music', 'music', 1, 0, datetime('now'), datetime('now'))")
    })

    it('should return correct music library stats', async () => {
      await db.music.upsertArtist({ source_id: 'ms1', source_type: 'local', library_id: 'ml1', provider_id: 'art1', name: 'Artist 1' } as any)
      await db.music.upsertAlbum({ source_id: 'ms1', source_type: 'local', library_id: 'ml1', provider_id: 'alb1', artist_name: 'Artist 1', title: 'Album 1', total_size: 1000, avg_audio_bitrate: 320 } as any)
      await db.music.upsertTrack({ source_id: 'ms1', source_type: 'local', library_id: 'ml1', provider_id: 'tr1', artist_name: 'Artist 1', title: 'Track 1', audio_codec: 'flac' } as any)

      const stats = await repo.getMusicLibraryStats()
      expect(stats.totalArtists).toBe(1)
      expect(stats.totalAlbums).toBe(1)
      expect(stats.totalTracks).toBe(1)
      expect(stats.totalSize).toBe(1000)
    })

    it('should return music quality distribution', async () => {
      const albumId = await db.music.upsertAlbum({ source_id: 'ms1', source_type: 'local', library_id: 'ml1', provider_id: 'alb1', artist_name: 'Artist 1', title: 'Album 1' } as any)
      await db.music.upsertQualityScore({ album_id: albumId, quality_tier: 'LOSSLESS', tier_quality: 'HIGH', tier_score: 90, codec_score: 90, bitrate_score: 90, needs_upgrade: false, issues: '[]' })

      const dist = await repo.getMusicQualityDistribution()
      expect(dist.LOSSLESS).toBe(1)
      expect(dist.HI_RES).toBe(0)
    })
  })
})
