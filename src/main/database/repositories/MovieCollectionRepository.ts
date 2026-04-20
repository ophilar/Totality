import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { MovieCollection } from '../../types/database'
import { BaseRepository } from './BaseRepository'

export class MovieCollectionRepository extends BaseRepository<MovieCollection> {
  constructor(db: DatabaseSync) {
    super(db, 'movie_collections')
  }

  public getCollections(sourceId?: string): MovieCollection[] {
    let sql = 'SELECT * FROM movie_collections'
    const params: SQLInputValue[] = []
    if (sourceId) {
      sql += ' WHERE source_id = ?'
      params.push(sourceId)
    }
    sql += ' ORDER BY collection_name ASC'
    return this.db.prepare(sql).all(...params) as unknown as MovieCollection[]
  }

  public getIncompleteCollections(sourceId?: string): MovieCollection[] {
    let sql = 'SELECT * FROM movie_collections WHERE completeness_percentage < 100'
    const params: SQLInputValue[] = []
    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    sql += ' ORDER BY completeness_percentage ASC'
    return this.db.prepare(sql).all(...params) as unknown as MovieCollection[]
  }

  public deleteCollection(id: number): boolean {
    return this.delete(id)
  }

  public getStats(): {
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM movie_collections').get() as unknown as { count: number } | undefined
    const complete = this.db.prepare('SELECT COUNT(*) as count FROM movie_collections WHERE completeness_percentage >= 100').get() as unknown as { count: number } | undefined
    const incomplete = this.db.prepare('SELECT COUNT(*) as count FROM movie_collections WHERE completeness_percentage < 100').get() as unknown as { count: number } | undefined
    const missing = this.db.prepare('SELECT SUM(total_movies - owned_movies) as count FROM movie_collections').get() as unknown as { count: number } | undefined
    const avg = this.db.prepare('SELECT AVG(completeness_percentage) as avg FROM movie_collections').get() as unknown as { avg: number } | undefined

    return {
      total: total?.count || 0,
      complete: complete?.count || 0,
      incomplete: incomplete?.count || 0,
      totalMissing: missing?.count || 0,
      avgCompleteness: Math.round(avg?.avg || 0)
    }
  }

  public upsertCollection(data: Partial<MovieCollection>) {
    this.db.prepare(`
      INSERT INTO movie_collections (
        tmdb_collection_id, collection_name, source_id, library_id,
        total_movies, owned_movies, missing_movies, owned_movie_ids,
        completeness_percentage, poster_url, backdrop_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(tmdb_collection_id, source_id, library_id) DO UPDATE SET
        collection_name = excluded.collection_name,
        total_movies = excluded.total_movies,
        owned_movies = excluded.owned_movies,
        missing_movies = excluded.missing_movies,
        owned_movie_ids = excluded.owned_movie_ids,
        completeness_percentage = excluded.completeness_percentage,
        poster_url = excluded.poster_url,
        backdrop_url = excluded.backdrop_url,
        updated_at = datetime('now')
    `).run(
      data.tmdb_collection_id ?? null, data.collection_name ?? null, data.source_id || '', data.library_id || '',
      data.total_movies || 0, data.owned_movies || 0, data.missing_movies || '[]', data.owned_movie_ids || '[]',
      data.completeness_percentage || 0, data.poster_url || null, data.backdrop_url || null
    )
  }

  /**
   * Links a media item to a collection (by tag name).
   * Creates the collection entry if it doesn't exist.
   */
  public addMediaToCollection(mediaItemId: number, collectionTag: string): void {
    // 1. Ensure collection exists
    this.db.prepare(`
      INSERT INTO movie_collections (collection_name, tmdb_collection_id, source_id, library_id, total_movies, owned_movies, missing_movies, owned_movie_ids, completeness_percentage, created_at, updated_at)
      SELECT ?, NULL, source_id, library_id, 0, 0, '[]', '[]', 0, datetime('now'), datetime('now')
      FROM media_items WHERE id = ?
      WHERE NOT EXISTS (
        SELECT 1 FROM movie_collections c
        JOIN media_items m ON m.source_id = c.source_id AND m.library_id = c.library_id
        WHERE c.collection_name = ? AND m.id = ?
      )
    `).run(collectionTag, mediaItemId, collectionTag, mediaItemId)

    // 2. Link item to collection
    this.db.prepare(`
      INSERT INTO media_item_collections (media_item_id, collection_id)
      SELECT ?, id FROM movie_collections 
      WHERE collection_name = ?
      ON CONFLICT DO NOTHING
    `).run(mediaItemId, collectionTag)
  }
}
