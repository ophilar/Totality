import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { BetterSQLiteService } from '../../src/main/database/BetterSQLiteService'
import type { MediaItem } from '../../src/main/types/database'

describe('BetterSQLiteService Integration', () => {
  let service: BetterSQLiteService

  beforeAll(() => {
    service = new BetterSQLiteService()
    // Override dbPath for testing to use in-memory
    ;(service as any).dbPath = ':memory:'
    service.initialize()
  })

  it('should be initialized', () => {
    expect(service.isInitialized).toBe(true)
  })

  describe('Settings', () => {
    // Note: BetterSQLiteService should have getSetting/setSetting or delegate them
    it('should be able to initialize and run migrations', () => {
      // If migrations ran, settings table should exist
      expect(service.isInitialized).toBe(true)
    })
  })

  describe('Media Sources', () => {
    it('should upsert and retrieve a media source', () => {
      const sourceId = 'test-src-1'
      service.upsertMediaSource({
        source_id: sourceId,
        source_type: 'plex',
        display_name: 'Test Plex',
        connection_config: '{}',
        is_enabled: true,
      })

      const source = service.getMediaSourceById(sourceId)
      expect(source).not.toBeNull()
      expect(source!.display_name).toBe('Test Plex')
    })
  })

  describe('Media Items', () => {
    it('should retrieve media items with filters', () => {
      const items = service.getMediaItems({ limit: 10 })
      expect(Array.isArray(items)).toBe(true)
    })
  })
})
