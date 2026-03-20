import type { Database } from 'sql.js'
import { getCredentialEncryptionService } from '../../CredentialEncryptionService'

type SaveCallback = () => Promise<void>

export class ConfigRepository {
  constructor(
    private getDb: () => Database | null,
    private save: SaveCallback
  ) {}

  private get db(): Database {
    const db = this.getDb()
    if (!db) throw new Error('Database not initialized')
    return db
  }

  /**
   * Get a setting by key
   * Sensitive settings are automatically decrypted
   */
  getSetting(key: string): string | null {
    const result = this.db.exec('SELECT value FROM settings WHERE key = ?', [key])
    if (!result.length) return null

    const value = (result[0].values[0]?.[0] as string) || null
    if (!value) return null

    // Decrypt sensitive settings
    const encryption = getCredentialEncryptionService()
    return encryption.decryptSetting(key, value)
  }

  /**
   * Set a setting
   * Sensitive settings are automatically encrypted
   */
  async setSetting(key: string, value: string): Promise<void> {
    // Encrypt sensitive settings
    const encryption = getCredentialEncryptionService()
    const valueToStore = encryption.encryptSetting(key, value)

    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, valueToStore]
    )

    await this.save()
  }

  /**
   * Get all settings
   * Sensitive settings are automatically decrypted
   */
  getAllSettings(): Record<string, string> {
    const result = this.db.exec('SELECT key, value FROM settings')
    if (!result.length) return {}

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    result[0].values.forEach((row) => {
      const key = row[0] as string
      const value = row[1] as string
      // Decrypt sensitive settings
      settings[key] = encryption.decryptSetting(key, value)
    })

    return settings
  }

  /**
   * Get settings by prefix (batch retrieval for efficiency)
   * e.g., getSettingsByPrefix('quality_') returns all quality-related settings
   */
  getSettingsByPrefix(prefix: string): Record<string, string> {
    const result = this.db.exec(
      'SELECT key, value FROM settings WHERE key LIKE ?',
      [prefix + '%']
    )
    if (!result.length) return {}

    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}

    result[0].values.forEach((row) => {
      const key = row[0] as string
      const value = row[1] as string
      // Decrypt sensitive settings
      settings[key] = encryption.decryptSetting(key, value)
    })

    return settings
  }
}
