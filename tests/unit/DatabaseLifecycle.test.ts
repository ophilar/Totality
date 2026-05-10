import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BetterSQLiteService, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'

describe('Database Lifecycle (Initialization + Operations)', () => {
  let testDbPath: string
  let service: BetterSQLiteService

  beforeEach(() => {
    resetBetterSQLiteServiceForTesting()
    testDbPath = path.join(process.cwd(), 'tests', 'tmp', `db-lifecycle-${Math.random().toString(36).substring(7)}.db`)
    const dir = path.dirname(testDbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    
    // app is already mocked globally in tests/setup.ts
    vi.mocked(app.isReady).mockReturnValue(true)
    service = new BetterSQLiteService()
  })

  afterEach(async () => {
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath)
      } catch (e) {
        // Ignore EBUSY if file is locked
      }
    }
  })

  describe('Startup & Migrations', () => {
    it('should throw descriptive error when accessed before initialize()', () => {
      expect(() => service.config).toThrow(/Database not initialized/)
    })

    it('should initialize and apply real baseline schema', async () => {
      await service.initialize(testDbPath)
      expect(service.isInitialized).toBe(true)
      
      // Verify a repository is accessible and works (implies schema exists)
      const settings = await service.config.getAllSettings()
      expect(settings).toBeDefined()
    })

    it('should handle re-initialization gracefully', async () => {
      await service.initialize(testDbPath)
      await expect(service.initialize(testDbPath)).resolves.not.toThrow()
      expect(service.isInitialized).toBe(true)
    })
  })

  describe('Repository Integrity', () => {
    it('should have all expected repositories initialized', async () => {
      await service.initialize(testDbPath)
      expect(service.media).toBeDefined()
      expect(service.sources).toBeDefined()
      expect(service.music).toBeDefined()
      expect(service.tvShows).toBeDefined()
      expect(service.stats).toBeDefined()
      expect(service.wishlist).toBeDefined()
    })

    it('should perform real CRUD operations (Settings)', async () => {
      await service.initialize(testDbPath)
      await service.config.setSetting('test_key', 'test_value')
      expect(await service.config.getSetting('test_key')).toBe('test_value')
    })

    it('should support batch operations (Transactions)', async () => {
      await service.initialize(testDbPath)
      await service.beginBatch()
      await service.sources.upsertSource({ 
        source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 
      })
      await service.sources.upsertSource({ 
        source_id: 's2', source_type: 'local', display_name: 'S2', connection_config: '{}', is_enabled: 1 
      })
      await service.endBatch()

      const sources = await service.sources.getSources()
      expect(sources).toHaveLength(2)
    })
  })
})
