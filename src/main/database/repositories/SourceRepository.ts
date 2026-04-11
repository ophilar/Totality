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
}
