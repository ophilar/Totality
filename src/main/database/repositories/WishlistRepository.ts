// @ts-nocheck
import type { DatabaseSync } from 'node:sqlite'
import type { WishlistItem, WishlistFilters } from '../../types/database'
import { BaseRepository } from './BaseRepository'

export class WishlistRepository extends BaseRepository<WishlistItem> {
  constructor(db: DatabaseSync) {
    super(db, 'wishlist_items')
  }

  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    let sql = 'SELECT * FROM wishlist_items WHERE 1=1'
    const params: unknown[] = []

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
    return stmt.all(...params) as WishlistItem[]
  }

  getWishlistItemByTmdbId(tmdbId: string): WishlistItem | null {
    const stmt = this.db.prepare('SELECT * FROM wishlist_items WHERE tmdb_id = ?')
    return (stmt.get(tmdbId) as WishlistItem) || null
  }

  getWishlistItemByMusicbrainzId(mbid: string): WishlistItem | null {
    const stmt = this.db.prepare('SELECT * FROM wishlist_items WHERE musicbrainz_id = ?')
    return (stmt.get(mbid) as WishlistItem) || null
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
    ) as { id: number } | undefined

    return row?.id || 0
  }
}
