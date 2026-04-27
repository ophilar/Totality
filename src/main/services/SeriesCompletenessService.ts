
import { getDatabase } from '@main/database/getDatabase'
import { getTMDBService } from '@main/services/TMDBService'
import { getLoggingService } from '@main/services/LoggingService'
import { SeriesCompleteness, MediaItem } from '@main/types/database'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { CompletenessEngine } from '@main/services/CompletenessEngine'

export class SeriesCompletenessService {
  private cancelRequested = false

  cancel(): void {
    this.cancelRequested = true
  }

  /**
   * Analyze all TV series in the library
   */
  async analyzeAllSeries(sourceId?: string, libraryId?: string, onProgress?: (prog: { current: number, total: number, percentage: number, phase: string, currentItem: string }) => void): Promise<{
    totalSeries: number
    analyzed: number
    complete: number
    incomplete: number
    errors: string[]
    skipped?: boolean
  }> {
    this.cancelRequested = false
    const db = getDatabase()
    const tmdb = getTMDBService()
    const result = { totalSeries: 0, analyzed: 0, complete: 0, incomplete: 0, errors: [] as string[] }

    // Task Prevention: Check for TMDB API key before starting
    const tmdbApiKey = db.config.getSetting('tmdb_api_key')
    if (!tmdbApiKey) {
      getLoggingService().info('[SeriesCompletenessService]', 'TMDB API key not configured. Skipping series analysis.')
      return { ...result, skipped: true }
    }

    try {
      await tmdb.initialize()
      const shows = db.tvShows.getSummaries({ sourceId, libraryId })
      result.totalSeries = shows.length

      getLoggingService().info('[SeriesCompletenessService]', `Starting analysis for ${shows.length} series`)

      const allEpisodes = db.media.getItems({ type: 'episode', sourceId, libraryId })
      const episodesBySeries = new Map<string, any[]>()
      for (const ep of allEpisodes) {
        if (ep.series_title) {
          if (!episodesBySeries.has(ep.series_title)) episodesBySeries.set(ep.series_title, [])
          episodesBySeries.get(ep.series_title)!.push(ep)
        }
      }

      db.beginBatch()
      try {
        for (let i = 0; i < shows.length; i++) {
          if (this.cancelRequested) break
          const title = shows[i].series_title
          onProgress?.({ current: i + 1, total: shows.length, percentage: Math.round(((i + 1) / shows.length) * 100), phase: 'analyzing', currentItem: title })

          try {
            const episodes = episodesBySeries.get(title) || []
            const analysis = await this.analyzeSeries(title, sourceId, libraryId, undefined, episodes)
            if (analysis) {
              result.analyzed++
              if (analysis.completeness_percentage >= 100) result.complete++
              else result.incomplete++
            }
          } catch (error) {
            result.errors.push(`"${title}": ${getErrorMessage(error)}`)
          }
        }
      } finally {
        db.endBatch()
      }

      return result
    } catch (error) {
      getLoggingService().error('[SeriesCompletenessService]', 'Full library analysis failed:', error)
      throw error
    }
  }

  /**
   * Analyze a single TV series
   */
  async analyzeSeries(seriesTitle: string, sourceId?: string, libraryId?: string, cachedTmdbId?: string, providedEpisodes?: MediaItem[]): Promise<SeriesCompleteness | null> {
    const db = getDatabase()
    const tmdb = getTMDBService()
    const episodes = providedEpisodes || db.tvShows.getEpisodes(seriesTitle, sourceId)
    getLoggingService().info('[SeriesCompletenessService]', `Analyzing series "${seriesTitle}". Found ${episodes.length} local episodes.`)
    episodes.forEach(e => getLoggingService().info('[SeriesCompletenessService]', ` - ${e.series_title} S${e.season_number}E${e.episode_number} (id: ${e.id})`))

    if (episodes.length === 0) return null

    let tmdbId = cachedTmdbId || episodes.find(e => e.series_tmdb_id)?.series_tmdb_id
    if (!tmdbId) {
      const search = await tmdb.searchTVShow(seriesTitle)
      if (search.results.length > 0) tmdbId = String(search.results[0].id)
    }

    if (!tmdbId) {
      const unmatched = this.createUnmatchedResult(seriesTitle, episodes, sourceId || '', libraryId || '')
      db.tvShows.upsertCompleteness(unmatched)
      return db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    }

    try {
      const showDetails = await tmdb.getTVShowDetails(tmdbId)
      const targetEpisodes: any[] = []
      
      // Batch fetch season details
      const seasonNums = showDetails.seasons.filter(s => s.season_number > 0).map(s => s.season_number)
      
      // Update local DB with TMDB ID if it was missing
      for (const ep of episodes) {
        if (!ep.series_tmdb_id && ep.id) {
          // Note: we'd need a method to update series TMDB ID on episodes
        }
      }

      const fullDetails = await tmdb.getTVShowWithSeasons(tmdbId, seasonNums)
      getLoggingService().debug('[SeriesCompleteness]', 'fullDetails from TMDB fetched')
      
      for (const sn of seasonNums) {
        const season = fullDetails[`season/${sn}`]
        if (season) targetEpisodes.push(...season.episodes)
      }
      getLoggingService().debug('[SeriesCompleteness]', `targetEpisodes identified: ${targetEpisodes.length}`)

      const ownedKeys = new Set(episodes.map(e => `S${e.season_number}E${e.episode_number}`))
      getLoggingService().debug('[SeriesCompleteness]', `ownedKeys size: ${ownedKeys.size}`)
      const analysis = CompletenessEngine.calculateEpisodic(targetEpisodes, ownedKeys)

      const result: SeriesCompleteness = {
        series_title: seriesTitle,
        source_id: sourceId || '',
        library_id: libraryId || '',
        total_seasons: showDetails.number_of_seasons,
        total_episodes: analysis.total,
        owned_seasons: new Set(episodes.map(e => e.season_number)).size,
        owned_episodes: analysis.owned,
        missing_seasons: JSON.stringify(analysis.total === analysis.owned ? [] : showDetails.seasons.filter(s => s.episode_count > 0 && !episodes.some(e => e.season_number === s.season_number)).map(s => s.season_number)),
        missing_episodes: JSON.stringify(analysis.missing),
        completeness_percentage: analysis.percentage,
        tmdb_id: tmdbId,
        poster_url: tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined,
        backdrop_url: tmdb.buildImageUrl(showDetails.backdrop_path, 'original') || undefined,
        status: showDetails.status,
      }

      db.tvShows.upsertCompleteness(result)

      // Artwork update for local sources
      const source = db.sources.getSourceById(sourceId || '')
      if (source && (source.source_type === 'local' || source.source_type === 'kodi-local')) {
        const commonArtwork = {
          posterUrl: tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined,
        }

        // Group by season to batch update season posters
        const seasonPosterUrls = new Map<number, string | undefined>()
        for (const s of showDetails.seasons) {
          seasonPosterUrls.set(s.season_number, tmdb.buildImageUrl(s.poster_path, 'w500') || undefined)
        }

        // Pre-calculate all artwork data
        const artworkUpdates = episodes.map(ep => {
          const epData = targetEpisodes.find(te => te.season_number === ep.season_number && te.episode_number === ep.episode_number)
          return {
            id: ep.id!,
            artwork: {
              ...commonArtwork,
              episodeThumbUrl: epData ? tmdb.buildImageUrl(epData.still_path, 'w500') || undefined : undefined,
              seasonPosterUrl: ep.season_number != null ? seasonPosterUrls.get(ep.season_number) : undefined
            }
          }
        })

        // Apply updates
        for (const update of artworkUpdates) {
          db.media.updateItemArtwork(update.id, update.artwork)
        }
      }

      return db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    } catch (error) {
      getLoggingService().error('[SeriesCompletenessService]', `Failed for series ${seriesTitle}:`, error)
      throw error
    }
  }

  private createUnmatchedResult(title: string, owned: MediaItem[], sourceId: string, libraryId: string): SeriesCompleteness {
    return {
      series_title: title,
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: 0,
      total_episodes: 0,
      owned_seasons: new Set(owned.map(e => e.season_number)).size,
      owned_episodes: owned.length,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: 0,
    }
  }
}

let serviceInstance: SeriesCompletenessService | null = null
export function getSeriesCompletenessService(): SeriesCompletenessService {
  if (!serviceInstance) serviceInstance = new SeriesCompletenessService()
  return serviceInstance
}
