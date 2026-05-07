import { eq, and, sql } from 'drizzle-orm'
import type { MediaSource } from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'

export class SourceRepository extends BaseRepository<MediaSource> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'media_sources', drizzle)
  }

  async getSources(type?: string): Promise<MediaSource[]> {
    const query = this.drizzle.select().from(schema.mediaSources)
    if (type) query.where(eq(schema.mediaSources.sourceType, type))
    
    const rows = await query.all()
    return this.mapDrizzleToSources(rows)
  }

  async getSourceById(sourceId: string): Promise<MediaSource | null> {
    const row = await this.drizzle.select()
      .from(schema.mediaSources)
      .where(eq(schema.mediaSources.sourceId, sourceId))
      .get()
    return row ? this.mapDrizzleToSources([row])[0] : null
  }

  async upsertSource(source: Omit<MediaSource, 'id' | 'updated_at' | 'created_at'>): Promise<void> {
    await this.drizzle.insert(schema.mediaSources)
      .values({
        sourceId: source.source_id,
        sourceType: source.source_type,
        displayName: source.display_name,
        connectionConfig: source.connection_config,
        isEnabled: source.is_enabled ? 1 : 0,
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .onConflictDoUpdate({
        target: schema.mediaSources.sourceId,
        set: {
          displayName: source.display_name,
          connectionConfig: source.connection_config,
          isEnabled: source.is_enabled ? 1 : 0,
          updatedAt: sql`(datetime('now'))`
        }
      })
  }

  async toggleSource(sourceId: string, enabled: boolean): Promise<void> {
    await this.drizzle.update(schema.mediaSources)
      .set({ isEnabled: enabled ? 1 : 0, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.mediaSources.sourceId, sourceId))
  }

  async updateSourceScanTime(sourceId: string): Promise<void> {
    await this.drizzle.update(schema.mediaSources)
      .set({ lastScanAt: sql`(datetime('now'))`, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.mediaSources.sourceId, sourceId))
  }

  async deleteSource(sourceId: string): Promise<void> {
    await this.drizzle.delete(schema.mediaSources)
      .where(eq(schema.mediaSources.sourceId, sourceId))
  }

  // ============================================================================
  // LIBRARY SETTINGS
  // ============================================================================

  async getSourceLibraries(sourceId: string): Promise<any[]> {
    const rows = await this.drizzle.select({
      libraryId: schema.libraryScans.libraryId,
      libraryName: schema.libraryScans.libraryName,
      libraryType: schema.libraryScans.libraryType,
      isEnabled: schema.libraryScans.isEnabled,
      isProtected: schema.libraryScans.isProtected,
      lastScanAt: schema.libraryScans.lastScanAt,
      itemsScanned: schema.libraryScans.itemsScanned
    })
    .from(schema.libraryScans)
    .where(eq(schema.libraryScans.sourceId, sourceId))
    .all()
    
    return rows
  }

  async getEnabledLibraryIds(sourceId: string): Promise<string[]> {
    const rows = await this.drizzle.select({ libraryId: schema.libraryScans.libraryId })
      .from(schema.libraryScans)
      .where(and(eq(schema.libraryScans.sourceId, sourceId), eq(schema.libraryScans.isEnabled, 1)))
      .all()
    return rows.map(r => r.libraryId)
  }

  async toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): Promise<void> {
    await this.drizzle.update(schema.libraryScans)
      .set({ isEnabled: enabled ? 1 : 0, updatedAt: sql`(datetime('now'))` })
      .where(and(eq(schema.libraryScans.sourceId, sourceId), eq(schema.libraryScans.libraryId, libraryId)))
  }

  async setLibrariesEnabled(sourceId: string, libraries: Array<{ id: string; name: string; type: string; enabled: boolean }>): Promise<void> {
    await this.beginBatch()
    try {
      for (const lib of libraries) {
        await this.drizzle.insert(schema.libraryScans)
          .values({
            sourceId,
            libraryId: lib.id,
            libraryName: lib.name,
            libraryType: lib.type,
            isEnabled: lib.enabled ? 1 : 0,
            isProtected: 0, // Explicitly provide 0 instead of relying on default
            createdAt: sql`(datetime('now'))`,
            updatedAt: sql`(datetime('now'))`
          })
          .onConflictDoUpdate({
            target: [schema.libraryScans.sourceId, schema.libraryScans.libraryId],
            set: {
              isEnabled: lib.enabled ? 1 : 0,
              updatedAt: sql`(datetime('now'))`
            }
          })
      }
      await this.endBatch()
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  async getEnabledSources(): Promise<MediaSource[]> {
    const rows = await this.drizzle.select().from(schema.mediaSources).where(eq(schema.mediaSources.isEnabled, 1)).all()
    return this.mapDrizzleToSources(rows)
  }

  async updateSourceConnectionTime(sourceId: string): Promise<void> {
    await this.drizzle.update(schema.mediaSources)
      .set({ lastConnectedAt: sql`(datetime('now'))`, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.mediaSources.sourceId, sourceId))
  }

  async updateLibraryScanTime(sourceId: string, libraryId: string, items: number): Promise<void> {
    await this.updateLibraryScanStats(sourceId, libraryId, items)
  }

  async isLibraryEnabled(sourceId: string, libraryId: string): Promise<boolean> {
    const row = await this.drizzle.select({ isEnabled: schema.libraryScans.isEnabled })
      .from(schema.libraryScans)
      .where(and(eq(schema.libraryScans.sourceId, sourceId), eq(schema.libraryScans.libraryId, libraryId)))
      .get()
    return row?.isEnabled === 1
  }

  async getLibraryScanTime(sourceId: string, libraryId: string): Promise<string | null> {
    const row = await this.drizzle.select({ lastScanAt: schema.libraryScans.lastScanAt })
      .from(schema.libraryScans)
      .where(and(eq(schema.libraryScans.sourceId, sourceId), eq(schema.libraryScans.libraryId, libraryId)))
      .get()
    return row?.lastScanAt || null
  }

  async getLibraryScanTimes(sourceId: string): Promise<Map<string, { lastScanAt: string | null; itemsScanned: number }>> {
    const rows = await this.drizzle.select({
      libraryId: schema.libraryScans.libraryId,
      lastScanAt: schema.libraryScans.lastScanAt,
      itemsScanned: schema.libraryScans.itemsScanned
    })
    .from(schema.libraryScans)
    .where(eq(schema.libraryScans.sourceId, sourceId))
    .all()

    const map = new Map()
    for (const row of rows) {
      map.set(row.libraryId, {
        lastScanAt: row.lastScanAt,
        itemsScanned: row.itemsScanned || 0,
      })
    }
    return map
  }

  async setLibraryProtected(sourceId: string, libraryId: string, isProtected: boolean): Promise<void> {
    await this.drizzle.update(schema.libraryScans)
      .set({ isProtected: isProtected ? 1 : 0, updatedAt: sql`(datetime('now'))` })
      .where(and(eq(schema.libraryScans.sourceId, sourceId), eq(schema.libraryScans.libraryId, libraryId)))
  }

  async updateLibraryScanStats(sourceId: string, libraryId: string, items: number): Promise<void> {
    await this.drizzle.update(schema.libraryScans)
      .set({ 
        lastScanAt: sql`(datetime('now'))`, 
        itemsScanned: items, 
        updatedAt: sql`(datetime('now'))` 
      })
      .where(and(eq(schema.libraryScans.sourceId, sourceId), eq(schema.libraryScans.libraryId, libraryId)))
    
    await this.updateSourceScanTime(sourceId)
  }

  private mapDrizzleToSources(rows: any[]): MediaSource[] {
    return rows.map(r => ({
      id: r.id,
      source_id: r.sourceId,
      source_type: r.sourceType as any,
      display_name: r.displayName,
      connection_config: r.connectionConfig,
      is_enabled: r.isEnabled,
      last_connected_at: r.lastConnectedAt || undefined,
      last_scan_at: r.lastScanAt || undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt
    }))
  }
}
