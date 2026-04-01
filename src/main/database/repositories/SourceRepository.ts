import type { Database } from 'better-sqlite3'
import type { MediaSource } from '../../types/database'
import { BaseRepository } from './BaseRepository'

export class SourceRepository extends BaseRepository<MediaSource> {
  constructor(db: Database) {
    super(db, 'media_sources')
  }

  getMediaSources(): MediaSource[] {
    const stmt = this.db.prepare('SELECT * FROM media_sources ORDER BY display_name ASC')
    const rows = stmt.all() as MediaSource[]
    return rows.map(row => ({
      ...row,
      is_enabled: Boolean(row.is_enabled)
    }))
  }

  getMediaSourceById(sourceId: string): MediaSource | null {
    const stmt = this.db.prepare('SELECT * FROM media_sources WHERE source_id = ?')
    const row = stmt.get(sourceId) as MediaSource
    if (!row) return null
    return {
      ...row,
      is_enabled: Boolean(row.is_enabled)
    }
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
      source.source_type,
      source.display_name,
      source.connection_config,
      source.is_enabled ? 1 : 0,
      source.last_connected_at || null,
      source.last_scan_at || null
    )
    
    return Number(result.lastInsertRowid)
  }

  deleteMediaSource(sourceId: string): void {
    this.db.prepare('DELETE FROM media_sources WHERE source_id = ?').run(sourceId)
  }

  updateLastScanAt(sourceId: string): void {
    this.db.prepare("UPDATE media_sources SET last_scan_at = datetime('now') WHERE source_id = ?").run(sourceId)
  }
}
