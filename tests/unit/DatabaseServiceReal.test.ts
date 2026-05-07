import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('BetterSQLiteService Integration (Real DB)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should initialize with all repositories', () => {
    expect(db.media).toBeDefined()
    expect(db.sources).toBeDefined()
    expect(db.music).toBeDefined()
    expect(db.tvShows).toBeDefined()
    expect(db.stats).toBeDefined()
    expect(db.wishlist).toBeDefined()
  })

  it('should persist settings', async () => {
    await db.config.setSetting('test_theme', 'dark')
    expect(await db.config.getSetting('test_theme')).toBe('dark')
  })

  it('should run multiple operations in a batch (manual transaction)', async () => {
    // We use the service's beginBatch/endBatch which is async-safe
    await db.beginBatch()
    await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
    await db.sources.upsertSource({ source_id: 's2', source_type: 'local', display_name: 'S2', connection_config: '{}', is_enabled: 1 })
    await db.endBatch()

    expect(await db.sources.getSources()).toHaveLength(2)
  })
})



