import type { Database } from 'better-sqlite3'
import { getCredentialEncryptionService } from '../../services/CredentialEncryptionService'

export class ConfigRepository {
  constructor(private db: Database) {}

  getSetting(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const row = stmt.get(key) as { value: string } | undefined
    if (!row) return null

    const sensitiveKeys = ['plex_token', 'tmdb_api_key', 'musicbrainz_api_token', 'gemini_api_key']
    if (sensitiveKeys.includes(key)) {
      const encryption = getCredentialEncryptionService()
      return encryption.decryptSetting(key, row.value)
    }
    return row.value
  }

  setSetting(key: string, value: string): void {
    const sensitiveKeys = ['plex_token', 'tmdb_api_key', 'musicbrainz_api_token', 'gemini_api_key']
    let storedValue = value
    if (sensitiveKeys.includes(key)) {
      const encryption = getCredentialEncryptionService()
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
}
