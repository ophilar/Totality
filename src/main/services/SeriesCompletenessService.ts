import { getDatabase, BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getTMDBService, TMDBService } from '@main/services/TMDBService'
import { SeriesCompleteness, MediaItem, MediaItemType, ProviderType } from '@main/types/database'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { CompletenessEngine } from '@main/services/CompletenessEngine'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'

export class SeriesCompletenessService {
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

  async analyzeAllSeries(sourceId?: string, libraryId?: string, onProgress?: (prog: any) => void): Promise<any> {
    this.cancelRequested = false
    const result = { totalSeries: 0, analyzed: 0, complete: 0, incomplete: 0, errors: [] as string[] }

    const tmdbApiKey = await this.db.config.getSetting('tmdb_api_key')

    try {
      if (tmdbApiKey) await this.tmdb.initialize()
      const existingShows = await this.db.tvShows.getSummaries({ sourceId, libraryId })
      const titlesFromMedia = await this.db.media.getUniqueSeriesTitles({ sourceId, libraryId })
      
      const showsToAnalyze: Array<{ series_title: string }> = [...existingShows]
      for (const title of titlesFromMedia) {
        if (!showsToAnalyze.some(s => s.series_title === title)) {
          showsToAnalyze.push({ series_title: title })
        }
      }

      result.totalSeries = showsToAnalyze.length

      const allEpisodes = await this.db.media.getItems({ type: MediaItemType.Episode, sourceId, libraryId })
      const episodesBySeries = new Map<string, any[]>()
      for (const ep of allEpisodes) {
        if (ep.series_title) {
          if (!episodesBySeries.has(ep.series_title)) episodesBySeries.set(ep.series_title, [])
          episodesBySeries.get(ep.series_title)!.push(ep)
        }
      }

      await this.db.beginBatch()
      try {
        for (let i = 0; i < showsToAnalyze.length; i++) {
          if (this.cancelRequested) break
          const title = showsToAnalyze[i].series_title
          onProgress?.({ current: i + 1, total: showsToAnalyze.length, percentage: Math.round(((i + 1) / showsToAnalyze.length) * 100), phase: 'analyzing', currentItem: title })
          try {
            const episodes = episodesBySeries.get(title) || []
            const analysis = await this.analyzeSeries(title, sourceId, libraryId, undefined, episodes)
            if (analysis) {
              result.analyzed++
              if (analysis.completeness_percentage >= 100) result.complete++
              else result.incomplete++
            }
          } catch (error) { result.errors.push(`"${title}": ${getErrorMessage(error)}`) }
        }
      } finally { 
        await this.db.endBatch() 
        getLiveMonitoringService().notifyLibraryUpdated(sourceId)
      }
      return { ...result, completed: true }
    } catch (error) { throw error }
  }

  async analyzeSeries(seriesTitle: string, sourceId?: string, libraryId?: string, cachedTmdbId?: string, providedEpisodes?: MediaItem[]): Promise<SeriesCompleteness | null> {
    const episodes = providedEpisodes || (await this.db.tvShows.getEpisodes(seriesTitle, sourceId))
    if (episodes.length === 0) return null

    const tmdbApiKey = await this.db.config.getSetting('tmdb_api_key')
    let tmdbId = cachedTmdbId || episodes.find((e: any) => e.series_tmdb_id)?.series_tmdb_id
    
    if (!tmdbId && tmdbApiKey && this.tmdb.isConfigured()) {
      const search = await this.tmdb.searchTVShow(seriesTitle)
      if (search.results.length > 0) tmdbId = String(search.results[0].id)
    }
    
    if (!tmdbId || !tmdbApiKey || !this.tmdb.isConfigured()) {
      const unmatched = await this.createUnmatchedResult(seriesTitle, episodes, sourceId || '', libraryId || '')
      await this.db.tvShows.upsertCompleteness(unmatched)
      return await this.db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    }

    const showDetails = await this.tmdb.getTVShowDetails(tmdbId)
    const seasonNums = showDetails.seasons.filter((s: any) => s.season_number > 0).map((s: any) => s.season_number)
    const fullDetails = await this.tmdb.getTVShowWithSeasons(tmdbId, seasonNums)
    
    const targetEpisodes: any[] = []
    for (const sn of seasonNums) {
      const season = fullDetails[`season/${sn}`]
      if (season) targetEpisodes.push(...season.episodes)
    }

    const ownedKeys = new Set(episodes.map((e: any) => `S${e.season_number}E${e.episode_number}`))
    const analysis = CompletenessEngine.calculateEpisodic(targetEpisodes, ownedKeys as Set<string>)

    let totalSize = 0
    let totalStorageDebt = 0
    let scoredCount = 0
    let totalEfficiencyScore = 0

    for (const ep of episodes) {
      totalSize += ep.size || ep.file_size || 0
      totalStorageDebt += ep.storage_debt_bytes || 0
      if (ep.efficiency_score !== undefined && ep.efficiency_score > 0) {
        totalEfficiencyScore += ep.efficiency_score
        scoredCount++
      }
    }

    const efficiencyScore = scoredCount > 0 ? Math.round(totalEfficiencyScore / scoredCount) : 0

    const result: SeriesCompleteness = {
      series_title: seriesTitle,
      source_id: sourceId || '',
      library_id: libraryId || '',
      total_seasons: showDetails.number_of_seasons,
      total_episodes: analysis.total,
      owned_seasons: new Set(episodes.map((e: any) => e.season_number)).size,
      owned_episodes: analysis.owned,
      missing_seasons: JSON.stringify(showDetails.seasons.filter((s: any) => s.episode_count > 0 && !episodes.some((e: any) => e.season_number === s.season_number)).map((s: any) => s.season_number)),
      missing_episodes: JSON.stringify(analysis.missing),
      completeness_percentage: analysis.percentage,
      tmdb_id: tmdbId,
      poster_url: this.tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined,
      backdrop_url: this.tmdb.buildImageUrl(showDetails.backdrop_path, 'original') || undefined,
      status: showDetails.status,
      efficiency_score: efficiencyScore,
      storage_debt_bytes: totalStorageDebt,
      total_size: totalSize,
    }

    await this.db.tvShows.upsertCompleteness(result)

    // RESTORE ARTWORK UPDATE
    const source = await this.db.sources.getSourceById(sourceId || '')
    if (source && (source.source_type === ProviderType.Local || source.source_type === ProviderType.KodiLocal)) {
      const seasonPosterUrls = new Map<number, string | undefined>()
      for (const s of showDetails.seasons) {
        seasonPosterUrls.set(s.season_number, this.tmdb.buildImageUrl(s.poster_path, 'w500') || undefined)
      }

      for (const ep of episodes) {
        const epData = targetEpisodes.find(te => te.season_number === ep.season_number && te.episode_number === ep.episode_number)
        await this.db.media.updateItemArtwork(ep.id!, {
          posterUrl: result.poster_url,
          episodeThumbUrl: epData ? this.tmdb.buildImageUrl(epData.still_path, 'w500') || undefined : undefined,
          seasonPosterUrl: ep.season_number != null ? seasonPosterUrls.get(ep.season_number) : undefined
        })
      }
    }

    return await this.db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
  }

  private async createUnmatchedResult(title: string, owned: MediaItem[], sourceId: string, libraryId: string): Promise<SeriesCompleteness> {
    const existing = await this.db.tvShows.getCompletenessByTitle(title, sourceId, libraryId)
    
    const fallbackPoster = existing?.poster_url || owned.find(e => e.poster_url)?.poster_url
    const tmdbId = existing?.tmdb_id || owned.find(e => e.series_tmdb_id)?.series_tmdb_id

    let totalSize = 0
    let totalStorageDebt = 0
    let scoredCount = 0
    let totalEfficiencyScore = 0

    for (const ep of owned) {
      totalSize += (ep as { size?: number }).size || ep.file_size || 0
      totalStorageDebt += ep.storage_debt_bytes || 0
      if (ep.efficiency_score !== undefined && ep.efficiency_score > 0) {
        totalEfficiencyScore += ep.efficiency_score
        scoredCount++
      }
    }

    const efficiencyScore = scoredCount > 0 ? Math.round(totalEfficiencyScore / scoredCount) : 0

    return {
      series_title: title,
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: new Set(owned.map(e => e.season_number)).size,
      total_episodes: owned.length,
      owned_seasons: new Set(owned.map(e => e.season_number)).size,
      owned_episodes: owned.length,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: -1, // MAGIC VALUE for unmatched/no-data
      poster_url: fallbackPoster,
      tmdb_id: tmdbId,
      status: existing?.status || 'Continuing',
      efficiency_score: efficiencyScore,
      storage_debt_bytes: totalStorageDebt,
      total_size: totalSize
    }
  }
}

let serviceInstance: SeriesCompletenessService | null = null
export function getSeriesCompletenessService(): SeriesCompletenessService {
  return serviceInstance ??= new SeriesCompletenessService()
}
