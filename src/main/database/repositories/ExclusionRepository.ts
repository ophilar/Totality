import { eq, and, desc, sql } from 'drizzle-orm'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

export interface Exclusion {
  id?: number
  exclusion_type: 'media_upgrade' | 'collection_movie' | 'series_episode' | 'artist_album' | 'cleanup_radar'
  reference_id?: number
  reference_key?: string
  parent_key?: string
  title?: string
  created_at?: string
}

export class ExclusionRepository extends BaseRepository<typeof schema.exclusions> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'exclusions', drizzle, schema.exclusions)
  }

  async isExcluded(type: string, referenceId?: number, referenceKey?: string): Promise<boolean> {
    const conditions = [eq(schema.exclusions.exclusionType, type)]
    if (referenceId != null) conditions.push(eq(schema.exclusions.referenceId, referenceId))
    else if (referenceKey) conditions.push(eq(schema.exclusions.referenceKey, referenceKey))
    else return false

    const row = await this.drizzle.select({ id: schema.exclusions.id })
      .from(schema.exclusions)
      .where(and(...conditions))
      .limit(1)
      .get()
    
    return !!row
  }

  async addExclusion(exclusion: Omit<Exclusion, 'id' | 'created_at'>): Promise<void> {
    await this.drizzle.insert(schema.exclusions)
      .values({
        exclusionType: exclusion.exclusion_type,
        referenceId: exclusion.reference_id ?? null,
        referenceKey: exclusion.reference_key ?? null,
        parentKey: exclusion.parent_key ?? null,
        title: exclusion.title ?? null,
      })
      .onConflictDoNothing()
  }

  async removeExclusion(type: string, referenceId?: number, referenceKey?: string): Promise<void> {
    const conditions = [eq(schema.exclusions.exclusionType, type)]
    if (referenceId != null) conditions.push(eq(schema.exclusions.referenceId, referenceId))
    else if (referenceKey) conditions.push(eq(schema.exclusions.referenceKey, referenceKey))
    else return

    await this.drizzle.delete(schema.exclusions)
      .where(and(...conditions))
  }

  async getExclusions(type?: string, parentKey?: string): Promise<Exclusion[]> {
    const conditions = []
    if (type) conditions.push(eq(schema.exclusions.exclusionType, type))
    if (parentKey) conditions.push(eq(schema.exclusions.parentKey, parentKey))

    const query = this.drizzle.select().from(schema.exclusions)
    if (conditions.length > 0) query.where(and(...conditions))
    query.orderBy(desc(schema.exclusions.createdAt))

    const rows = await query.all()
    return this.mapDrizzleToExclusion(rows)
  }

  private mapDrizzleToExclusion(rows: any[]): Exclusion[] {
    return rows.map(r => ({
      id: r.id,
      exclusion_type: r.exclusionType as any,
      reference_id: r.referenceId || undefined,
      reference_key: r.referenceKey || undefined,
      parent_key: r.parentKey || undefined,
      title: r.title || undefined,
      created_at: r.createdAt
    }))
  }
}
