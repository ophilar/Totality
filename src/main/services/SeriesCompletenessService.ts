import { getDatabase, BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getTMDBService, TMDBService } from '@main/services/TMDBService'
import { SeriesCompleteness, MediaItem, MediaItemType, ProviderType } from '@main/types/database'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { CompletenessEngine } from '@main/services/CompletenessEngine'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import type { TMDBEpisode } from '@main/types/tmdb'

export function isPlaceholderEpisodeTitle(title?: string | null): boolean {
  if (!title || !title.trim()) return true
  const trimmed = title.trim()
  return (
    /^Episode\s+\d+$/i.test(trimmed) ||
    /^Episode\s+\d+\s*-\s*Episode\s+\d+$/i.test(trimmed) ||
    /^S\d+\s*E\d+$/i.test(trimmed) ||
    /^\d+x\d+$/i.test(trimmed) ||
    /^Episode$/i.test(trimmed)
  )
}

interface SeriesProgress { current: number; total: number; percentage: number; phase: string; currentItem: string }
interface CompletenessEpisode { season_number: number; episode_number: number; title?: string; name?: string; air_date?: string; still_path?: string | null; overview?: string; id?: number }
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
    const tmdbEpisodeMap = new Map<string, TMDBEpisode>()
    for (const sn of seasonNums) {
      const season = fullDetails[`season/${sn}`]
      if (season && Array.isArray(season.episodes)) {
        for (const ep of season.episodes) {
          tmdbEpisodeMap.set(`S${ep.season_number}E${ep.episode_number}`, ep)
          targetEpisodes.push({
            season_number: ep.season_number,
            episode_number: ep.episode_number,
            title: ep.name,
            name: ep.name,
            air_date: ep.air_date ?? undefined,
            still_path: ep.still_path,
            overview: ep.overview,
            id: ep.id
          })
        }
      }
    }

    const ownedKeys = new Set(episodes.map(e => `S${e.season_number}E${e.episode_number}`))
    const analysis = CompletenessEngine.calculateEpisodic(targetEpisodes, ownedKeys as Set<string>)

    let totalSize = 0
    let totalStorageDebt = 0
    let scoredSize = 0
    let weightedEfficiencyNumerator = 0
    let scoredCount = 0
    let totalEfficiencyScore = 0

    for (const ep of episodes) {
      const epSize = ep.file_size || 0
      totalSize += epSize
      totalStorageDebt += ep.storage_debt_bytes || 0
      if (ep.efficiency_score !== undefined && ep.efficiency_score !== null && ep.efficiency_score >= 0) {
        weightedEfficiencyNumerator += ep.efficiency_score * epSize
        totalEfficiencyScore += ep.efficiency_score
        scoredSize += epSize
        scoredCount++
      }
    }

    const efficiencyScore = scoredCount > 0
      ? (scoredSize > 0 ? Math.round(weightedEfficiencyNumerator / scoredSize) : Math.round(totalEfficiencyScore / scoredCount))
      : 0

    const existing = prefetchedData?.existingCompleteness !== undefined
      ? prefetchedData.existingCompleteness
      : await this.db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')

    const externalIds = fullDetails.external_ids || (showDetails as { external_ids?: { imdb_id?: string | null; tvdb_id?: number | string | null } }).external_ids
    const resolvedTvdbId = existing?.tvdb_id || (externalIds?.tvdb_id ? String(externalIds.tvdb_id) : undefined)
    const resolvedImdbId = externalIds?.imdb_id ? String(externalIds.imdb_id) : undefined

    const result: SeriesCompleteness = {
      id: existing?.id,
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
      tmdb_id: tmdbId || existing?.tmdb_id || undefined,
      tvdb_id: resolvedTvdbId,
      poster_url: this.tmdb.buildImageUrl(showDetails.poster_path, 'w500') || existing?.poster_url || undefined,
      backdrop_url: this.tmdb.buildImageUrl(showDetails.backdrop_path, 'original') || existing?.backdrop_url || undefined,
      status: showDetails.status,
      user_fixed_match: existing?.user_fixed_match,
      efficiency_score: efficiencyScore,
      storage_debt_bytes: totalStorageDebt,
      total_size: totalSize,
    }

    const completenessId = await this.db.tvShows.upsertCompleteness(result)
    const entityId = completenessId || existing?.id

    // Backfill external IDs to identities table if not locked by user
    if (entityId) {
      const isLocked = await this.db.identities.isLocked('series', entityId)
      const existingIdentities = await this.db.identities.getIdentities('series', entityId)

      if (!isLocked) {
        if (result.tmdb_id) {
          const tmdbIdent = existingIdentities.find(i => i.provider === 'tmdb')
          if (!tmdbIdent || (!tmdbIdent.locked && tmdbIdent.externalId !== result.tmdb_id)) {
            await this.db.identities.upsertIdentity({ entityType: 'series', entityId, provider: 'tmdb', externalId: result.tmdb_id, locked: false })
          }
        }
        if (resolvedTvdbId) {
          const tvdbIdent = existingIdentities.find(i => i.provider === 'tvdb')
          if (!tvdbIdent || (!tvdbIdent.locked && tvdbIdent.externalId !== resolvedTvdbId)) {
            await this.db.identities.upsertIdentity({ entityType: 'series', entityId, provider: 'tvdb', externalId: resolvedTvdbId, locked: false })
          }
        }
        if (resolvedImdbId) {
          const imdbIdent = existingIdentities.find(i => i.provider === 'imdb')
          if (!imdbIdent || (!imdbIdent.locked && imdbIdent.externalId !== resolvedImdbId)) {
            await this.db.identities.upsertIdentity({ entityType: 'series', entityId, provider: 'imdb', externalId: resolvedImdbId, locked: false })
          }
        }
      }
    }

    // Infill missing episode metadata and artwork
    const seasonPosterUrls = new Map<number, string | undefined>()
    for (const s of showDetails.seasons) {
      seasonPosterUrls.set(s.season_number, this.tmdb.buildImageUrl(s.poster_path, 'w500') || undefined)
    }

    for (const ep of episodes) {
      if (ep.user_fixed_match) continue // Respect user locks on episodes
      if (!ep.id) continue

      const epKey = `S${ep.season_number}E${ep.episode_number}`
      const tmdbEp = tmdbEpisodeMap.get(epKey)

      const updates: {
        title?: string
        year?: number
        summary?: string
        posterUrl?: string
        episodeThumbUrl?: string
        seasonPosterUrl?: string
        seriesTmdbId?: string
        tmdbId?: string
        imdbId?: string
      } = {}
      let needsUpdate = false

      // 1. Backfill missing/placeholder title
      if (isPlaceholderEpisodeTitle(ep.title) && tmdbEp?.name) {
        updates.title = tmdbEp.name
        needsUpdate = true
      }

      // 2. Backfill air date / year
      if ((ep.year == null || ep.year === 0) && tmdbEp?.air_date) {
        const airYear = parseInt(tmdbEp.air_date.split('-')[0], 10)
        if (!isNaN(airYear)) {
          updates.year = airYear
          needsUpdate = true
        }
      }

      // 3. Backfill overview / summary
      if ((!ep.summary || ep.summary.trim() === '') && tmdbEp?.overview) {
        updates.summary = tmdbEp.overview
        needsUpdate = true
      }

      // 4. Backfill episode thumbnail
      if (!ep.episode_thumb_url && tmdbEp?.still_path) {
        const thumb = this.tmdb.buildImageUrl(tmdbEp.still_path, 'w500') || undefined
        if (thumb) {
          updates.episodeThumbUrl = thumb
          needsUpdate = true
        }
      }

      // 5. Backfill season poster
      const seasonPoster = ep.season_number != null ? seasonPosterUrls.get(ep.season_number) : undefined
      if (!ep.season_poster_url && seasonPoster) {
        updates.seasonPosterUrl = seasonPoster
        needsUpdate = true
      }

      // 6. Backfill series poster
      if (!ep.poster_url && result.poster_url) {
        updates.posterUrl = result.poster_url
        needsUpdate = true
      }

      // 7. Backfill series TMDB ID
      if (!ep.series_tmdb_id && result.tmdb_id) {
        updates.seriesTmdbId = result.tmdb_id
        needsUpdate = true
      }

      // 8. Backfill episode TMDB ID
      if (!ep.tmdb_id && tmdbEp?.id) {
        updates.tmdbId = String(tmdbEp.id)
        needsUpdate = true
      }

      if (needsUpdate) {
        await this.db.media.updateEpisodeMetadata(ep.id, updates)
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
    let scoredSize = 0
    let weightedEfficiencyNumerator = 0
    let scoredCount = 0
    let totalEfficiencyScore = 0

    for (const ep of owned) {
      const epSize = (ep as { size?: number }).size || ep.file_size || 0
      totalSize += epSize
      totalStorageDebt += ep.storage_debt_bytes || 0
      if (ep.efficiency_score !== undefined && ep.efficiency_score !== null && ep.efficiency_score >= 0) {
        weightedEfficiencyNumerator += ep.efficiency_score * epSize
        totalEfficiencyScore += ep.efficiency_score
        scoredSize += epSize
        scoredCount++
      }
    }

    const efficiencyScore = scoredCount > 0
      ? (scoredSize > 0 ? Math.round(weightedEfficiencyNumerator / scoredSize) : Math.round(totalEfficiencyScore / scoredCount))
      : 0

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

