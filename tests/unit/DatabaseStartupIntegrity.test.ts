import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BetterSQLiteService, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import * as MigrationModule from '@main/database/DatabaseMigration'

// Mock migrations
vi.mock('../../src/main/database/DatabaseMigration', () => ({
  runMigrations: vi.fn()
}))

describe('BetterSQLiteService Startup Integrity', () => {
  let testDbPath: string

  beforeEach(() => {
    resetBetterSQLiteServiceForTesting()
    testDbPath = path.join(process.cwd(), 'tests', 'tmp', `startup-test-${Math.random().toString(36).substring(7)}.db`)
    if (!fs.existsSync(path.dirname(testDbPath))) fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
    vi.mocked(app.isReady).mockReturnValue(true)
    vi.mocked(MigrationModule.runMigrations).mockClear()
  })

  afterEach(async () => {
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath)
      } catch (e) {
        // Ignore EBUSY
      }
    }
  })

  it('should throw descriptive error when accessed before initialize()', () => {
    const service = new BetterSQLiteService()
    expect(() => service.config).toThrow(/Database not initialized/)
  })

  it('should initialize when call initialize() with path', async () => {
    const service = new BetterSQLiteService()
    await service.initialize(testDbPath)
    expect(service.isInitialized).toBe(true)
    expect(service.config).toBeDefined()
    expect(MigrationModule.runMigrations).toHaveBeenCalled()
  })

  it('should allow access DURING migration phase', async () => {
    const service = new BetterSQLiteService()
    vi.mocked(MigrationModule.runMigrations).mockImplementation(async () => {
      // Should NOT throw anymore because we assign this.db before migrations
      expect(service.config).toBeDefined()
    })
    await service.initialize(testDbPath)
    expect(service.isInitialized).toBe(true)
  })
})
