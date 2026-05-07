import { eq, and, sql, asc, lt } from 'drizzle-orm'
import type { MovieCollection } from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'

export class MovieCollectionRepository extends BaseRepository<MovieCollection> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'movie_collections', drizzle)
  }

  public async getCollections(sourceId?: string): Promise<MovieCollection[]> {
    const query = this.drizzle.select().from(schema.movieCollections)
    if (sourceId) query.where(eq(schema.movieCollections.sourceId, sourceId))
    query.orderBy(asc(schema.movieCollections.collectionName))
    
    const rows = await query.all()
    return this.mapDrizzleToCollection(rows)
  }

  public async getIncompleteCollections(sourceId?: string): Promise<MovieCollection[]> {
    const conditions = [lt(schema.movieCollections.completenessPercentage, 100)]
    if (sourceId) conditions.push(eq(schema.movieCollections.sourceId, sourceId))

    const rows = await this.drizzle.select()
      .from(schema.movieCollections)
      .where(and(...conditions))
      .orderBy(asc(schema.movieCollections.completenessPercentage))
      .all()
    
    return this.mapDrizzleToCollection(rows)
  }

  public async deleteCollection(id: number): Promise<boolean> {
    return this.delete(id)
  }

  public async getStats(): Promise<{
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  }> {
    const [stats] = await this.drizzle.select({
      total: sql<number>`count(*)`,
      complete: sql<number>`count(CASE WHEN completeness_percentage >= 100 THEN 1 END)`,
      incomplete: sql<number>`count(CASE WHEN completeness_percentage < 100 THEN 1 END)`,
      totalMissing: sql<number>`sum(total_movies - owned_movies)`,
      avgCompleteness: sql<number>`avg(completeness_percentage)`
    }).from(schema.movieCollections).all()

    return {
      total: stats?.total || 0,
      complete: stats?.complete || 0,
      incomplete: stats?.incomplete || 0,
      totalMissing: stats?.totalMissing || 0,
      avgCompleteness: Math.round(stats?.avgCompleteness || 0)
    }
  }

  public async upsertCollection(data: Partial<MovieCollection>): Promise<void> {
    await this.drizzle.insert(schema.movieCollections)
      .values({
        tmdbCollectionId: data.tmdb_collection_id!,
        collectionName: data.collection_name!,
        sourceId: data.source_id || '',
        libraryId: data.library_id || '',
        totalMovies: data.total_movies || 0,
        ownedMovies: data.owned_movies || 0,
        missingMovies: data.missing_movies || '[]',
        ownedMovieIds: data.owned_movie_ids || '[]',
        completenessPercentage: data.completeness_percentage || 0,
        posterUrl: data.poster_url || null,
        backdropUrl: data.backdrop_url || null,
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .onConflictDoUpdate({
        target: [schema.movieCollections.tmdbCollectionId, schema.movieCollections.sourceId, schema.movieCollections.libraryId],
        set: {
          collectionName: data.collection_name,
          totalMovies: data.total_movies,
          ownedMovies: data.owned_movies,
          missingMovies: data.missing_movies,
          ownedMovieIds: data.owned_movie_ids,
          completenessPercentage: data.completeness_percentage,
          posterUrl: data.poster_url,
          backdropUrl: data.backdrop_url,
          updatedAt: sql`(datetime('now'))`
        }
      })
  }

  private mapDrizzleToCollection(rows: any[]): MovieCollection[] {
    return rows.map(r => ({
      id: r.id,
      tmdb_collection_id: r.tmdbCollectionId,
      collection_name: r.collectionName,
      source_id: r.sourceId,
      library_id: r.libraryId,
      total_movies: r.totalMovies,
      owned_movies: r.ownedMovies,
      missing_movies: r.missingMovies,
      owned_movie_ids: r.ownedMovieIds,
      completeness_percentage: r.completenessPercentage,
      poster_url: r.posterUrl || undefined,
      backdrop_url: r.backdropUrl || undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt
    }))
  }
}
