import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigRepository } from '@main/database/repositories/ConfigRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('ConfigRepository (Real DB)', () => {
  let repo: ConfigRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.config
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should set and get a value', async () => {
    await repo.setSetting('test_key', 'test_value')
    expect(await repo.getSetting('test_key')).toBe('test_value')
  })

  it('should return null for non-existent key', async () => {
    expect(await repo.getSetting('missing')).toBeNull()
  })

  it('should update an existing value', async () => {
    await repo.setSetting('key', 'v1')
    await repo.setSetting('key', 'v2')
    expect(await repo.getSetting('key')).toBe('v2')
  })

  it('should delete a value', async () => {
    await repo.setSetting('key', 'val')
    await repo.deleteSetting('key')
    expect(await repo.getSetting('key')).toBeNull()
  })

  it('should get all settings as a map', async () => {
    await repo.setSetting('a', '1')
    await repo.setSetting('b', '2')
    const all = await repo.getAllSettings()
    expect(all['a']).toBe('1')
    expect(all['b']).toBe('2')
  })
})



