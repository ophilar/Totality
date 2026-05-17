import { eq, and, sql } from 'drizzle-orm'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

export interface MediaDuplicate {
  id?: number
  source_id: string
  external_id: string
  external_type: 'tmdb_movie' | 'tmdb_series' | 'musicbrainz_artist' | 'musicbrainz_album'
  media_item_ids: string // JSON array
  status: 'pending' | 'resolved' | 'ignored'
  resolution_strategy?: string
  resolved_at?: string
  created_at?: string
  updated_at?: string
}

export class DuplicateRepository extends BaseRepository<typeof schema.mediaItemDuplicates> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'media_item_duplicates', drizzle, schema.mediaItemDuplicates)
  }

  async getPendingDuplicates(sourceId?: string): Promise<MediaDuplicate[]> {
    const conditions = [eq(schema.mediaItemDuplicates.status, 'pending')]
    if (sourceId) conditions.push(eq(schema.mediaItemDuplicates.sourceId, sourceId))

    const rows = await this.drizzle.select()
      .from(schema.mediaItemDuplicates)
      .where(and(...conditions))
      .all()
    
    return this.mapDrizzleToDuplicate(rows)
  }

  async upsertDuplicate(dup: MediaDuplicate): Promise<void> {
    const now = new Date().toISOString()
    const data = {
      sourceId: dup.source_id,
      externalId: dup.external_id,
      externalType: dup.external_type,
      mediaItemIds: dup.media_item_ids,
      status: dup.status || 'pending',
    }

    await this.drizzle.insert(schema.mediaItemDuplicates)
      .values({ ...data, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.mediaItemDuplicates.sourceId, schema.mediaItemDuplicates.externalId, schema.mediaItemDuplicates.externalType],
        set: {
          ...data,
          status: sql`CASE WHEN status = 'resolved' THEN 'pending' ELSE status END`,
          updatedAt: now
        }
      })
  }

  async resolveDuplicate(id: number, strategy: string): Promise<void> {
    await this.drizzle.update(schema.mediaItemDuplicates)
      .set({
        status: 'resolved',
        resolutionStrategy: strategy,
        resolvedAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .where(eq(schema.mediaItemDuplicates.id, id))
  }

  async getById(id: number): Promise<MediaDuplicate | null> {
    const results = await this.drizzle.select().from(this.table).where(eq((this.table as any).id, id)).limit(1)
    return results[0] ? this.mapDrizzleToDuplicate([results[0]])[0] : null
  }

  private mapDrizzleToDuplicate(rows: any[]): MediaDuplicate[] {
    return rows.map(r => ({
      id: r.id,
      source_id: r.sourceId || r.source_id,
      external_id: r.externalId || r.external_id,
      external_type: (r.externalType || r.external_type) as any,
      media_item_ids: r.mediaItemIds || r.media_item_ids,
      status: r.status,
      resolution_strategy: r.resolutionStrategy || r.resolution_strategy || undefined,
      resolved_at: r.resolvedAt || r.resolved_at || undefined,
      created_at: r.createdAt || r.created_at,
      updated_at: r.updatedAt || r.updated_at
    }))
  }
}
