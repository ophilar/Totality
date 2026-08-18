import { getDatabase, BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getTMDBService, TMDBService } from '@main/services/TMDBService'
import { SeriesCompleteness, MediaItem, MediaItemType, ProviderType } from '@main/types/database'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { CompletenessEngine } from '@main/services/CompletenessEngine'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import type { TMDBEpisode } from '@main/types/tmdb'

interface SeriesProgress { current: number; total: number; percentage: number; phase: string; currentItem: string }
interface CompletenessEpisode { season_number: number; episode_number: number; air_date?: string; still_path?: string | null }
type SourceRecord = Awaited<ReturnType<BetterSQLiteService['sources']['getSourceById']>>

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

  async analyzeAllSeries(sourceId?: string, libraryId?: string, onProgress?: (prog: SeriesProgress) => void): Promise<{ totalSeries: number; analyzed: number; complete: number; incomplete: number; errors: string[]; completed: boolean }> {
    this.cancelRequested = false
    const result = { totalSeries: 0, analyzed: 0, complete: 0, incomplete: 0, errors: [] as string[] }

    const tmdbApiKey = await this.db.config.getSetting('tmdb_api_key')
    const source = await this.db.sources.getSourceById(sourceId || '')

    try {
      if (tmdbApiKey) await this.tmdb.initialize()
      const existingShows = await this.db.tvShows.getSummaries({ sourceId, libraryId })
      const titlesFromMedia = await this.db.media.getUniqueSeriesTitles({ sourceId, libraryId })
      
      const allCompleteness = await this.db.tvShows.getAllCompleteness(sourceId, libraryId)
      const completenessMap = new Map<string, SeriesCompleteness>()
      for (const comp of allCompleteness) {
        if (comp.series_identity_key) completenessMap.set(comp.series_identity_key, comp)
        completenessMap.set(comp.series_title, comp)
      }

      const showsToAnalyze: Array<{ series_title: string; series_identity_key?: string }> = existingShows.map((show) => ({
        series_title: show.series_title,
        series_identity_key: show.series_identity_key ?? undefined,
      }))
      const existingTitlesSet = new Set(showsToAnalyze.map((s) => s.series_title))
      for (const title of titlesFromMedia) {
        if (!existingTitlesSet.has(title)) {
          showsToAnalyze.push({ series_title: title })
          existingTitlesSet.add(title)
        }
      }

      result.totalSeries = showsToAnalyze.length

      const allEpisodes = await this.db.media.getItems({ type: MediaItemType.Episode, sourceId, libraryId })
      const episodesBySeries = new Map<string, MediaItem[]>()
      for (const ep of allEpisodes) {
        const key = ep.series_identity_key || ep.series_title
        if (key) {
          if (!episodesBySeries.has(key)) episodesBySeries.set(key, [])
          episodesBySeries.get(key)!.push(ep)
        }
      }

      await this.db.beginBatch()
      try {
        for (let i = 0; i < showsToAnalyze.length; i++) {
          if (this.cancelRequested) break
          const title = showsToAnalyze[i].series_title
          const identityKey = showsToAnalyze[i].series_identity_key
          onProgress?.({
            current: i + 1,
            total: showsToAnalyze.length,
            percentage: Math.round(((i + 1) / showsToAnalyze.length) * 100),
            phase: 'analyzing',
            currentItem: title,
          })
          try {
            const episodes = (identityKey ? episodesBySeries.get(identityKey) : null) || episodesBySeries.get(title) || []
            const existing = (identityKey ? completenessMap.get(identityKey) : null) || completenessMap.get(title) || null
            const analysis = await this.analyzeSeries(title, sourceId, libraryId, undefined, episodes, {
              tmdbApiKey,
              source,
              existingCompleteness: existing,
              returnConstructed: true,
            })
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
        await this.db.endBatch()
        getLiveMonitoringService().notifyLibraryUpdated(sourceId)
      }
      return { ...result, completed: true }
    } catch (error) {
      throw error
    }
  }

  async analyzeSeries(
    seriesTitle: string,
    sourceId?: string,
    libraryId?: string,
    cachedTmdbId?: string,
    providedEpisodes?: MediaItem[],
    prefetchedData?: {
      tmdbApiKey?: string | null;
      source?: SourceRecord;
      existingCompleteness?: SeriesCompleteness | null;
      returnConstructed?: boolean;
    }
  ): Promise<SeriesCompleteness | null> {
    const episodes = providedEpisodes || (await this.db.tvShows.getEpisodes(seriesTitle, sourceId))
    if (episodes.length === 0) return null

    const tmdbApiKey = prefetchedData?.tmdbApiKey !== undefined ? prefetchedData.tmdbApiKey : await this.db.config.getSetting('tmdb_api_key')
    let tmdbId = cachedTmdbId || episodes.find(e => e.series_tmdb_id)?.series_tmdb_id
    
    if (!tmdbId && tmdbApiKey && this.tmdb.isConfigured()) {
      const search = await this.tmdb.searchTVShow(seriesTitle)
      if (search.results.length > 0) tmdbId = String(search.results[0].id)
    }
    
    if (!tmdbId || !tmdbApiKey || !this.tmdb.isConfigured()) {
      const unmatched = await this.createUnmatchedResult(seriesTitle, episodes, sourceId || '', libraryId || '', prefetchedData?.existingCompleteness)
      await this.db.tvShows.upsertCompleteness(unmatched)
      return prefetchedData?.returnConstructed ? unmatched : await this.db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
    }

    const showDetails = await this.tmdb.getTVShowDetails(tmdbId)
    const seasonNums = showDetails.seasons.filter(s => s.season_number > 0).map(s => s.season_number)
    const fullDetails = await this.tmdb.getTVShowWithSeasons(tmdbId, seasonNums)
    
    const targetEpisodes: CompletenessEpisode[] = []
    for (const sn of seasonNums) {
      const season = fullDetails[`season/${sn}`]
      if (season) targetEpisodes.push(...season.episodes.map((episode: TMDBEpisode) => ({ season_number: episode.season_number, episode_number: episode.episode_number, air_date: episode.air_date ?? undefined, still_path: episode.still_path })))
    }

    const ownedKeys = new Set(episodes.map(e => `S${e.season_number}E${e.episode_number}`))
    const analysis = CompletenessEngine.calculateEpisodic(targetEpisodes, ownedKeys as Set<string>)

    let totalSize = 0
    let totalStorageDebt = 0
    let scoredCount = 0
    let totalEfficiencyScore = 0

    for (const ep of episodes) {
      totalSize += ep.file_size || 0
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
      owned_seasons: new Set(episodes.map(e => e.season_number)).size,
      owned_episodes: analysis.owned,
      missing_seasons: JSON.stringify(showDetails.seasons.filter(s => s.episode_count > 0 && !episodes.some(e => e.season_number === s.season_number)).map(s => s.season_number)),
      missing_episodes: JSON.stringify(analysis.missing),
      completeness_percentage: analysis.percentage,
      tmdb_id: tmdbId || undefined,
      poster_url: this.tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined,
      backdrop_url: this.tmdb.buildImageUrl(showDetails.backdrop_path, 'original') || undefined,
      status: showDetails.status,
      efficiency_score: efficiencyScore,
      storage_debt_bytes: totalStorageDebt,
      total_size: totalSize,
    }

    await this.db.tvShows.upsertCompleteness(result)

    // RESTORE ARTWORK UPDATE
    const source = prefetchedData?.source !== undefined ? prefetchedData.source : await this.db.sources.getSourceById(sourceId || '')
    if (source && (source.source_type === ProviderType.Local || source.source_type === ProviderType.KodiLocal)) {
      const seasonPosterUrls = new Map<number, string | undefined>()
      for (const s of showDetails.seasons) {
        seasonPosterUrls.set(s.season_number, this.tmdb.buildImageUrl(s.poster_path, 'w500') || undefined)
      }

      for (const ep of episodes) {
        const epData = targetEpisodes.find(te => te.season_number === ep.season_number && te.episode_number === ep.episode_number)
        await this.db.media.updateItemArtwork(ep.id!, {
          posterUrl: result.poster_url || undefined,
          episodeThumbUrl: epData ? this.tmdb.buildImageUrl(epData.still_path ?? null, 'w500') || undefined : undefined,
          seasonPosterUrl: ep.season_number != null ? seasonPosterUrls.get(ep.season_number) : undefined
        })
      }
    }

    return prefetchedData?.returnConstructed ? result : await this.db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
  }

  private async createUnmatchedResult(title: string, owned: MediaItem[], sourceId: string, libraryId: string, preFetchedExisting?: SeriesCompleteness | null): Promise<SeriesCompleteness> {
    const existing = preFetchedExisting !== undefined ? preFetchedExisting : await this.db.tvShows.getCompletenessByTitle(title, sourceId, libraryId)
    
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
      poster_url: fallbackPoster || undefined,
      tmdb_id: tmdbId || undefined,
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
