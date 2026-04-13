import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { getLoggingService } from './LoggingService'
import {
  CancellableOperation,
  wasRecentlyAnalyzed,
  type AnalysisProgress,
  type AnalysisOptions,
} from './utils/ProgressTracker'
import type { MovieCollection, MissingMovie, MediaItem } from '../types/database'
import type { TMDBCollection, TMDBMovieDetails } from '../types/tmdb'
import { CompletenessEngine } from './CompletenessEngine'

/** Progress phases for collection analysis */
export type CollectionAnalysisPhase = 'scanning' | 'fetching' | 'complete'

/** Collection analysis progress type */
export type CollectionAnalysisProgress = AnalysisProgress<CollectionAnalysisPhase>

export interface CollectionAnalysisOptions extends AnalysisOptions {
  /** Deduplicate movies across providers by TMDB ID (default: true when no sourceId) */
  deduplicateByTmdbId?: boolean
}

interface CollectionInfo {
  tmdbCollectionId: number
  collectionName: string
  ownedMovies: MediaItem[]
}

export class MovieCollectionService extends CancellableOperation {
  /**
   * Look up TMDB IDs for movies that don't have them
   */
  private async lookupMissingTMDBIds(
    movies: MediaItem[],
    onProgress?: (progress: any) => void
  ): Promise<{ updated: number; failed: number }> {
    return getTMDBService().lookupMissingTMDBIds(movies, 'movie', onProgress)
  }

  /**
   * Deduplicate movies by TMDB ID across all providers
   * Keeps the highest quality version (by video bitrate) when duplicates exist
   */
  private deduplicateMoviesByTmdbId(movies: MediaItem[]): MediaItem[] {
    const movieMap = new Map<string, MediaItem>()

    for (const movie of movies) {
      if (!movie.tmdb_id) continue
      const existing = movieMap.get(movie.tmdb_id)
      if (!existing || (movie.video_bitrate || 0) > (existing.video_bitrate || 0)) {
        movieMap.set(movie.tmdb_id, movie)
      }
    }

    return Array.from(movieMap.values())
  }

  /**
   * Get movies deduplicated by TMDB ID across all providers
   */
  private async getMoviesDeduplicatedByTmdbId(
    onProgress?: (progress: CollectionAnalysisProgress) => void
  ): Promise<MediaItem[]> {
    const db = getDatabase()
    const allMovies = db.media.getItems({ type: 'movie' }) as MediaItem[]
    
    const lookupProgressWrapper = onProgress ? (progress: any) => {
      onProgress({
        current: progress.current,
        total: progress.total,
        currentItem: `Looking up: ${progress.currentItem}`,
        phase: 'scanning',
      })
    } : undefined

    await this.lookupMissingTMDBIds(allMovies, lookupProgressWrapper)
    if (this.isCancelled()) return []

    const updatedMovies = db.media.getItems({ type: 'movie' }) as MediaItem[]
    return this.deduplicateMoviesByTmdbId(updatedMovies)
  }

  /**
   * Look up a TMDB collection's full membership and calculate completeness.
   */
  async lookupCollectionCompleteness(
    tmdbCollectionId: string,
    ownedTmdbIds: string[],
  ): Promise<{
    totalMovies: number
    ownedMovies: number
    missingMovies: MissingMovie[]
    completenessPercentage: number
    posterUrl?: string
    backdropUrl?: string
    collectionName: string
  } | null> {
    const tmdb = getTMDBService()
    const tmdbCollection: TMDBCollection = await tmdb.getCollectionDetails(tmdbCollectionId)

    const today = new Date().toISOString().split('T')[0]
    const releasedParts = tmdbCollection.parts.filter(p => !p.release_date || p.release_date <= today)

    if (releasedParts.length <= 1) return null

    const targetSet = releasedParts.map(p => ({
      tmdb_id: p.id.toString(),
      title: p.title,
      year: p.release_date ? parseInt(p.release_date.split('-')[0], 10) : undefined,
      poster_path: p.poster_path ? tmdb.buildImageUrl(p.poster_path, 'w300') || undefined : undefined,
    }))

    const analysis = CompletenessEngine.calculateSimple(targetSet, new Set(ownedTmdbIds))

    return {
      totalMovies: analysis.total,
      ownedMovies: analysis.owned,
      missingMovies: analysis.missing,
      completenessPercentage: analysis.percentage,
      posterUrl: tmdbCollection.poster_path ? tmdb.buildImageUrl(tmdbCollection.poster_path, 'w500') || undefined : undefined,
      backdropUrl: tmdbCollection.backdrop_path ? tmdb.buildImageUrl(tmdbCollection.backdrop_path, 'original') || undefined : undefined,
      collectionName: tmdbCollection.name,
    }
  }

  /**
   * Analyze collections using TMDB API
   */
  async analyzeAllCollections(
    onProgress?: (progress: CollectionAnalysisProgress) => void,
    sourceId?: string,
    libraryId?: string,
    options: CollectionAnalysisOptions = {}
  ): Promise<{ completed: boolean; analyzed: number; skipped: number }> {
    const {
      skipRecentlyAnalyzed = true,
      reanalyzeAfterDays = 7,
      deduplicateByTmdbId = !sourceId,
    } = options
    this.resetCancellation()

    const db = getDatabase()
    const tmdb = getTMDBService()

    const tmdbApiKey = db.config.getSetting('tmdb_api_key')
    if (!tmdbApiKey) throw new Error('TMDB API key not configured.')

    await tmdb.initialize()

    let movies: MediaItem[]
    const filters: any = { type: 'movie' }
    if (sourceId) filters.sourceId = sourceId
    if (libraryId) filters.libraryId = libraryId

    if (deduplicateByTmdbId && !sourceId) {
      movies = await this.getMoviesDeduplicatedByTmdbId(onProgress)
      if (this.isCancelled()) return { completed: false, analyzed: 0, skipped: 0 }
    } else {
      movies = db.media.getItems(filters) as MediaItem[]
      await this.lookupMissingTMDBIds(movies, onProgress as any)
      if (this.isCancelled()) return { completed: false, analyzed: 0, skipped: 0 }
      movies = db.media.getItems(filters) as MediaItem[]
    }

    const moviesWithTmdb = movies.filter(m => m.tmdb_id)
    if (moviesWithTmdb.length === 0) return { completed: true, analyzed: 0, skipped: 0 }

    onProgress?.({ current: 0, total: moviesWithTmdb.length, currentItem: 'Identifying collections...', phase: 'scanning' })

    const collectionMap = new Map<number, CollectionInfo>()
    let scannedCount = 0
    const BATCH_SIZE = 10

    for (let i = 0; i < moviesWithTmdb.length; i += BATCH_SIZE) {
      if (this.isCancelled()) break
      const batch = moviesWithTmdb.slice(i, i + BATCH_SIZE)
      const detailsResults = await Promise.allSettled(batch.map(movie => tmdb.getMovieDetails(movie.tmdb_id!)))

      for (let j = 0; j < batch.length; j++) {
        const movie = batch[j]
        const result = detailsResults[j]

        if (result.status === 'fulfilled' && result.value) {
          const details: TMDBMovieDetails = result.value
          if (details.belongs_to_collection) {
            const cId = details.belongs_to_collection.id
            if (!collectionMap.has(cId)) {
              collectionMap.set(cId, { tmdbCollectionId: cId, collectionName: details.belongs_to_collection.name, ownedMovies: [] })
            }
            collectionMap.get(cId)!.ownedMovies.push(movie)
          }
        }
        scannedCount++
        onProgress?.({ current: scannedCount, total: moviesWithTmdb.length, currentItem: movie.title, phase: 'scanning' })
      }
    }

    if (collectionMap.size === 0) return { completed: true, analyzed: 0, skipped: 0 }

    const existingCollections = new Map<string, { updatedAt: string; ownedCount: number }>()
    if (skipRecentlyAnalyzed) {
      db.stats.getMovieCollections(sourceId).forEach(col => {
        if (col.updated_at && col.tmdb_collection_id) {
          existingCollections.set(col.tmdb_collection_id, { updatedAt: col.updated_at, ownedCount: col.owned_movies })
        }
      })
    }

    const collectionEntries = Array.from(collectionMap.values())
    let processedCount = 0
    let skipped = 0

    db.beginBatch()
    try {
      for (const colInfo of collectionEntries) {
        if (this.isCancelled()) break

        if (skipRecentlyAnalyzed) {
          const existing = existingCollections.get(colInfo.tmdbCollectionId.toString())
          if (existing && wasRecentlyAnalyzed(existing.updatedAt, reanalyzeAfterDays) && existing.ownedCount === colInfo.ownedMovies.length) {
            skipped++; processedCount++; continue
          }
        }

        onProgress?.({ current: processedCount + 1, total: collectionEntries.length, currentItem: colInfo.collectionName, phase: 'fetching', skipped })

        try {
          const ownedTmdbIds = colInfo.ownedMovies.map(m => m.tmdb_id).filter(Boolean) as string[]
          const result = await this.lookupCollectionCompleteness(colInfo.tmdbCollectionId.toString(), ownedTmdbIds)

          if (result) {
            db.stats.upsertMovieCollection({
              tmdb_collection_id: colInfo.tmdbCollectionId.toString(),
              collection_name: result.collectionName,
              source_id: sourceId,
              library_id: libraryId,
              total_movies: result.totalMovies,
              owned_movies: result.ownedMovies,
              missing_movies: JSON.stringify(result.missingMovies),
              owned_movie_ids: JSON.stringify(ownedTmdbIds),
              completeness_percentage: result.completenessPercentage,
              poster_url: result.posterUrl,
              backdrop_url: result.backdropUrl,
            })
          }
        } catch (error) {
          getLoggingService().error('[MovieCollectionService]', `Failed for collection "${colInfo.collectionName}":`, error)
        }
        processedCount++
      }
    } finally {
      db.endBatch()
    }

    return { completed: !this.isCancelled(), analyzed: processedCount - skipped, skipped }
  }

  getCollections(sourceId?: string): MovieCollection[] { return getDatabase().stats.getCollections(sourceId) }
  getIncompleteCollections(sourceId?: string): MovieCollection[] { return getDatabase().stats.getIncompleteCollections(sourceId) }
  async deleteCollection(id: number): Promise<boolean> { return getDatabase().stats.deleteCollection(id) }
  getStats(): any { return getDatabase().stats.getCollectionStats() }
}

let serviceInstance: MovieCollectionService | null = null
export function getMovieCollectionService(): MovieCollectionService {
  if (!serviceInstance) serviceInstance = new MovieCollectionService()
  return serviceInstance
}
