// @ts-nocheck
import type { DatabaseSync } from 'node:sqlite'
import type { MediaSource } from '../../types/database'
import { BaseRepository } from './BaseRepository'

export class SourceRepository extends BaseRepository<MediaSource> {
  constructor(db: DatabaseSync) {
    super(db, 'media_sources')
  }

  getMediaSources(): MediaSource[] {
    const stmt = this.db.prepare('SELECT * FROM media_sources ORDER BY display_name ASC')
    return stmt.all() as MediaSource[]
  }

  getMediaSourceById(sourceId: string): MediaSource | null {
    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE source_id = ?')
    return (stmt.get(sourceId) as MediaSource) || null
  }

  upsertMediaSource(source: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO media_sources (
        source_id, source_type, display_name, connection_config, is_enabled, last_connected_at, last_scan_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        display_name = excluded.display_name,
        connection_config = excluded.connection_config,
        is_enabled = excluded.is_enabled,
        last_connected_at = excluded.last_connected_at,
        last_scan_at = excluded.last_scan_at,
        updated_at = datetime('now')
    `)
    
    const result = stmt.run(
      source.source_id,
      source.source_type || 'plex',
      source.display_name,
      source.connection_config || '{}',
      source.is_enabled ? 1 : 0,
      source.last_connected_at || null,
      source.last_scan_at || null
    )
    
    return Number(result.lastInsertRowid)
  }

  deleteMediaSource(sourceId: string): void {
    const db = this.db
    
    // Execute all deletions in a transaction
    db.exec('BEGIN')
    try {
      // 1. Delete media items and their related data
      // Delete versions first
      db.prepare(`
        DELETE FROM media_item_versions WHERE media_item_id IN (
          SELECT id FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)
      
      // Delete quality scores
      db.prepare(`
        DELETE FROM quality_scores WHERE media_item_id IN (
          SELECT id FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)
      
      // Delete from collections link table
      db.prepare(`
        DELETE FROM media_item_collections WHERE media_item_id IN (
          SELECT id FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete the media items themselves
      db.prepare('DELETE FROM media_items WHERE source_id = ?').run(sourceId)

      // 2. Delete music data
      // Delete music quality scores
      db.prepare(`
        DELETE FROM music_quality_scores WHERE album_id IN (
          SELECT id FROM music_albums WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete album completeness data
      db.prepare(`
        DELETE FROM album_completeness WHERE album_id IN (
          SELECT id FROM music_albums WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete artist completeness data (artist_name is used here, so we find names for this source)
      db.prepare(`
        DELETE FROM artist_completeness WHERE artist_name IN (
          SELECT name FROM music_artists WHERE source_id = ?
        )
      `).run(sourceId)

      // Delete music tracks, albums, artists
      db.prepare('DELETE FROM music_tracks WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM music_albums WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM music_artists WHERE source_id = ?').run(sourceId)

      // 3. Delete completeness summaries
      db.prepare('DELETE FROM series_completeness WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
      
      // 4. Delete scans and notifications
      db.prepare('DELETE FROM library_scans WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM notifications WHERE source_id = ?').run(sourceId)
      
      // 5. Delete from task history
      db.prepare('DELETE FROM task_history WHERE source_id = ?').run(sourceId)

      // 6. Finally delete the source itself
      db.prepare('DELETE FROM media_sources WHERE source_id = ?').run(sourceId)
      
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  updateLastScanAt(sourceId: string): void {
    this.db.prepare("UPDATE media_sources SET last_scan_at = datetime('now') WHERE source_id = ?").run(sourceId)
  }

  updateSourceConnectionTime(sourceId: string): void {
    this.db.prepare("UPDATE media_sources SET last_connected_at = datetime('now') WHERE source_id = ?").run(sourceId)
  }

  updateSourceScanTime(sourceId: string): void {
    this.updateLastScanAt(sourceId)
  }

  getMediaSources(type?: string): MediaSource[] {
    let sql = 'SELECT * FROM media_sources'
    const params = []
    if (type) {
      sql += ' WHERE source_type = ?'
      params.push(type)
    }
    sql += ' ORDER BY display_name ASC'
    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MediaSource[]
  }

  getEnabledMediaSources(): MediaSource[] {
    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE is_enabled = 1 ORDER BY display_name ASC')
    return stmt.all() as MediaSource[]
  }

  getSourceLibraries(sourceId: string): any[] {
    const rows = this.db.prepare(`
      SELECT 
        library_id as libraryId, 
        library_name as libraryName, 
        library_type as libraryType, 
        is_enabled as isEnabled,
        is_protected as isProtected,
        last_scan_at as lastScanAt,
        items_scanned as itemsScanned
      FROM library_scans 
      WHERE source_id = ?
    `).all(sourceId) as any[]
    return rows || []
  }

  isLibraryEnabled(sourceId: string, libraryId: string): boolean {
    const row = this.db.prepare('SELECT is_enabled FROM library_scans WHERE source_id = ? AND library_id = ?').get(sourceId, libraryId) as { is_enabled: number } | undefined
    return row ? row.is_enabled === 1 : true
  }

  toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): void {
    this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, is_enabled, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, library_id) DO UPDATE SET is_enabled = ?, updated_at = datetime('now')
    `).run(sourceId, libraryId, enabled ? 1 : 0, enabled ? 1 : 0)
  }

  getEnabledLibraryIds(sourceId: string): string[] {
    const rows = this.db.prepare('SELECT library_id FROM library_scans WHERE source_id = ? AND is_enabled = 1').all(sourceId) as Array<{ library_id: string }>
    return rows ? rows.map(r => r.library_id) : []
  }

  setLibraryProtected(sourceId: string, libraryId: string, isProtected: boolean): void {
    this.db.prepare('UPDATE library_scans SET is_protected = ?, updated_at = datetime(\'now\') WHERE source_id = ? AND library_id = ?')
      .run(isProtected ? 1 : 0, sourceId, libraryId)
  }

  isLibraryProtected(sourceId: string, libraryId: string): boolean {
    const row = this.db.prepare('SELECT is_protected FROM library_scans WHERE source_id = ? AND library_id = ?').get(sourceId, libraryId) as { is_protected: number } | undefined
    return row ? row.is_protected === 1 : false
  }

  getLibraryScanTime(sourceId: string, libraryId: string): string | null {
    const row = this.db.prepare('SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?').get(sourceId, libraryId) as { last_scan_at: string } | undefined
    return row ? row.last_scan_at : null
  }

  getLibraryScanTimes(sourceId: string): Map<string, any> {
    const result = new Map<string, any>()
    const rows = this.db.prepare('SELECT library_id, last_scan_at, items_scanned FROM library_scans WHERE source_id = ?').all(sourceId) as any[]
    if (rows) rows.forEach(r => result.set(r.library_id, r))
    return result
  }

  updateLibraryScanTime(sourceId: string, libraryId: string, items: number): void {
    this.db.prepare(`
      INSERT INTO library_scans (source_id, library_id, last_scan_at, items_scanned, created_at, updated_at)
      VALUES (?, ?, datetime('now'), ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, library_id) DO UPDATE SET last_scan_at = datetime('now'), items_scanned = ?, updated_at = datetime('now')
    `).run(sourceId, libraryId, items, items)
    this.updateLastScanAt(sourceId)
  }
}
