import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { eq, like, sql } from 'drizzle-orm'
import { getCredentialEncryptionService } from '@main/services/CredentialEncryptionService'

export class ConfigRepository {
  constructor(
    private drizzle: LibSQLDatabase<typeof schema>
  ) {}

  async getSetting(key: string): Promise<string | null> {
    const row = await this.drizzle.select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .get()
    
    if (!row) return null

    const encryption = getCredentialEncryptionService()
    if (encryption.isSensitiveSetting(key)) {
      return encryption.decryptSetting(key, row.value)
    }
    return row.value
  }

  async setSetting(key: string, value: string): Promise<void> {
    const encryption = getCredentialEncryptionService()
    let storedValue = value
    if (encryption.isSensitiveSetting(key)) {
      storedValue = encryption.encryptSetting(key, value)
    }

    await this.drizzle.insert(schema.settings)
      .values({ key, value: storedValue, updatedAt: sql`(datetime('now'))` })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: storedValue, updatedAt: sql`(datetime('now'))` }
      })
  }

  async deleteSetting(key: string): Promise<void> {
    await this.drizzle.delete(schema.settings)
      .where(eq(schema.settings.key, key))
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const rows = await this.drizzle.select().from(schema.settings).all()
    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }
    return settings
  }

  async getSettingsByPrefix(prefix: string): Promise<Record<string, string>> {
    const rows = await this.drizzle.select()
      .from(schema.settings)
      .where(like(schema.settings.key, `${prefix}%`))
      .all()
    
    const encryption = getCredentialEncryptionService()
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = encryption.decryptSetting(row.key, row.value)
    }
    return settings
  }

  async setPin(pin: string): Promise<void> {
    const { createHash } = await import('node:crypto')
    const hashed = createHash('sha256').update(pin).digest('hex')
    await this.setSetting('app_pin_hash', hashed)
  }

  async verifyPin(pin: string): Promise<boolean> {
    const stored = await this.getSetting('app_pin_hash')
    if (!stored) return true // No PIN set
    const { createHash } = await import('node:crypto')
    const hashed = createHash('sha256').update(pin).digest('hex')
    return hashed === stored
  }

  async hasPin(): Promise<boolean> {
    return !!(await this.getSetting('app_pin_hash'))
  }
}
