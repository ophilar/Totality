import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { ConfigRepository } from '../../src/main/database/repositories/ConfigRepository'
import { runMigrations } from '../../src/main/database/DatabaseMigration'

// Mock encryption service
vi.mock('../../src/main/services/CredentialEncryptionService', () => ({
  getCredentialEncryptionService: vi.fn(() => ({
    isSensitiveSetting: vi.fn((key: string) => key.includes('api_key')),
    encryptSetting: vi.fn((_key: string, val: string) => `enc_${val}`),
    decryptSetting: vi.fn((_key: string, val: string) => val.replace('enc_', '')),
  })),
}))

describe('ConfigRepository', () => {
  let db: Database.Database
  let repo: ConfigRepository

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    repo = new ConfigRepository(db)
  })

  it('should set and get a simple setting', () => {
    repo.setSetting('test_key', 'test_value')
    expect(repo.getSetting('test_key')).toBe('test_value')
  })

  it('should encrypt and decrypt sensitive settings', () => {
    repo.setSetting('tmdb_api_key', 'secret')
    // Verify it's encrypted in DB
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('tmdb_api_key') as any
    expect(row.value).toBe('enc_secret')
    // Verify it's decrypted on get
    expect(repo.getSetting('tmdb_api_key')).toBe('secret')
  })

  it('should list settings by prefix', () => {
    repo.setSetting('app_theme', 'dark')
    repo.setSetting('app_language', 'en')
    repo.setSetting('other_setting', '123')

    const appSettings = repo.getSettingsByPrefix('app_')
    expect(Object.keys(appSettings)).toHaveLength(2)
    expect(appSettings.app_theme).toBe('dark')
  })

  it('should delete a setting', () => {
    repo.setSetting('temp', 'value')
    repo.deleteSetting('temp')
    expect(repo.getSetting('temp')).toBeNull()
  })
})
