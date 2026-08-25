import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigRepository } from '@main/database/repositories/ConfigRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('ConfigRepository (Real DB)', () => {
  let repo: ConfigRepository
  let db: Awaited<ReturnType<typeof setupTestDb>>

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

  it('should verify legacy sha256 pin and upgrade it to pbkdf2', async () => {
    const crypto = await import('node:crypto')
    const pin = '1234'
    const legacyHash = crypto.createHash('sha256').update(pin).digest('hex')

    // Set legacy PIN hash directly
    await repo.setSetting('app_pin_hash', legacyHash)

    // Verify it works (should auto-upgrade)
    const result = await repo.verifyPin(pin)
    expect(result).toBe(true)

    // Check if it was upgraded
    const newHash = await repo.getSetting('app_pin_hash')
    expect(newHash).not.toBeNull()
    expect(newHash?.startsWith('pbkdf2$')).toBe(true)
  })

  it('should return false for incorrect legacy pin and not upgrade it', async () => {
    const crypto = await import('node:crypto')
    const pin = '1234'
    const legacyHash = crypto.createHash('sha256').update(pin).digest('hex')

    // Set legacy PIN hash directly
    await repo.setSetting('app_pin_hash', legacyHash)

    // Verify with wrong pin
    const result = await repo.verifyPin('wrong')
    expect(result).toBe(false)

    // Check it wasn't upgraded
    const currentHash = await repo.getSetting('app_pin_hash')
    expect(currentHash).toBe(legacyHash)
  })
})



