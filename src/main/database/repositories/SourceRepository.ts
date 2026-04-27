import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { MediaSource } from '@main/types/database'
import { BaseRepository } from './BaseRepository'

export class SourceRepository extends BaseRepository<MediaSource> {
  constructor(db: DatabaseSync) {
    super(db, 'media_sources')
  }

  getSources(type?: string): MediaSource[] {
    let sql = 'SELECT * FROM media_sources'
    const params: SQLInputValue[] = []

    if (type) {
      sql += ' WHERE source_type = ?'
      params.push(type)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as unknown as MediaSource[]
  }

  getSourceById(sourceId: string): MediaSource | null {
    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE source_id = ?')
    return (stmt.get(sourceId) as unknown as MediaSource) || null
  }

  upsertSource(source: Omit<MediaSource, 'id' | 'updated_at' | 'created_at'>): void {
    this.db.prepare(`
      INSERT INTO media_sources (source_id, source_type, display_name, connection_config, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id) DO UPDATE SET
        display_name = excluded.display_name,
        connection_config = excluded.connection_config,
        is_enabled = excluded.is_enabled,
        updated_at = datetime('now')
    `).run(
      source.source_id,
      source.source_type,
      source.display_name,
      source.connection_config,
      source.is_enabled ? 1 : 0
    )
  }

  toggleSource(sourceId: string, enabled: boolean): void {
    this.db.prepare('UPDATE media_sources SET is_enabled = ?, updated_at = datetime(\'now\') WHERE source_id = ?')
      .run(enabled ? 1 : 0, sourceId)
  }

  updateSourceScanTime(sourceId: string): void {
    this.db.prepare('UPDATE media_sources SET last_scan_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE source_id = ?')
      .run(sourceId)
  }

  deleteSource(sourceId: string): void {
    this.db.prepare('DELETE FROM media_sources WHERE source_id = ?').run(sourceId)
  }

  // ============================================================================
  // LIBRARY SETTINGS
  // ============================================================================

  getSourceLibraries(sourceId: string): any[] {
    return this.db.prepare(`
      SELECT library_id as libraryId, library_name as libraryName, library_type as libraryType, 
             is_enabled as isEnabled, is_protected as isProtected,
             last_scan_at as lastScanAt, items_scanned as itemsScanned
      FROM library_scans 
      WHERE source_id = ?
    `).all(sourceId) as unknown as any[]
  }

  getEnabledLibraryIds(sourceId: string): string[] {
    const rows = this.db.prepare('SELECT library_id FROM library_scans WHERE source_id = ? AND is_enabled = 1').all(sourceId) as unknown as Array<{ library_id: string }>
    return rows.map(r => r.library_id)
  }

  toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): void {
    this.db.prepare(`
      UPDATE library_scans SET is_enabled = ?, updated_at = datetime('now')
      WHERE source_id = ? AND library_id = ?
    `).run(enabled ? 1 : 0, sourceId, libraryId)
  }

  setLibrariesEnabled(sourceId: string, libraries: Array<{ id: string; name: string; type: string; enabled: boolean }>): void {
    this.beginBatch()
    try {
      const stmt = this.db.prepare(`
        INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(source_id, library_id) DO UPDATE SET
          is_enabled = excluded.is_enabled,
          updated_at = datetime('now')
      `)
      for (const lib of libraries) {
        stmt.run(sourceId, lib.id, lib.name, lib.type, lib.enabled ? 1 : 0)
      }
      this.endBatch()
    } catch (err) {
      this.rollback()
      throw err
    }
  }

  getEnabledSources(): MediaSource[] {
    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE is_enabled = 1')
    return stmt.all() as unknown as MediaSource[]
  }

  updateSourceConnectionTime(sourceId: string): void {
    this.db.prepare('UPDATE media_sources SET last_connected_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE source_id = ?')
      .run(sourceId)
  }

  updateLibraryScanTime(sourceId: string, libraryId: string, items: number): void {
    this.updateLibraryScanStats(sourceId, libraryId, items)
  }

  isLibraryEnabled(sourceId: string, libraryId: string): boolean {
    const stmt = this.db.prepare('SELECT is_enabled FROM library_scans WHERE source_id = ? AND library_id = ?')
    const result = stmt.get(sourceId, libraryId) as { is_enabled: number } | undefined
    return result?.is_enabled === 1
  }

  getLibraryScanTime(sourceId: string, libraryId: string): string | null {
    const stmt = this.db.prepare('SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?')
    const result = stmt.get(sourceId, libraryId) as { last_scan_at: string | null } | undefined
    return result?.last_scan_at || null
  }

  getLibraryScanTimes(sourceId: string): Map<string, { lastScanAt: string | null; itemsScanned: number }> {
    const rows = this.db.prepare('SELECT library_id, last_scan_at, items_scanned FROM library_scans WHERE source_id = ?').all(sourceId) as unknown as Array<{ library_id: string; last_scan_at: string | null; items_scanned: number }>
    const map = new Map()
    for (const row of rows) {
      map.set(row.library_id, {
        lastScanAt: row.last_scan_at,
        itemsScanned: row.items_scanned,
      })
    }
    return map
  }

  setLibraryProtected(sourceId: string, libraryId: string, isProtected: boolean): void {
    this.db.prepare('UPDATE library_scans SET is_protected = ?, updated_at = datetime(\'now\') WHERE source_id = ? AND library_id = ?')
      .run(isProtected ? 1 : 0, sourceId, libraryId)
  }

  updateLibraryScanStats(sourceId: string, libraryId: string, items: number): void {
    this.db.prepare(`
      UPDATE library_scans
      SET last_scan_at = datetime('now'), items_scanned = ?, updated_at = datetime('now')
      WHERE source_id = ? AND library_id = ?
    `).run(items, sourceId, libraryId)
    this.updateSourceScanTime(sourceId)
  }
}
