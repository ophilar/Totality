// @ts-nocheck
import type { DatabaseSync } from 'node:sqlite'
import { getCredentialEncryptionService } from '../../services/CredentialEncryptionService'

export class ConfigRepository {
  constructor(private db: DatabaseSync) {}

  getSetting(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get(key) as { value: string } | undefined
    if (!row) return null

    const encryption = getCredentialEncryptionService()
    if (encryption.isSensitiveSetting(key)) {
      return encryption.decryptSetting(key, row.value)
    }
    return row.value
  }

  setSetting(key: string, value: string): void {
    const encryption = getCredentialEncryptionService()
    let storedValue = value
    if (encryption.isSensitiveSetting(key)) {
      storedValue = encryption.encryptSetting(key, value)
    }

    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    stmt.run(key, storedValue)
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }

  getAllSettings(): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM settings')
    const rows = stmt.all() as Array<{ key: string; value: string }>
    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }
    return settings
  }

  getSettingsByPrefix(prefix: string): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM settings WHERE key LIKE ?')
    const rows = stmt.all(prefix + '%') as Array<{ key: string; value: string }>
    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }
    return settings
  }

  async setPin(pin: string): Promise<void> {
    const { hash } = await import('node:crypto')
    const hashed = hash('sha256', pin)
    this.setSetting('app_pin_hash', hashed)
  }

  async verifyPin(pin: string): Promise<boolean> {
    const stored = this.getSetting('app_pin_hash')
    if (!stored) return true // No PIN set
    const { hash } = await import('node:crypto')
    const hashed = hash('sha256', pin)
    return hashed === stored
  }

  hasPin(): boolean {
    return !!this.getSetting('app_pin_hash')
  }
}
