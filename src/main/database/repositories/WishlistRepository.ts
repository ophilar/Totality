import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { WishlistItem, WishlistFilters } from '@main/types/database'
import { BaseRepository } from './BaseRepository'

export class WishlistRepository extends BaseRepository<WishlistItem> {
  constructor(db: DatabaseSync) {
    super(db, 'wishlist_items')
  }

  getItems(filters?: WishlistFilters): WishlistItem[] {
    let sql = 'SELECT * FROM wishlist_items WHERE 1=1'
    const params: SQLInputValue[] = []

    const mediaType = filters?.media_type || (filters as any)?.mediaType
    if (mediaType) {
      sql += ' AND media_type = ?'
      params.push(mediaType)
    }
    if (filters?.status) {
      sql += ' AND status = ?'
      params.push(filters.status)
    }
    if (filters?.reason) {
      sql += ' AND reason = ?'
      params.push(filters.reason)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR subtitle LIKE ?)'
      params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`)
    }

    const sortMap: Record<string, string> = {
      'title': 'title',
      'priority': 'priority',
      'added_at': 'added_at'
    }
    const sortCol = sortMap[filters?.sortBy || 'added_at'] || 'added_at'
    const sortDir = filters?.sortOrder === 'asc' ? 'ASC' : 'DESC'
    sql += ` ORDER BY ${sortCol} ${sortDir}`

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as unknown as WishlistItem[]
  }

  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    return this.getItems(filters)
  }

  getWishlistItemByTmdbId(tmdbId: string): WishlistItem | null {
    const stmt = this.db.prepare('SELECT * FROM wishlist_items WHERE tmdb_id = ?')
    return (stmt.get(tmdbId) as unknown as WishlistItem) || null
  }

  getWishlistItemByMusicbrainzId(mbid: string): WishlistItem | null {
    const stmt = this.db.prepare('SELECT * FROM wishlist_items WHERE musicbrainz_id = ?')
    return (stmt.get(mbid) as unknown as WishlistItem) || null
  }

  add(item: Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO wishlist_items (
        media_type, title, subtitle, year, reason, tmdb_id, imdb_id, musicbrainz_id,
        series_title, season_number, episode_number, collection_name,
        artist_name, album_title, poster_url, priority, notes, status,
        added_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      RETURNING id
    `)

    const row = stmt.get(
      item.media_type,
      item.title,
      item.subtitle || null,
      item.year || null,
      item.reason || 'missing',
      item.tmdb_id || null,
      item.imdb_id || null,
      item.musicbrainz_id || null,
      item.series_title || null,
      item.season_number || null,
      item.episode_number || null,
      item.collection_name || null,
      item.artist_name || null,
      item.album_title || null,
      item.poster_url || null,
      item.priority || 3,
      item.notes || null,
      item.status || 'active'
    ) as unknown as { id: number } | undefined

    return row?.id || 0
  }

  addMany(items: Array<Omit<WishlistItem, 'id' | 'added_at' | 'updated_at'>>): number {
    let count = 0
    this.beginBatch()
    try {
      for (const item of items) {
        this.add(item)
        count++
      }
      this.endBatch()
    } catch (err) {
      this.rollback()
      throw err
    }
    return count
  }

  update(id: number, updates: Partial<WishlistItem>): void {
    const fields: string[] = []
    const params: SQLInputValue[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'added_at' || key === 'updated_at') continue
      fields.push(`${key} = ?`)
      params.push(value === undefined ? null : (value as any))
    }

    if (fields.length === 0) return

    if (updates.status === 'completed') {
      fields.push("completed_at = datetime('now')")
    }

    fields.push("updated_at = datetime('now')")
    params.push(id)

    const sql = `UPDATE wishlist_items SET ${fields.join(', ')} WHERE id = ?`
    this.db.prepare(sql).run(...params)
  }

  batchUpdateStatus(ids: number[], status: string): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    const sql = `
      UPDATE wishlist_items 
      SET status = ?, 
          completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE completed_at END,
          updated_at = datetime('now')
      WHERE id IN (${placeholders})
    `
    this.db.prepare(sql).run(status, status, ...ids)
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(id) as unknown as { changes: number | bigint }
    return Number(result.changes) > 0
  }

  exists(tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): boolean {
    if (tmdbId) {
      return !!this.db.prepare('SELECT id FROM wishlist_items WHERE tmdb_id = ? AND status = \'active\'').get(tmdbId)
    }
    if (musicbrainzId) {
      return !!this.db.prepare('SELECT id FROM wishlist_items WHERE musicbrainz_id = ? AND status = \'active\'').get(musicbrainzId)
    }
    if (mediaItemId) {
      return !!this.db.prepare('SELECT id FROM wishlist_items WHERE media_item_id = ? AND status = \'active\'').get(mediaItemId)
    }
    return false
  }

  getCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM wishlist_items').get() as unknown as { count: number } | undefined
    return result?.count || 0
  }

  getCountsByReason(): Record<string, number> {
    const rows = this.db.prepare('SELECT reason, COUNT(*) as count FROM wishlist_items GROUP BY reason').all() as unknown as Array<{ reason: string; count: number }>
    const counts: Record<string, number> = {}
    if (rows) rows.forEach(r => counts[r.reason] = r.count)
    return counts
  }

  getWishlistItemById(id: number): WishlistItem | null {
    return (this.db.prepare('SELECT * FROM wishlist_items WHERE id = ?').get(id) as unknown as WishlistItem) || null
  }
}
