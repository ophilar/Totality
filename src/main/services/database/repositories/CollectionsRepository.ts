import type { Database } from 'sql.js'
import type { MovieCollection } from '../../../types/database'

type SaveCallback = () => Promise<void>

export class CollectionsRepository {
  constructor(
    private getDb: () => Database | null,
    private save: SaveCallback
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
   * Insert or update movie collection data
   */
  async upsertMovieCollection(
    data: Omit<MovieCollection, 'id' | 'created_at' | 'updated_at'>
  ): Promise<number> {
    const sourceId = data.source_id || null
    const libraryId = data.library_id || null

    // Check if record exists - handle NULL values properly
    const checkSql = sourceId === null && libraryId === null
      ? `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id IS NULL AND library_id IS NULL`
      : sourceId === null
      ? `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id IS NULL AND library_id = ?`
      : libraryId === null
      ? `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id IS NULL`
      : `SELECT id FROM movie_collections WHERE tmdb_collection_id = ? AND source_id = ? AND library_id = ?`

    const checkParams = sourceId === null && libraryId === null
      ? [data.tmdb_collection_id]
      : sourceId === null
      ? [data.tmdb_collection_id, libraryId]
      : libraryId === null
      ? [data.tmdb_collection_id, sourceId]
      : [data.tmdb_collection_id, sourceId, libraryId]

    const existing = this.db.exec(checkSql, checkParams)
    const existingId = existing.length > 0 && existing[0].values.length > 0
      ? existing[0].values[0][0] as number
      : null

    if (existingId !== null) {
      // Update existing record
      const updateSql = `
        UPDATE movie_collections SET
          collection_name = ?,
          total_movies = ?,
          owned_movies = ?,
          missing_movies = ?,
          owned_movie_ids = ?,
          completeness_percentage = ?,
          poster_url = ?,
          backdrop_url = ?
        WHERE id = ?
      `
      this.db.run(updateSql, [
        data.collection_name,
        data.total_movies,
        data.owned_movies,
        data.missing_movies,
        data.owned_movie_ids,
        data.completeness_percentage,
        data.poster_url || null,
        data.backdrop_url || null,
        existingId,
      ])
      await this.save()
      return existingId
    } else {
      // Insert new record
      const insertSql = `
        INSERT INTO movie_collections (
          tmdb_collection_id, collection_name, source_id, library_id, total_movies, owned_movies,
          missing_movies, owned_movie_ids, completeness_percentage,
          poster_url, backdrop_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      this.db.run(insertSql, [
        data.tmdb_collection_id,
        data.collection_name,
        sourceId,
        libraryId,
        data.total_movies,
        data.owned_movies,
        data.missing_movies,
        data.owned_movie_ids,
        data.completeness_percentage,
        data.poster_url || null,
        data.backdrop_url || null,
      ])

      const result = this.db.exec('SELECT last_insert_rowid() as id')
      const id = result[0].values[0][0] as number

      await this.save()
      return id
    }
  }

  /**
   * Get all movie collections
   */
  getMovieCollections(sourceId?: string): MovieCollection[] {
    const result = sourceId
      ? this.db.exec('SELECT * FROM movie_collections WHERE source_id = ? ORDER BY collection_name ASC', [sourceId])
      : this.db.exec('SELECT * FROM movie_collections ORDER BY collection_name ASC')
    if (!result.length) return []

    return this.rowsToObjects<MovieCollection>(result[0])
  }

  /**
   * Get movie collection by TMDB collection ID
   */
  getMovieCollectionByTmdbId(tmdbCollectionId: string): MovieCollection | null {
    const result = this.db.exec(
      'SELECT * FROM movie_collections WHERE tmdb_collection_id = ?',
      [tmdbCollectionId]
    )
    if (!result.length) return null

    const items = this.rowsToObjects<MovieCollection>(result[0])
    return items[0] || null
  }

  /**
   * Get incomplete movie collections (completeness < 100%)
   * @param sourceId Optional source ID to filter by
   */
  getIncompleteMovieCollections(sourceId?: string): MovieCollection[] {
    if (sourceId) {
      const result = this.db.exec(
        'SELECT * FROM movie_collections WHERE completeness_percentage < 100 AND source_id = ? ORDER BY completeness_percentage ASC',
        [sourceId]
      )
      if (!result.length) return []
      return this.rowsToObjects<MovieCollection>(result[0])
    }

    const result = this.db.exec(
      'SELECT * FROM movie_collections WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    if (!result.length) return []

    return this.rowsToObjects<MovieCollection>(result[0])
  }

  /**
   * Delete movie collection record
   */
  async deleteMovieCollection(id: number): Promise<boolean> {
    this.db.run('DELETE FROM movie_collections WHERE id = ?', [id])
    await this.save()
    return true
  }

  /**
   * Clear all movie collections (for re-sync with Plex)
   */
  async clearMovieCollections(sourceId?: string): Promise<void> {
    if (sourceId) {
      this.db.run('DELETE FROM movie_collections WHERE source_id = ?', [sourceId])
      await this.save()
      console.log(`Cleared movie collections for source ${sourceId}`)
    } else {
      this.db.run('DELETE FROM movie_collections')
      await this.save()
      console.log('Cleared all movie collections')
    }
  }

  /**
   * Delete movie collections with only 1 movie (not real collections)
   */
  async deleteSingleMovieCollections(): Promise<number> {
    // Get count before deletion
    const result = this.db.exec('SELECT COUNT(*) FROM movie_collections WHERE total_movies <= 1')
    const count = (result[0]?.values[0]?.[0] as number) || 0

    if (count > 0) {
      this.db.run('DELETE FROM movie_collections WHERE total_movies <= 1')
      await this.save()
      console.log(`Deleted ${count} single-movie collections`)
    }

    return count
  }

  /**
   * Get movie collection statistics
   */
  getMovieCollectionStats(): {
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  } {
    const stats = {
      total: 0,
      complete: 0,
      incomplete: 0,
      totalMissing: 0,
      avgCompleteness: 0,
    }

    // Total collections
    let result = this.db.exec('SELECT COUNT(*) FROM movie_collections')
    stats.total = (result[0]?.values[0]?.[0] as number) || 0

    // Complete collections
    result = this.db.exec(
      'SELECT COUNT(*) FROM movie_collections WHERE completeness_percentage = 100'
    )
    stats.complete = (result[0]?.values[0]?.[0] as number) || 0

    // Incomplete collections
    result = this.db.exec(
      'SELECT COUNT(*) FROM movie_collections WHERE completeness_percentage < 100'
    )
    stats.incomplete = (result[0]?.values[0]?.[0] as number) || 0

    // Total missing movies across all collections
    result = this.db.exec(
      'SELECT SUM(json_array_length(missing_movies)) FROM movie_collections WHERE missing_movies IS NOT NULL'
    )
    stats.totalMissing = (result[0]?.values[0]?.[0] as number) || 0

    // Average completeness
    result = this.db.exec(
      'SELECT AVG(completeness_percentage) FROM movie_collections'
    )
    stats.avgCompleteness = Math.round(
      (result[0]?.values[0]?.[0] as number) || 0
    )

    return stats
  }
}
