// @ts-nocheck
import type { DatabaseSync } from 'node:sqlite'
import { BaseRepository } from './BaseRepository'

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

export class DuplicateRepository extends BaseRepository<MediaDuplicate> {
  constructor(db: DatabaseSync) {
    super(db, 'media_item_duplicates')
  }

  getPendingDuplicates(sourceId?: string): MediaDuplicate[] {
    let sql = "SELECT * FROM media_item_duplicates WHERE status = 'pending'"
    const params = []
    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    return this.queryAll(sql, params)
  }

  upsertDuplicate(dup: MediaDuplicate): void {
    this.db.prepare(`
      INSERT INTO media_item_duplicates (
        source_id, external_id, external_type, media_item_ids, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, external_id, external_type) DO UPDATE SET
        media_item_ids = excluded.media_item_ids,
        status = CASE WHEN media_item_duplicates.status = 'resolved' THEN 'pending' ELSE media_item_duplicates.status END,
        updated_at = datetime('now')
    `).run(
      dup.source_id,
      dup.external_id,
      dup.external_type,
      dup.media_item_ids,
      dup.status || 'pending'
    )
  }

  resolveDuplicate(id: number, strategy: string): void {
    this.db.prepare(`
      UPDATE media_item_duplicates 
      SET status = 'resolved', resolution_strategy = ?, resolved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(strategy, id)
  }
}
