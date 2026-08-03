import type { Client } from '@libsql/client'
import { normalizeTitleForMatching } from '@main/services/metadata/TitleMatching'

export type IdentityEntityType = 'movie' | 'series' | 'artist' | 'album'

export interface IdentityInput {
  entityType: IdentityEntityType
  entityId: number
  provider: string
  externalId: string
  locked?: boolean
  lockSource?: string
}

export class IdentityRepository {
  constructor(private readonly db: Client) {}

  async upsertIdentity(input: IdentityInput): Promise<void> {
    await this.db.execute({
      sql: `INSERT INTO media_identities (entity_type, entity_id, provider, external_id, is_locked, lock_source)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id, provider, external_id) DO UPDATE SET
              is_locked = CASE WHEN excluded.is_locked = 1 THEN 1 ELSE media_identities.is_locked END,
              lock_source = COALESCE(excluded.lock_source, media_identities.lock_source),
              updated_at = datetime('now')`,
      args: [input.entityType, input.entityId, input.provider, input.externalId, input.locked ? 1 : 0, input.lockSource || null]
    })
  }

  async getIdentities(entityType: IdentityEntityType, entityId: number): Promise<any[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM media_identities WHERE entity_type = ? AND entity_id = ? ORDER BY provider, external_id', args: [entityType, entityId] })
    return result.rows.map(row => ({ ...row, entityType: row.entity_type, entityId: row.entity_id, externalId: row.external_id, locked: row.is_locked }))
  }

  async addAlias(input: { entityType: IdentityEntityType; entityId: number; alias: string; provider?: string }): Promise<void> {
    const alias = input.alias.trim()
    if (!alias) return
    await this.db.execute({
      sql: `INSERT INTO media_aliases (entity_type, entity_id, alias, normalized_alias, provider)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id, normalized_alias) DO UPDATE SET alias = excluded.alias, provider = COALESCE(excluded.provider, media_aliases.provider)`,
      args: [input.entityType, input.entityId, alias, normalizeTitleForMatching(alias), input.provider || null]
    })
  }

  async getAliases(entityType: IdentityEntityType, entityId: number): Promise<any[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM media_aliases WHERE entity_type = ? AND entity_id = ? ORDER BY alias', args: [entityType, entityId] })
    return result.rows.map(row => ({ ...row, entityType: row.entity_type, entityId: row.entity_id, normalizedAlias: row.normalized_alias }))
  }

  async isLocked(entityType: IdentityEntityType, entityId: number): Promise<boolean> {
    const result = await this.db.execute({ sql: 'SELECT 1 FROM media_identities WHERE entity_type = ? AND entity_id = ? AND is_locked = 1 LIMIT 1', args: [entityType, entityId] })
    return result.rows.length > 0
  }
}
