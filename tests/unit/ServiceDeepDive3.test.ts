
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BetterSQLiteService, resetBetterSQLiteServiceForTesting, getDatabase } from '@main/database/BetterSQLiteService'
import { runMigrations } from '@main/database/DatabaseMigration'
import { WishlistCompletionService } from '@main/services/WishlistCompletionService'
import { DeduplicationService } from '@main/services/DeduplicationService'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { WishlistRepository } from '@main/database/repositories/WishlistRepository'
import { DuplicateRepository } from '@main/database/repositories/DuplicateRepository'
import * as fs from 'fs'
import * as path from 'path'

import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('Service Deep Dive 3 (No Mocks)', () => {
  let wishlistService: WishlistCompletionService
  let dedupService: DeduplicationService
  let dbService: BetterSQLiteService

  beforeEach(async () => {
    dbService = await setupTestDb()
    
    wishlistService = new WishlistCompletionService()
    dedupService = new DeduplicationService()
    
    await dbService.sources.upsertSource({ 
      source_id: 's1', 
      source_type: 'local', 
      display_name: 'S1', 
      connection_config: '{}',
      is_enabled: true 
    } as any)
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('WishlistCompletionService', () => {
    it('should complete missing items when added', async () => {
      // 1. Add wishlist item
      await dbService.wishlist.add({
        title: 'Missing Movie',
        media_type: 'movie',
        tmdb_id: 'tmdb1',
        reason: 'missing',
        status: 'active'
      } as any)

      // 2. Add the actual movie
      await dbService.media.upsertItem({
        title: 'Missing Movie', type: 'movie', source_id: 's1', file_path: 'f1', tmdb_id: 'tmdb1', plex_id: 'p1',
        file_size: 1, duration: 1, resolution: '1080p', width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)

      // 3. Check and complete
      await wishlistService.checkAndComplete()

      // 4. Verify completed
      const items = await dbService.wishlist.getItems({ status: "active" })
      expect(items.length).toBe(0) // It was marked complete, so it's no longer active
    })
  })

  describe('DeduplicationService', () => {
    it('should detect duplicate movies', async () => {
      // Add two movies with the same TMDB ID
      await dbService.media.upsertItem({
        title: 'Dup Movie', type: 'movie', source_id: 's1', file_path: 'f1', tmdb_id: 'tmdb2', plex_id: 'p100',
        file_size: 1, duration: 1, resolution: '1080p', width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)
      await dbService.media.upsertItem({
        title: 'Dup Movie', type: 'movie', source_id: 's1', file_path: 'f2', tmdb_id: 'tmdb2', plex_id: 'p101',
        file_size: 1, duration: 1, resolution: '1080p', width: 1920, height: 1080, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)

      const count = await dedupService.scanForDuplicates('s1')
      expect(count).toBe(1)
      
      const dups = await dbService.duplicates.getPendingDuplicates()
      expect(dups.length).toBe(1)
      expect(dups[0].external_id).toBe('tmdb2')
    })

    it('should recommend the highest resolution', async () => {
      const id1 = await dbService.media.upsertItem({
        title: 'Movie', type: 'movie', source_id: 's1', file_path: 'f10', tmdb_id: 'tmdb3', resolution: '720p', plex_id: 'p102',
        file_size: 1, duration: 1, width: 1280, height: 720, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)
      const id2 = await dbService.media.upsertItem({
        title: 'Movie', type: 'movie', source_id: 's1', file_path: 'f11', tmdb_id: 'tmdb3', resolution: '4K', plex_id: 'p103',
        file_size: 1, duration: 1, width: 3840, height: 2160, video_codec: 'h264', video_bitrate: 1,
        audio_codec: 'aac', audio_channels: 2, audio_bitrate: 192, source_type: 'local'
      } as any)

      // Ensure setting is configured to prefer highest resolution
      await dbService.config.setSetting('dup_policy_highest_res', 'true')

      const recommendation = await dedupService.recommendRetention([id1, id2])
      expect(recommendation.keep).toBe(id2) // 4K
      expect(recommendation.discard).toContain(id1)
    })
  })
})



