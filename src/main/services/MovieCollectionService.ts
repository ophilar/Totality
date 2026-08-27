import { getDatabase, BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getTMDBService, TMDBService } from '@main/services/TMDBService'
import { MovieCollection, MediaItemType } from '@main/types/database'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { getFileNameParser } from '@main/services/FileNameParser'
import { getLoggingService } from '@main/services/LoggingService'
import type { MediaItem } from '@main/types/database'
import type { TMDBCollectionPart } from '@main/types/tmdb'

interface CollectionProgress { current: number; total: number; phase: string; currentItem: string }
interface CollectionAnalysis { totalMovies: number; ownedMovies: number; missingMovies: string[]; completenessPercentage: number; posterUrl?: string; backdropUrl?: string }
interface CollectionMovie { title: string; year: string; tmdb_id: string; owned: boolean }

export class MovieCollectionService {
  private cancelRequested = false

  constructor(
    private _db?: BetterSQLiteService,
    private _tmdb?: TMDBService
  ) {}

  private get db(): BetterSQLiteService {
    return this._db || getDatabase()
  }

  private get tmdb(): TMDBService {
    return this._tmdb || getTMDBService()
  }

  cancel(): void {
    this.cancelRequested = true
  }

  async analyzeAllCollections(sourceId?: string, libraryId?: string, onProgress?: (prog: CollectionProgress) => void): Promise<{ total: number; analyzed: number; complete: number; errors: string[]; completed: boolean; skipped?: boolean }> {
    this.cancelRequested = false
    const result = { total: 0, analyzed: 0, complete: 0, errors: [] as string[] }

    const apiKey = await this.db.config.getSetting('tmdb_api_key')
    if (!apiKey) return { ...result, skipped: true, completed: true }

    try {
      await this.tmdb.initialize()
      
      const allMovies = await this.db.media.getItems({ type: MediaItemType.Movie, sourceId, libraryId, includeDisabledLibraries: true })
      
      const processedCollections = new Set<string>()
      const concurrency = 10

      for (let i = 0; i < allMovies.length; i += concurrency) {
        if (this.cancelRequested) break
        const chunk = allMovies.slice(i, i + concurrency)
        
        await Promise.all(chunk.map(async (m: MediaItem) => {
          if (this.cancelRequested) return

          if (!m.tmdb_id) {
            // Skip searching TMDB for extras/bonus files or non-movie clips
            const parser = getFileNameParser()
            if (parser.isExtrasContent(m.title) || parser.isExtrasContent(m.file_path || '')) {
              return
            }

            try {
              const search = await this.tmdb.searchMovie(m.title, m.year || undefined)
              if (search?.results?.length > 0) {
                const best = search.results[0]
                await this.db.media.updateMovieMatch(m.id!, String(best.id), this.tmdb.buildImageUrl(best.poster_path, 'w500') || undefined, best.title, best.release_date ? parseInt(best.release_date.split('-')[0]) : undefined)
                m.tmdb_id = String(best.id)
              }
            } catch (e) {
              getLoggingService().warn('[MovieCollectionService]', `Failed to search movie match for "${m.title}":`, e)
            }
          }

          if (m.tmdb_id && !this.cancelRequested) {
            try {
              const details = await this.tmdb.getMovieDetails(m.tmdb_id)
              if (details?.belongs_to_collection) {
                const cid = String(details.belongs_to_collection.id)
                const cacheKey = `${cid}-${m.source_id || ''}-${m.library_id || ''}`
                if (!processedCollections.has(cacheKey)) {
                  processedCollections.add(cacheKey)
                  const cDetails = await this.tmdb.getCollectionDetails(cid)
                  await this.db.movieCollections.upsertCollection({
                    tmdb_collection_id: cid,
                    collection_name: cDetails.name,
                    source_id: m.source_id || '',
                    library_id: m.library_id || '',
                    poster_url: this.tmdb.buildImageUrl(cDetails.poster_path, 'w500') || undefined,
                    backdrop_url: this.tmdb.buildImageUrl(cDetails.backdrop_path, 'original') || undefined
                  })
                }
              }
            } catch (e) {
              getLoggingService().warn('[MovieCollectionService]', `Failed to fetch collection details for movie ${m.tmdb_id} (${m.title}):`, e)
            }
          }
        }))
      }

      const collections = await this.db.movieCollections.getCollections(sourceId)
      result.total = collections.length

      let currentIndex = 0
      for (let i = 0; i < collections.length; i += concurrency) {
        if (this.cancelRequested) break
        const chunk = collections.slice(i, i + concurrency)

        await Promise.all(chunk.map(async c => {
          if (this.cancelRequested) return
          currentIndex++
          onProgress?.({ current: currentIndex, total: collections.length, phase: 'analyzing', currentItem: c.collection_name })
          try {
            const analysis = await this.analyzeCollection(c.collection_name, c.source_id, c.library_id, c.tmdb_collection_id)
            if (analysis) {
              result.analyzed++
              if (analysis.completeness_percentage >= 100) result.complete++
            }
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e)
            result.errors.push(errMsg)
            getLoggingService().warn('[MovieCollectionService]', `Failed to analyze collection "${c.collection_name}": ${errMsg}`)
          }
        }))
      }
      
      getLiveMonitoringService().notifyLibraryUpdated(sourceId)
      
      return { ...result, completed: true }
    } catch (error) { throw error }
  }

  async analyzeCollection(name: string, sourceId = '', libraryId = '', tmdbCollectionId?: string): Promise<MovieCollection | null> {
    let collectionId = tmdbCollectionId
    if (!collectionId) {
      const search = await this.tmdb.searchCollection(name)
      if (!search?.results?.length) return null
      collectionId = String(search.results[0].id)
    }

    const details = await this.tmdb.getCollectionDetails(collectionId)
    if (!details?.parts) return null
    const tmdbIds = details.parts.map(p => String(p.id))
    const ownedMap = await this.db.media.getItemsByTmdbIds(tmdbIds)

    const movies: CollectionMovie[] = details.parts.map((p: TMDBCollectionPart) => {
      const id = String(p.id)
      const isOwned = ownedMap.has(id)
      return { title: p.title, year: p.release_date?.substring(0, 4), tmdb_id: id, owned: isOwned }
    })

    const ownedCount = movies.filter(m => m.owned).length
    const result: MovieCollection = {
      collection_name: details.name,
      total_movies: movies.length,
      owned_movies: ownedCount,
      missing_movies: JSON.stringify(movies.filter(m => !m.owned)),
      completeness_percentage: movies.length > 0 ? (ownedCount / movies.length) * 100 : 0,
      tmdb_collection_id: String(details.id),
      owned_movie_ids: JSON.stringify(movies.filter(m => m.owned).map(m => m.tmdb_id)),
      source_id: sourceId,
      library_id: libraryId,
      poster_url: this.tmdb.buildImageUrl(details.poster_path, 'w500') || undefined,
      backdrop_url: this.tmdb.buildImageUrl(details.backdrop_path, 'original') || undefined,
    }

    await this.db.movieCollections.upsertCollection(result)
    return result
  }

  async getCollections(sourceId?: string) {
    return await this.db.movieCollections.getCollections(sourceId)
  }

  async getIncompleteCollections(sourceId?: string) {
    return await this.db.movieCollections.getIncompleteCollections(sourceId)
  }

  async getStats() {
    const stats = await this.db.movieCollections.getStats()
    return { total: stats.total, complete: stats.complete }
  }

  async deleteCollection(id: number) {
    return await this.db.movieCollections.deleteCollection(id)
  }

  async lookupCollectionCompleteness(tmdbId: string, ownedTmdbIds: string[]): Promise<CollectionAnalysis> {
    const details = await this.tmdb.getCollectionDetails(tmdbId)
    const parts = details.parts.filter(p => p.release_date && new Date(p.release_date) <= new Date())
    const owned = parts.filter(p => ownedTmdbIds.includes(String(p.id))).length
    return {
      totalMovies: parts.length,
      ownedMovies: owned,
      completenessPercentage: parts.length > 0 ? (owned / parts.length) * 100 : 0,
      missingMovies: parts.filter(p => !ownedTmdbIds.includes(String(p.id))).map(p => p.title),
      posterUrl: this.tmdb.buildImageUrl(details.poster_path, 'w500') || undefined,
      backdropUrl: this.tmdb.buildImageUrl(details.backdrop_path, 'original') || undefined
    }
  }

  async getMoviesDeduplicatedByTmdbId(): Promise<MediaItem[]> {
    const allMovies = await this.db.media.getItems({ type: MediaItemType.Movie, includeDisabledLibraries: true })
    const map = new Map<string, MediaItem>()
    for (const m of allMovies) {
      if (!m.tmdb_id) continue
      const existing = map.get(m.tmdb_id)
      if (!existing || (m.video_bitrate || 0) > (existing.video_bitrate || 0)) {
        map.set(m.tmdb_id, m)
      }
    }
    return Array.from(map.values())
  }
}

let instance: MovieCollectionService | null = null
export function getMovieCollectionService(): MovieCollectionService {
  return instance ??= new MovieCollectionService()
}
