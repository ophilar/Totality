import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigRepository } from '../../src/main/database/repositories/ConfigRepository'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('ConfigRepository (Real DB)', () => {
  let repo: ConfigRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = new ConfigRepository(db.db)
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should set and get a value', () => {
    repo.setSetting('test_key', 'test_value')
    expect(repo.getSetting('test_key')).toBe('test_value')
  })

  it('should return null for non-existent key', () => {
    expect(repo.getSetting('missing')).toBeNull()
  })

  it('should update an existing value', () => {
    repo.setSetting('key', 'v1')
    repo.setSetting('key', 'v2')
    expect(repo.getSetting('key')).toBe('v2')
  })

  it('should delete a value', () => {
    repo.setSetting('key', 'val')
    repo.deleteSetting('key')
    expect(repo.getSetting('key')).toBeNull()
  })

  it('should get all settings as a map', () => {
    repo.setSetting('a', '1')
    repo.setSetting('b', '2')
    const all = repo.getAllSettings()
    expect(all['a']).toBe('1')
    expect(all['b']).toBe('2')
  })
})
