
import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { getLoggingService } from './LoggingService'
import { SeriesCompleteness } from '../types/database'
import { getErrorMessage } from './utils/errorUtils'
import { CompletenessEngine } from './CompletenessEngine'

export class SeriesCompletenessService {
  private cancelRequested = false

  cancel(): void {
    this.cancelRequested = true
  }

  /**
   * Analyze all TV series in the library
   */
  async analyzeAllSeries(sourceId?: string, libraryId?: string, onProgress?: (prog: any) => void): Promise<{
    totalSeries: number
    analyzed: number
    complete: number
    incomplete: number
    errors: string[]
  }> {
    this.cancelRequested = false
    const db = getDatabase()
    const result = { totalSeries: 0, analyzed: 0, complete: 0, incomplete: 0, errors: [] as string[] }

    try {
      const shows = db.tvShowRepo.getTVShowSummaries({ sourceId, libraryId })
      result.totalSeries = shows.length

      getLoggingService().info('[SeriesCompletenessService]', `Starting analysis for ${shows.length} series`)

      const allEpisodes = db.mediaRepo.getMediaItems({ type: 'episode', sourceId, libraryId })
      const episodesBySeries = new Map<string, any[]>()
      for (const ep of allEpisodes) {
        if (ep.series_title) {
          if (!episodesBySeries.has(ep.series_title)) episodesBySeries.set(ep.series_title, [])
          episodesBySeries.get(ep.series_title)!.push(ep)
        }
      }

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

      return result
    } catch (error) {
      getLoggingService().error('[SeriesCompletenessService]', 'Full library analysis failed:', error)
      throw error
    }
  }

  /**
   * Analyze a single TV series
   */
  async analyzeSeries(seriesTitle: string, sourceId?: string, libraryId?: string, cachedTmdbId?: string, providedEpisodes?: any[]): Promise<SeriesCompleteness | null> {
    const db = getDatabase()
    const tmdb = getTMDBService()
    const episodes = providedEpisodes || db.tvShowRepo.getTVShowEpisodes(seriesTitle, sourceId)

    if (episodes.length === 0) return null

    let tmdbId = cachedTmdbId || episodes.find(e => e.series_tmdb_id)?.series_tmdb_id
    if (!tmdbId) {
      const search = await tmdb.searchTVShow(seriesTitle)
      if (search.results.length > 0) tmdbId = String(search.results[0].id)
    }

    if (!tmdbId) {
      const unmatched = this.createUnmatchedResult(seriesTitle, episodes, sourceId || '', libraryId || '')
      db.tvShowRepo.upsertSeriesCompleteness(unmatched)
      return db.tvShowRepo.getSeriesCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    }

    try {
      const showDetails = await tmdb.getTVShowDetails(tmdbId)
      const targetEpisodes: any[] = []
      
      // Batch fetch season details
      const seasonNums = showDetails.seasons.filter(s => s.season_number > 0).map(s => s.season_number)
      const fullDetails = await tmdb.getTVShowWithSeasons(tmdbId, seasonNums)
      
      for (const sn of seasonNums) {
        const season = fullDetails[`season/${sn}`]
        if (season) targetEpisodes.push(...season.episodes)
      }

      const ownedKeys = new Set(episodes.map(e => `S${e.season_number}E${e.episode_number}`))
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

      db.tvShowRepo.upsertSeriesCompleteness(result)
      return db.tvShowRepo.getSeriesCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    } catch (error) {
      getLoggingService().error('[SeriesCompletenessService]', `Failed for series ${seriesTitle}:`, error)
      throw error
    }
  }

  private createUnmatchedResult(title: string, owned: any[], sourceId: string, libraryId: string): SeriesCompleteness {
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
