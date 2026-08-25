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

export interface MediaIdentityRecord {
  entityType: IdentityEntityType
  entityId: number
  provider: string
  externalId: string
  locked: boolean
  lockSource?: string | null
}

export interface MediaAliasRecord {
  entityType: IdentityEntityType
  entityId: number
  alias: string
  normalizedAlias: string
  provider?: string | null
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

  async getIdentities(entityType: IdentityEntityType, entityId: number): Promise<MediaIdentityRecord[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM media_identities WHERE entity_type = ? AND entity_id = ? ORDER BY provider, external_id', args: [entityType, entityId] })
    return result.rows.map(row => ({
      entityType,
      entityId,
      provider: String(row.provider),
      externalId: String(row.external_id),
      locked: Boolean(row.is_locked),
      lockSource: row.lock_source == null ? null : String(row.lock_source),
    }))
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

  async batchAddAliases(inputs: { entityType: IdentityEntityType; entityId: number; alias: string; provider?: string }[]): Promise<void> {
    const statements = []
    for (const input of inputs) {
      const alias = input.alias.trim()
      if (!alias) continue
      statements.push({
        sql: `INSERT INTO media_aliases (entity_type, entity_id, alias, normalized_alias, provider)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(entity_type, entity_id, normalized_alias) DO UPDATE SET alias = excluded.alias, provider = COALESCE(excluded.provider, media_aliases.provider)`,
        args: [input.entityType, input.entityId, alias, normalizeTitleForMatching(alias), input.provider || null]
      })
    }

    if (statements.length === 0) return

    const CHUNK_SIZE = 500
    for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
      await this.db.batch(statements.slice(i, i + CHUNK_SIZE), 'write')
    }
  }

  async getAliases(entityType: IdentityEntityType, entityId: number): Promise<MediaAliasRecord[]> {
    const result = await this.db.execute({ sql: 'SELECT * FROM media_aliases WHERE entity_type = ? AND entity_id = ? ORDER BY alias', args: [entityType, entityId] })
    return result.rows.map(row => ({
      entityType,
      entityId,
      alias: String(row.alias),
      normalizedAlias: String(row.normalized_alias),
      provider: row.provider == null ? null : String(row.provider),
    }))
  }

  async isLocked(entityType: IdentityEntityType, entityId: number): Promise<boolean> {
    const result = await this.db.execute({ sql: 'SELECT 1 FROM media_identities WHERE entity_type = ? AND entity_id = ? AND is_locked = 1 LIMIT 1', args: [entityType, entityId] })
    return result.rows.length > 0
  }

  async getConflictingEntityIds(entityType: IdentityEntityType, entityId: number, identities: Array<{ provider: string; externalId: string }>): Promise<number[]> {
    if (identities.length === 0) return []
    const conflicts = new Set<number>()
    const tableName = entityType === 'series' ? 'series_completeness' : entityType === 'movie' ? 'media_items' : entityType === 'artist' ? 'music_artists' : 'music_albums'

    const chunkSize = 300
    for (let i = 0; i < identities.length; i += chunkSize) {
      const chunk = identities.slice(i, i + chunkSize)
      const whereClauses: string[] = []
      const args: Array<string | number> = [entityType, entityId ?? -1]

      for (const identity of chunk) {
        whereClauses.push('(mi.provider = ? AND mi.external_id = ?)')
        args.push(identity.provider, identity.externalId)
      }

      const result = await this.db.execute({
        sql: `SELECT mi.entity_id FROM media_identities mi
              JOIN ${tableName} t ON t.id = mi.entity_id
              WHERE mi.entity_type = ? AND mi.entity_id <> ? AND (${whereClauses.join(' OR ')})`,
        args
      })
      for (const row of result.rows) conflicts.add(Number(row.entity_id))
    }
    return [...conflicts]
  }

  async getBatchConflictingEntityIds(
    entityType: IdentityEntityType,
    items: Array<{ entityId: number; identities: Array<{ provider: string; externalId: string }> }>
  ): Promise<Map<number, number[]>> {
    const conflictMap = new Map<number, number[]>()
    if (items.length === 0) return conflictMap

    const tableName = entityType === 'series' ? 'series_completeness' : entityType === 'movie' ? 'media_items' : entityType === 'artist' ? 'music_artists' : 'music_albums'
    const lookupMap = new Map<string, number[]>()
    for (const item of items) {
      for (const id of item.identities) {
        const key = `${id.provider}:${id.externalId}`
        if (!lookupMap.has(key)) lookupMap.set(key, [])
        lookupMap.get(key)!.push(item.entityId)
      }
    }

    if (lookupMap.size === 0) return conflictMap

    const whereClauses: string[] = []
    const args: Array<string | number> = [entityType]
    for (const key of lookupMap.keys()) {
      const colonIdx = key.indexOf(':')
      const provider = key.slice(0, colonIdx)
      const externalId = key.slice(colonIdx + 1)
      whereClauses.push('(mi.provider = ? AND mi.external_id = ?)')
      args.push(provider, externalId)
    }

    const result = await this.db.execute({
      sql: `SELECT mi.entity_id, mi.provider, mi.external_id
            FROM media_identities mi
            JOIN ${tableName} t ON t.id = mi.entity_id
            WHERE mi.entity_type = ? AND (${whereClauses.join(' OR ')})`,
      args
    })

    for (const row of result.rows) {
      const entityId = Number(row.entity_id)
      const provider = String(row.provider)
      const externalId = String(row.external_id)
      const key = `${provider}:${externalId}`
      const queryingEntities = lookupMap.get(key) || []

      for (const qId of queryingEntities) {
        if (qId !== entityId) {
          if (!conflictMap.has(qId)) conflictMap.set(qId, [])
          const list = conflictMap.get(qId)!
          if (!list.includes(entityId)) list.push(entityId)
        }
      }
    }

    return conflictMap
  }
}
