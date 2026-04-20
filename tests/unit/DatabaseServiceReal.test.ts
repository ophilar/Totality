import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

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

  it('should persist settings', () => {
    db.setSetting('test_theme', 'dark')
    expect(db.getSetting('test_theme')).toBe('dark')
  })

  it('should run multiple operations in a batch (manual transaction)', () => {
    // We use manual transaction here since we removed internal startBatch from provider
    // but the service still supports it for callers that need it.
    db.db.exec('BEGIN')
    db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
    db.sources.upsertSource({ source_id: 's2', source_type: 'local', display_name: 'S2', connection_config: '{}', is_enabled: 1 })
    db.db.exec('COMMIT')

    expect(db.sources.getSources()).toHaveLength(2)
  })
})
