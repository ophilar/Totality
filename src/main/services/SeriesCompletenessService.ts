/**
 * SeriesCompletenessService
 *
 * Background service for analyzing TV series completeness against TMDB data.
 * Identifies missing episodes and seasons in the user's library.
 */

import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from './TMDBService'
import { getLoggingService } from './LoggingService'
import { SeriesCompleteness } from '../types/database'
import { getErrorMessage } from './utils/errorUtils'

interface EpisodeInfo {
  seasonNumber: number
  episodeNumber: number
  airDate?: string
}

interface AnalysisResult {
  totalSeasons: number
  totalEpisodes: number
  ownedSeasons: number
  ownedEpisodes: number
  missingSeasons: number[]
  missingEpisodes: Array<{ season_number: number; episode_number: number; air_date?: string }>
  completenessPercentage: number
  tmdbId?: string
  posterUrl?: string
  backdropUrl?: string
  status?: string
}

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
    const result = {
      totalSeries: 0,
      analyzed: 0,
      complete: 0,
      incomplete: 0,
      errors: [] as string[]
    }

    try {
      const filters: any = {}
      if (sourceId) filters.sourceId = sourceId
      if (libraryId) filters.libraryId = libraryId

      const shows = db.getTVShows(filters)
      const seriesTitles = shows.map(s => s.series_title)
      result.totalSeries = seriesTitles.length

      getLoggingService().info('[SeriesCompletenessService]', `Starting analysis for ${seriesTitles.length} series`)

      // Optimization: Fetch all episodes for this source/library in one go and group by series
      const allEpisodes = db.getMediaItems({ type: 'episode', sourceId, libraryId })
      const episodesBySeries = new Map<string, any[]>()
      for (const ep of allEpisodes) {
        if (ep.series_title) {
          if (!episodesBySeries.has(ep.series_title)) episodesBySeries.set(ep.series_title, [])
          episodesBySeries.get(ep.series_title)!.push(ep)
        }
      }

      for (let i = 0; i < seriesTitles.length; i++) {
        if (this.cancelRequested) {
          getLoggingService().info('[SeriesCompletenessService]', 'Analysis cancelled by user')
          break
        }

        const title = seriesTitles[i]
        try {
          onProgress?.({
            current: i + 1,
            total: seriesTitles.length,
            percentage: Math.round(((i + 1) / seriesTitles.length) * 100),
            phase: 'analyzing',
            currentItem: title
          })

          const episodes = episodesBySeries.get(title) || []
          const analysis = await this.analyzeSeries(title, sourceId, libraryId, undefined, episodes)
          
          if (analysis) {
            result.analyzed++
            if (analysis.completeness_percentage >= 100) {
              result.complete++
            } else {
              result.incomplete++
            }
          }
        } catch (error) {
          getLoggingService().error('[SeriesCompletenessService]', `Error analyzing series "${title}":`, error)
          result.errors.push(`"${title}": ${getErrorMessage(error)}`)
        }
      }

      getLoggingService().info('[SeriesCompletenessService]', `Analysis complete: ${result.complete} complete, ${result.incomplete} incomplete`)
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
    const episodes = providedEpisodes || db.getEpisodesForSeries(seriesTitle, sourceId, libraryId)

    if (episodes.length === 0) {
      getLoggingService().info('[SeriesCompletenessService]', `No episodes found for series: ${seriesTitle}`)
      return null
    }

    // Extract episode info
    const ownedEpisodes: EpisodeInfo[] = episodes.map((ep: any) => ({
      seasonNumber: ep.season_number || 0,
      episodeNumber: ep.episode_number || 0,
    }))
    // Use cached TMDB ID if available, otherwise look it up
    const tmdbId = cachedTmdbId || await this.findTMDBShowId(seriesTitle, episodes)

    if (!tmdbId) {
      getLoggingService().info('[SeriesCompletenessService]', `Could not find TMDB ID for series: ${seriesTitle}`)
      // Store with null data - user can manually match later
      const unmatchedResult = this.createUnmatchedResult(seriesTitle, ownedEpisodes, sourceId || '', libraryId || '')
      await db.upsertSeriesCompleteness(unmatchedResult)
      return db.getSeriesCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    }

    // Check if source is a local drive (kodi-local or local) - these need artwork from TMDB
    let updateArtwork = false
    if (sourceId) {
      const source = db.getMediaSourceById(sourceId)
      if (source && (source.source_type === 'kodi-local' || source.source_type === 'local')) {
        updateArtwork = true
        getLoggingService().info('[SeriesCompletenessService]', `Will update artwork for local source: ${sourceId}`)
      }
    }

    // Analyze completeness against TMDB data
    try {
      const analysis = await this.calculateMissing(tmdbId, ownedEpisodes, updateArtwork ? episodes : undefined, updateArtwork ? sourceId : undefined)

      const result: SeriesCompleteness = {
        series_title: seriesTitle,
        source_id: sourceId || '',
        library_id: libraryId || '',
        total_seasons: analysis.totalSeasons,
        total_episodes: analysis.totalEpisodes,
        owned_seasons: analysis.ownedSeasons,
        owned_episodes: analysis.ownedEpisodes,
        missing_seasons: JSON.stringify(analysis.missingSeasons),
        missing_episodes: JSON.stringify(analysis.missingEpisodes),
        completeness_percentage: analysis.completenessPercentage,
        tmdb_id: analysis.tmdbId || undefined,
        poster_url: analysis.posterUrl || undefined,
        backdrop_url: analysis.backdropUrl || undefined,
        status: analysis.status || undefined,
      }

      await db.upsertSeriesCompleteness(result)
      return db.getSeriesCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    } catch (error) {
      getLoggingService().error('[SeriesCompletenessService]', `Failed to analyze series ${seriesTitle}:`, error)
      throw error
    }
  }

  private async findTMDBShowId(title: string, episodes: any[]): Promise<string | null> {
    const tmdb = getTMDBService()
    try {
      // 1. Try TMDB ID from media items if any
      const existingTmdbId = episodes.find(e => e.series_tmdb_id)?.series_tmdb_id
      if (existingTmdbId) return String(existingTmdbId)

      // 2. Search by title
      const results = await tmdb.searchTVShow(title)
      if (results.results.length > 0) {
        return String(results.results[0].id)
      }
      return null
    } catch (error) { throw error }
  }

  private async calculateMissing(tmdbId: string, owned: EpisodeInfo[], episodesForArtwork?: any[], sourceId?: string): Promise<AnalysisResult> {
    const tmdb = getTMDBService()
    const db = getDatabase()
    const showDetails = await tmdb.getTVShowDetails(tmdbId)

    const totalSeasons = showDetails.number_of_seasons
    const totalEpisodes = showDetails.number_of_episodes
    const missingEpisodes: Array<{ season_number: number; episode_number: number; air_date?: string }> = []
    const missingSeasons: number[] = []

    // Map owned episodes for fast lookup
    const ownedMap = new Set(owned.map(e => `S${e.seasonNumber}E${e.episodeNumber}`))

    // If updating artwork, prepare maps
    const artworkUpdates: Array<{ id: number; poster?: string; thumb?: string; season?: string }> = []

    // Check each season
    let ownedSeasonsCount = 0
    for (const season of showDetails.seasons) {
      if (season.season_number === 0) continue // Skip specials for now

      let ownedInSeason = 0
      const seasonDetails = await tmdb.getSeasonDetails(tmdbId, season.season_number)

      for (const ep of seasonDetails.episodes) {
        const key = `S${ep.season_number}E${ep.episode_number}`
        if (ownedMap.has(key)) {
          ownedInSeason++

          // Update local file artwork if needed
          if (episodesForArtwork) {
            const matches = episodesForArtwork.filter(e => e.season_number === ep.season_number && e.episode_number === ep.episode_number)
            for (const m of matches) {
              artworkUpdates.push({
                id: m.id,
                poster: tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined,
                thumb: tmdb.buildImageUrl(ep.still_path, 'w500') || undefined,
                season: tmdb.buildImageUrl(season.poster_path, 'w500') || undefined
              })
            }
          }
        } else {
          // Check if air date is in the past
          const airDate = ep.air_date ? new Date(ep.air_date) : null
          if (airDate && airDate <= new Date()) {
            missingEpisodes.push({
              season_number: ep.season_number,
              episode_number: ep.episode_number,
              air_date: ep.air_date || undefined
            })
          }
        }
      }

      if (ownedInSeason > 0) {
        ownedSeasonsCount++
      } else if (season.episode_count > 0) {
        // Only mark as missing if there are aired episodes in the season
        const airDate = season.air_date ? new Date(season.air_date) : null
        if (airDate && airDate <= new Date()) {
          missingSeasons.push(season.season_number)
        }
      }
    }

    // Apply artwork updates in batch if needed
    if (artworkUpdates.length > 0 && sourceId) {
      getLoggingService().info('[SeriesCompletenessService]', `Updating artwork for ${artworkUpdates.length} local episodes`)
      db.startBatch()
      try {
        for (const update of artworkUpdates) {
          db.updateMediaItemArtwork(update.id, {
            posterUrl: update.poster,
            episodeThumbUrl: update.thumb,
            seasonPosterUrl: update.season
          })
        }
      } finally {
        db.endBatch()
      }
    }

    return {
      totalSeasons,
      totalEpisodes,
      ownedSeasons: ownedSeasonsCount,
      ownedEpisodes: owned.length,
      missingSeasons,
      missingEpisodes,
      completenessPercentage: totalEpisodes > 0 ? (owned.length / totalEpisodes) * 100 : 100,
      tmdbId,
      posterUrl: tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined,
      backdropUrl: tmdb.buildImageUrl(showDetails.backdrop_path, 'original') || undefined,
      status: showDetails.status
    }
  }

  private createUnmatchedResult(title: string, owned: EpisodeInfo[], sourceId: string, libraryId: string): SeriesCompleteness {
    return {
      series_title: title,
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: 0,
      total_episodes: 0,
      owned_seasons: new Set(owned.map(e => e.seasonNumber)).size,
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
