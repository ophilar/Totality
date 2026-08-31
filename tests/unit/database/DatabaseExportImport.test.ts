import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('Database Export/Import Transactional Integrity', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('exports and imports data atomically without data loss', async () => {
    await db.config.setSetting('test_key_1', 'value_1')
    await db.config.setSetting('test_key_2', 'value_2')

    const exported = await db.exportData()
    expect(exported.settings).toBeDefined()
    expect(exported.settings?.some((r) => r.key === 'test_key_1' && r.value === 'value_1')).toBe(true)

    await db.config.setSetting('test_key_1', 'overwritten')
    const result = await db.importData(exported)
    expect(result.imported).toBeGreaterThan(0)
    expect(result.errors).toBe(0)

    expect(await db.config.getSetting('test_key_1')).toBe('value_1')
  })

  it('rolls back completely if an import error occurs (all-or-nothing)', async () => {
    await db.config.setSetting('stable_key', 'initial_value')

    const invalidExportData = {
      _meta: [{ version: 1, exported_at: new Date().toISOString() }],
      settings: [
        { key: 'new_key_1', value: 'val1', updated_at: new Date().toISOString() }
      ],
      media_items: [
        // Malformed row that violates NOT NULL constraint (e.g. missing title and required fields)
        { plex_id: 'invalid-item', file_path: null }
      ]
    }

    await expect(db.importData(invalidExportData)).rejects.toThrow()

    // Verify transaction rollback - new_key_1 must NOT have been persisted
    expect(await db.config.getSetting('new_key_1')).toBeNull()
    expect(await db.config.getSetting('stable_key')).toBe('initial_value')
  })
})
