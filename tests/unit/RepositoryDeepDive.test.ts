import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('Repository Deep Dive (No Mocks)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('MediaRepository Coverage', () => {
    it('should exercise all CRUD and filter paths', async () => {
      const mediaRepo = db.media
      const sourceRepo = db.sources

      // 1. Setup Source
      await sourceRepo.upsertSource({ 
        source_id: 's1', 
        source_type: 'local',
        display_name: 'S1', 
        connection_config: '{}',
        is_enabled: 1 
      })

      // 2. Insert Items
      const id1 = await mediaRepo.upsertItem({ source_id: 's1', plex_id: 'p1', title: 'Movie 1', type: 'movie', file_path: '/path1', resolution: '1080p', file_size: 100, duration: 100, width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 100, audio_codec: 'aac', audio_channels: 2, audio_bitrate: 128 } as any)
      const id2 = await mediaRepo.upsertItem({ source_id: 's1', plex_id: 'p2', title: 'Show 1', type: 'episode', series_title: 'Show 1', file_path: '/path2', resolution: '720p', file_size: 100, duration: 100, width: 1280, height: 720, video_codec: 'h264', video_bitrate: 100, audio_codec: 'aac', audio_channels: 2, audio_bitrate: 128 } as any)

      // 3. Query filters
      expect((await mediaRepo.getItems({ type: 'movie' })).length).toBe(1)
      expect((await mediaRepo.getItems({ sourceId: 's1' })).length).toBe(2)
      expect(await mediaRepo.getItemByProviderId('p1', 's1')).toBeDefined()

      // 4. Versions
      await mediaRepo.syncItemVersions(id1, [{ version_source: 'primary', file_path: '/path1', resolution: '1080p', file_size: 100, duration: 100, width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 100, audio_codec: 'aac', audio_channels: 2, audio_bitrate: 128, is_best: 1 }])
      const versions = await mediaRepo.getItemVersions(id1)
      expect(versions.length).toBe(1)

      // 5. Cleanup
      await mediaRepo.deleteItem(id1)
      expect(await mediaRepo.getItem(id1)).toBeNull()
    })
  })

  describe('StatsRepository Coverage', () => {
    it('should provide accurate dashboard statistics', async () => {
      const statsRepo = db.stats
      const mediaRepo = db.media
      
      // Setup Source and Library Scan (essential for joins)
      await db.sources.upsertSource({ 
        source_id: 's1', 
        source_type: 'local',
        display_name: 'S1', 
        connection_config: '{}',
        is_enabled: 1 
      })
      await db.sources.updateLibraryScanStats('s1', 'movies', 1) // Creates library_scans entry

      // Insert item needing upgrade
      const id = await mediaRepo.upsertItem({ source_id: 's1', library_id: 'movies', plex_id: 'p1', title: 'Low Qual', type: 'movie', file_path: '/p', resolution: 'SD', file_size: 100, duration: 100, width: 640, height: 480, video_codec: 'h264', video_bitrate: 100, audio_codec: 'aac', audio_channels: 2, audio_bitrate: 128 } as any)
      await mediaRepo.upsertQualityScore({ media_item_id: id, needs_upgrade: 1, overall_score: 40, quality_tier: 'SD', tier_quality: 'LOW', tier_score: 0, bitrate_tier_score: 0, audio_tier_score: 10, is_low_quality: 1 } as any)

      const stats = await statsRepo.getLibraryStats()
      expect(stats.needsUpgradeCount).toBe(1)
      
      const dashboard = await statsRepo.getDashboardSummary()
      expect(dashboard.movieUpgrades.length).toBe(1)
    })
  })
})
