import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('Repository Deep Dive (No Mocks)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('MediaRepository Coverage', () => {
    it('should exercise all CRUD and filter paths', () => {
      const mediaRepo = db.media
      const sourceRepo = db.sources

      // 1. Setup Source
      sourceRepo.upsertSource({ 
        source_id: 's1', 
        source_type: 'local',
        display_name: 'S1', 
        connection_config: '{}',
        is_enabled: 1 
      })

      // 2. Insert Items
      const id1 = mediaRepo.upsertItem({ source_id: 's1', plex_id: 'p1', title: 'Movie 1', type: 'movie', file_path: '/path1', resolution: '1080p' } as any)
      const id2 = mediaRepo.upsertItem({ source_id: 's1', plex_id: 'p2', title: 'Show 1', type: 'episode', series_title: 'Show 1', file_path: '/path2', resolution: '720p' } as any)

      // 3. Query filters
      expect(mediaRepo.getItems({ type: 'movie' }).length).toBe(1)
      expect(mediaRepo.getItems({ sourceId: 's1' }).length).toBe(2)
      expect(mediaRepo.getItemByProviderId('p1', 's1')).toBeDefined()

      // 4. Versions
      mediaRepo.syncItemVersions(id1, [{ version_source: 'primary', file_path: '/path1', resolution: '1080p' }])
      const versions = mediaRepo.getItemVersions(id1)
      expect(versions.length).toBe(1)

      // 5. Cleanup
      mediaRepo.deleteItem(id1)
      expect(mediaRepo.getItem(id1)).toBeNull()
    })
  })

  describe('StatsRepository Coverage', () => {
    it('should provide accurate dashboard statistics', () => {
      const statsRepo = db.stats
      const mediaRepo = db.media
      
      // Setup Source and Library Scan (essential for joins)
      db.sources.upsertSource({ 
        source_id: 's1', 
        source_type: 'local',
        display_name: 'S1', 
        connection_config: '{}',
        is_enabled: 1 
      })
      db.sources.updateLibraryScanTime('s1', 'movies', 1) // Creates library_scans entry

      // Insert item needing upgrade
      const id = mediaRepo.upsertItem({ source_id: 's1', library_id: 'movies', plex_id: 'p1', title: 'Low Qual', type: 'movie', file_path: '/p', resolution: 'SD' } as any)
      mediaRepo.upsertQualityScore({ media_item_id: id, needs_upgrade: 1, overall_score: 40 })

      const stats = statsRepo.getLibraryStats()
      expect(stats.needsUpgradeCount).toBe(1)
      
      const dashboard = statsRepo.getDashboardSummary()
      expect(dashboard.movieUpgrades.length).toBe(1)
    })
  })
})
