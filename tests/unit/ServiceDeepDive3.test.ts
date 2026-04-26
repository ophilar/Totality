
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BetterSQLiteService, resetBetterSQLiteServiceForTesting, getBetterSQLiteService } from '../../src/main/database/BetterSQLiteService'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import { WishlistCompletionService } from '../../src/main/services/WishlistCompletionService'
import { DeduplicationService } from '../../src/main/services/DeduplicationService'
import { MediaRepository } from '../../src/main/database/repositories/MediaRepository'
import { WishlistRepository } from '../../src/main/database/repositories/WishlistRepository'
import { DuplicateRepository } from '../../src/main/database/repositories/DuplicateRepository'
import * as fs from 'fs'
import * as path from 'path'

describe('Service Deep Dive 3 (No Mocks)', () => {
  const dbPath = path.join(__dirname, 'service-deep-dive-3.db')
  let wishlistService: WishlistCompletionService
  let dedupService: DeduplicationService
  let dbService: BetterSQLiteService

  beforeEach(() => {
    // Reset global singleton
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    
    // Actually, let's just initialize the singleton!
    const globalService = getBetterSQLiteService()
    // Trick the singleton to use our dbPath before initialization
    ;(globalService as any).dbPath = dbPath
    globalService.initialize()
    dbService = globalService
    
    wishlistService = new WishlistCompletionService()
    dedupService = new DeduplicationService()
    
    dbService.sources.upsertSource({ 
      source_id: 's1', 
      source_type: 'local', 
      display_name: 'S1', 
      connection_config: '{}',
      is_enabled: true 
    } as any)
  })

  afterEach(() => {
    if (dbService) dbService.close()
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  describe('WishlistCompletionService', () => {
    it('should complete missing items when added', async () => {
      // 1. Add wishlist item
      dbService.wishlist.add({
        title: 'Missing Movie',
        media_type: 'movie',
        tmdb_id: 'tmdb1',
        reason: 'missing',
        status: 'active'
      } as any)

      // 2. Add the actual movie
      dbService.media.upsertItem({
        title: 'Missing Movie', type: 'movie', source_id: 's1', file_path: 'f1', tmdb_id: 'tmdb1', plex_id: 'p1',
        file_size: 1, duration: 1, resolution: '1080p', width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)

      // 3. Check and complete
      await wishlistService.checkAndComplete()

      // 4. Verify completed
      const items = dbService.wishlist.getItems({ status: "active" })
      expect(items.length).toBe(0) // It was marked complete, so it's no longer active
    })
  })

  describe('DeduplicationService', () => {
    it('should detect duplicate movies', async () => {
      // Add two movies with the same TMDB ID
      dbService.media.upsertItem({
        title: 'Dup Movie', type: 'movie', source_id: 's1', file_path: 'f1', tmdb_id: 'tmdb2', plex_id: 'p100',
        file_size: 1, duration: 1, resolution: '1080p', width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)
      dbService.media.upsertItem({
        title: 'Dup Movie', type: 'movie', source_id: 's1', file_path: 'f2', tmdb_id: 'tmdb2', plex_id: 'p101',
        file_size: 1, duration: 1, resolution: '1080p', width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)

      const count = await dedupService.scanForDuplicates('s1')
      expect(count).toBe(1)
      
      const dups = dbService.duplicates.getPendingDuplicates()
      expect(dups.length).toBe(1)
      expect(dups[0].external_id).toBe('tmdb2')
    })

    it('should recommend the highest resolution', () => {
      const id1 = dbService.media.upsertItem({
        title: 'Movie', type: 'movie', source_id: 's1', file_path: 'f10', tmdb_id: 'tmdb3', resolution: '720p', plex_id: 'p102',
        file_size: 1, duration: 1, width: 1280, height: 720, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)
      const id2 = dbService.media.upsertItem({
        title: 'Movie', type: 'movie', source_id: 's1', file_path: 'f11', tmdb_id: 'tmdb3', resolution: '4K', plex_id: 'p103',
        file_size: 1, duration: 1, width: 3840, height: 2160, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)

      // Ensure setting is configured to prefer highest resolution
      dbService.config.setSetting('dup_policy_highest_res', 'true')

      const recommendation = dedupService.recommendRetention([id1, id2])
      expect(recommendation.keep).toBe(id2) // 4K
      expect(recommendation.discard).toContain(id1)
    })
  })
})
