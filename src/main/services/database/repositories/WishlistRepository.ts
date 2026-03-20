import type { Database } from 'sql.js'
import type { WishlistItem, WishlistFilters } from '../../../types/database'

type SaveCallback = () => Promise<void>

export class WishlistRepository {
  constructor(
    private getDb: () => Database | null,
    private save: SaveCallback,
    private startBatch: () => void,
    private endBatch: () => Promise<void>
  ) {}

  private get db(): Database {
    const db = this.getDb()
    if (!db) throw new Error('Database not initialized')
    return db
  }

  private rowsToObjects<T>(result: { columns: string[]; values: unknown[][] }): T[] {
    const { columns, values } = result
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col, index) => {
        obj[col] = row[index]
      })
      return obj as T
    })
  }

  /**
   * Add an item to the wishlist
   */
  async addWishlistItem(item: Partial<WishlistItem>): Promise<number> {
    // Use INSERT OR IGNORE to silently skip duplicates (unique constraints handle detection)
    const sql = `
      INSERT OR IGNORE INTO wishlist_items (
        media_type, title, subtitle, year, reason,
        tmdb_id, imdb_id, musicbrainz_id,
        series_title, season_number, episode_number, collection_name,
        artist_name, album_title,
        poster_url, priority, notes,
        current_quality_tier, current_quality_level, current_resolution,
        current_video_codec, current_audio_codec, media_item_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    this.db.run(sql, [
      item.media_type || 'movie',
      item.title || '',
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
      item.current_quality_tier || null,
      item.current_quality_level || null,
      item.current_resolution || null,
      item.current_video_codec || null,
      item.current_audio_codec || null,
      item.media_item_id || null,
    ])

    // Check if a row was actually inserted (0 = duplicate was ignored)
    const changes = this.db.getRowsModified()
    if (changes === 0) {
      // Item already exists - find and return the existing ID
      const existing = this.findExistingWishlistItem(item)
      if (existing) return existing
      // If we can't find it, something went wrong
      throw new Error('Item was not inserted and could not find existing item')
    }

    await this.save()

    // Get the inserted ID
    const result = this.db.exec('SELECT last_insert_rowid() as id')
    return result[0]?.values[0]?.[0] as number
  }

  /**
   * Find an existing wishlist item by its unique identifiers
   */
  private findExistingWishlistItem(item: Partial<WishlistItem>): number | null {
    // Try to find by tmdb_id + reason
    if (item.tmdb_id && item.reason) {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE tmdb_id = ? AND reason = ? LIMIT 1',
        [item.tmdb_id, item.reason]
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    // Try to find by musicbrainz_id + reason
    if (item.musicbrainz_id && item.reason) {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE musicbrainz_id = ? AND reason = ? LIMIT 1',
        [item.musicbrainz_id, item.reason]
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    // Try to find by media_item_id (for upgrades)
    if (item.media_item_id && item.reason === 'upgrade') {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE media_item_id = ? AND reason = ? LIMIT 1',
        [item.media_item_id, 'upgrade']
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    // Try to find by series_title + season_number (for seasons without tmdb_id)
    if (item.media_type === 'season' && item.series_title && item.season_number !== undefined && item.reason) {
      const result = this.db.exec(
        'SELECT id FROM wishlist_items WHERE series_title = ? AND season_number = ? AND reason = ? AND media_type = ? LIMIT 1',
        [item.series_title, item.season_number, item.reason, 'season']
      )
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0] as number
      }
    }

    return null
  }

  /**
   * Update a wishlist item
   */
  async updateWishlistItem(id: number, updates: Partial<WishlistItem>): Promise<void> {
    const fields: string[] = []
    const values: (string | number | null)[] = []

    if (updates.priority !== undefined) {
      fields.push('priority = ?')
      values.push(updates.priority)
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?')
      values.push(updates.notes)
    }
    if (updates.poster_url !== undefined) {
      fields.push('poster_url = ?')
      values.push(updates.poster_url)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
      // Auto-set completed_at when marking as completed
      if (updates.status === 'completed') {
        fields.push('completed_at = ?')
        values.push(new Date().toISOString())
      } else if (updates.status === 'active') {
        // Clear completed_at when reverting to active
        fields.push('completed_at = ?')
        values.push(null)
      }
    }

    if (fields.length === 0) return

    values.push(id)
    const sql = `UPDATE wishlist_items SET ${fields.join(', ')} WHERE id = ?`
    this.db.run(sql, values)
    await this.save()
  }

  /**
   * Remove an item from the wishlist
   */
  async removeWishlistItem(id: number): Promise<void> {
    this.db.run('DELETE FROM wishlist_items WHERE id = ?', [id])
    await this.save()
  }

  /**
   * Get all wishlist items with optional filters
   */
  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    let sql = 'SELECT * FROM wishlist_items WHERE 1=1'
    const params: (string | number)[] = []

    if (filters?.media_type) {
      // Handle combined media types for TV (episode + season)
      if (filters.media_type === 'episode') {
        sql += ' AND media_type IN (?, ?)'
        params.push('episode', 'season')
      } else {
        sql += ' AND media_type = ?'
        params.push(filters.media_type)
      }
    }
    if (filters?.priority) {
      sql += ' AND priority = ?'
      params.push(filters.priority)
    }
    if (filters?.reason) {
      sql += ' AND reason = ?'
      params.push(filters.reason)
    }
    if (filters?.status) {
      sql += ' AND status = ?'
      params.push(filters.status)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR series_title LIKE ? OR artist_name LIKE ?)'
      const searchTerm = `%${filters.searchQuery}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }
    if (filters?.series_title) {
      sql += ' AND series_title = ?'
      params.push(filters.series_title)
    }
    if (filters?.artist_name) {
      sql += ' AND artist_name = ?'
      params.push(filters.artist_name)
    }

    // Sorting
    const sortBy = filters?.sortBy || 'priority'
    const sortOrder = filters?.sortOrder || (sortBy === 'priority' ? 'desc' : 'asc')
    sql += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`

    // Add secondary sort by added_at for consistency
    if (sortBy !== 'added_at') {
      sql += ', added_at DESC'
    }

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters?.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<WishlistItem>(result[0])
  }

  /**
   * Get a single wishlist item by ID
   */
  getWishlistItemById(id: number): WishlistItem | null {
    const result = this.db.exec('SELECT * FROM wishlist_items WHERE id = ?', [id])
    if (!result.length || !result[0].values.length) return null

    return this.rowsToObjects<WishlistItem>(result[0])[0]
  }

  /**
   * Get the total count of wishlist items
   */
  getWishlistCount(): number {
    const result = this.db.exec('SELECT COUNT(*) as count FROM wishlist_items')
    return (result[0]?.values[0]?.[0] as number) || 0
  }

  /**
   * Check if an item already exists in the wishlist
   */
  wishlistItemExists(tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): boolean {
    if (tmdbId) {
      const result = this.db.exec('SELECT 1 FROM wishlist_items WHERE tmdb_id = ? LIMIT 1', [tmdbId])
      if (result.length && result[0].values.length) return true
    }

    if (musicbrainzId) {
      const result = this.db.exec('SELECT 1 FROM wishlist_items WHERE musicbrainz_id = ? LIMIT 1', [musicbrainzId])
      if (result.length && result[0].values.length) return true
    }

    if (mediaItemId) {
      const result = this.db.exec('SELECT 1 FROM wishlist_items WHERE media_item_id = ? LIMIT 1', [mediaItemId])
      if (result.length && result[0].values.length) return true
    }

    return false
  }

  /**
   * Get wishlist counts by reason
   */
  getWishlistCountsByReason(): { missing: number; upgrade: number; active: number; completed: number; total: number } {
    // Get counts by reason
    const reasonResult = this.db.exec(`
      SELECT reason, COUNT(*) as count FROM wishlist_items GROUP BY reason
    `)

    let missing = 0
    let upgrade = 0

    if (reasonResult.length && reasonResult[0].values.length) {
      for (const row of reasonResult[0].values) {
        if (row[0] === 'missing') missing = row[1] as number
        if (row[0] === 'upgrade') upgrade = row[1] as number
      }
    }

    // Get counts by status
    const statusResult = this.db.exec(`
      SELECT COALESCE(status, 'active') as status, COUNT(*) as count FROM wishlist_items GROUP BY status
    `)

    let active = 0
    let completed = 0

    if (statusResult.length && statusResult[0].values.length) {
      for (const row of statusResult[0].values) {
        if (row[0] === 'active' || row[0] === null) active += row[1] as number
        if (row[0] === 'completed') completed = row[1] as number
      }
    }

    return { missing, upgrade, active, completed, total: missing + upgrade }
  }

  /**
   * Add multiple items to the wishlist (bulk operation)
   */
  async addWishlistItemsBulk(items: Partial<WishlistItem>[]): Promise<number> {
    if (items.length === 0) return 0

    this.startBatch()
    let added = 0

    for (const item of items) {
      // Skip if already exists
      if (item.tmdb_id && this.wishlistItemExists(item.tmdb_id)) continue
      if (item.musicbrainz_id && this.wishlistItemExists(undefined, item.musicbrainz_id)) continue

      const sql = `
        INSERT INTO wishlist_items (
          media_type, title, subtitle, year,
          tmdb_id, imdb_id, musicbrainz_id,
          series_title, season_number, episode_number, collection_name,
          artist_name, album_title,
          poster_url, priority, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `

      this.db.run(sql, [
        item.media_type || 'movie',
        item.title || '',
        item.subtitle || null,
        item.year || null,
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
      ])
      added++
    }

    await this.endBatch()
    return added
  }
}
