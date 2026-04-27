import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { MovieCollection } from '@main/types/database'
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
}
