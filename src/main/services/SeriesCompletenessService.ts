import { getDatabase, BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getTMDBService, TMDBService } from '@main/services/TMDBService'
import { SeriesCompleteness, MediaItem, MediaItemType, type AnalysisOutcome, type AnalysisDiagnostic, type AnalysisStatus } from '@main/types/database'
import { getErrorMessage, parseDatabaseError } from '@main/services/utils/errorUtils'
import { CompletenessEngine } from '@main/services/CompletenessEngine'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { getLoggingService } from '@main/services/LoggingService'
import { getFileNameParser } from '@main/services/FileNameParser'
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

  async analyzeAllSeries(sourceId?: string, libraryId?: string, onProgress?: (prog: SeriesProgress) => void): Promise<AnalysisOutcome & { totalSeries: number; analyzed: number; complete: number; incomplete: number }> {
    this.cancelRequested = false
    const result = { totalSeries: 0, analyzed: 0, complete: 0, incomplete: 0, errors: [] as string[], diagnostics: [] as AnalysisDiagnostic[] }

    const tmdbApiKey = await this.db.config.getSetting('tmdb_api_key')
    const source = await this.db.sources.getSourceById(sourceId || '')
    if (tmdbApiKey) await this.tmdb.initialize()

    const parser = getFileNameParser()
    const allEpisodes = await this.db.media.getItems({ type: MediaItemType.Episode, sourceId, libraryId })
    const seriesByNormalizedTitle = new Map<string, { title: string; episodes: MediaItem[] }>()

    for (const episode of allEpisodes) {
      if (!episode.series_title) continue
      const normalizedTitle = parser.normalizeSeriesTitle(episode.series_title)
      if (!normalizedTitle) continue
      const seriesKey = episode.series_identity_key || normalizedTitle

      const series = seriesByNormalizedTitle.get(seriesKey)
      if (series) {
        series.episodes.push(episode)
      } else {
        seriesByNormalizedTitle.set(seriesKey, {
          title: episode.series_title,
          episodes: [episode],
        })
      }
    }

    const allCompleteness = await this.db.tvShows.getAllCompleteness(sourceId, libraryId)
    const completenessByNormalizedTitle = new Map<string, SeriesCompleteness>()
    for (const completeness of allCompleteness) {
      const normalizedTitle = parser.normalizeSeriesTitle(completeness.series_title)
      if (normalizedTitle) {
        const seriesKey = completeness.series_identity_key || normalizedTitle
        completenessByNormalizedTitle.set(seriesKey, completeness)
      }
    }

    const seriesToAnalyze = Array.from(seriesByNormalizedTitle.entries())
    result.totalSeries = seriesToAnalyze.length

    try {
      for (let i = 0; i < seriesToAnalyze.length; i++) {
        if (this.cancelRequested) break
        await new Promise(r => setImmediate(r))

        const [normalizedTitle, series] = seriesToAnalyze[i]
        onProgress?.({
          current: i + 1,
          total: seriesToAnalyze.length,
          percentage: Math.round(((i + 1) / seriesToAnalyze.length) * 100),
          phase: 'analyzing',
          currentItem: series.title,
        })

        try {
          const analysis = await this.analyzeSeries(series.title, sourceId, libraryId, undefined, series.episodes, {
            tmdbApiKey,
            source,
            existingCompleteness: completenessByNormalizedTitle.get(normalizedTitle) ?? null,
            returnConstructed: true,
          })
          if (analysis) {
            result.analyzed++
            if (analysis.completeness_percentage != null) {
              if (analysis.completeness_percentage >= 100) result.complete++
              else result.incomplete++
            }
          }
        } catch (error) {
          const parsed = parseDatabaseError(error)
          const errDetail = `"${series.title}": ${getErrorMessage(error)}`
          result.errors.push(errDetail)
          result.diagnostics.push({
            itemType: 'series',
            itemName: series.title,
            category: parsed.isDatabaseError ? 'database' : 'provider',
            code: parsed.code || (parsed.isDatabaseError ? (parsed.constraint ? `CONSTRAINT_${parsed.constraint.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}` : 'DATABASE_ERROR') : 'PROVIDER_ERROR'),
            message: errDetail,
            cause: parsed.cause,
            provider: parsed.isDatabaseError ? undefined : 'tmdb',
            retryable: false,
            item: series.title,
            kind: parsed.isDatabaseError ? 'database' : 'provider',
          } as AnalysisDiagnostic & { item?: string; kind?: string })
          getLoggingService().warn('[SeriesCompleteness]', `Failed to analyze series ${errDetail}`, error)
        }
      }
    } finally {
      await this.db.tvShows.mergeDuplicateShows(sourceId, libraryId)
      getLiveMonitoringService().notifyLibraryUpdated(sourceId)
    }

    const completedCount = result.analyzed
    const failedCount = result.errors.length
    const deferredCount = seriesToAnalyze.length - (result.analyzed + result.errors.length)
    const status: AnalysisStatus = this.cancelRequested
      ? 'cancelled'
      : result.analyzed === 0 && result.errors.length > 0
        ? 'failed'
        : result.errors.length > 0
          ? 'partial'
          : 'completed'
    return {
      ...result,
      processedCount: result.analyzed,
      totalCount: result.totalSeries,
      status,
      completedCount,
      deferredCount,
      failedCount,
      completed: status === 'completed',
    } as AnalysisOutcome & { totalSeries: number; analyzed: number; complete: number; incomplete: number }
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
    const episodes = providedEpisodes ?? (await this.db.tvShows.getEpisodes(seriesTitle, sourceId, undefined, libraryId))
    if (episodes.length === 0) return null

    const effectiveSourceId = sourceId || episodes[0]?.source_id || ''
    const effectiveLibraryId = libraryId || episodes[0]?.library_id || ''

    const tmdbApiKey = prefetchedData?.tmdbApiKey !== undefined ? prefetchedData.tmdbApiKey : await this.db.config.getSetting('tmdb_api_key')
    const existing = prefetchedData?.existingCompleteness
    const imdbId = episodes.find(e => e.imdb_id)?.imdb_id

    const persistedExisting = existing ?? await this.db.tvShows.getCompletenessByTitle(seriesTitle, effectiveSourceId, effectiveLibraryId)
    const existingIdentities = persistedExisting?.id ? await this.db.identities.getIdentities('series', persistedExisting.id) : []
    const tmdbIdent = existingIdentities.find(i => i.provider === 'tmdb')
    const isLocked = Boolean(tmdbIdent?.locked || persistedExisting?.user_fixed_match)

    let tmdbId: string | undefined
    let staleTmdbIdForCleanup: string | undefined
    let showDetails: Awaited<ReturnType<TMDBService['getTVShowDetails']>> | null = null

    if (isLocked) {
      tmdbId = tmdbIdent?.externalId || persistedExisting?.tmdb_id || undefined
      if (tmdbId && this.tmdb.isConfigured()) {
        showDetails = await this.tmdb.getTVShowDetails(tmdbId)
      }
    } else {
      const storedTmdbId = cachedTmdbId || persistedExisting?.tmdb_id || episodes.find(e => e.series_tmdb_id)?.series_tmdb_id || episodes.find(e => e.tmdb_id)?.tmdb_id
      if (storedTmdbId && this.tmdb.isConfigured()) {
        try {
          showDetails = await this.tmdb.getTVShowDetails(storedTmdbId)
          tmdbId = storedTmdbId
        } catch (e: unknown) {
          const errWithStatus = e as { status?: number; message?: string }
          if (errWithStatus?.status === 404 || errWithStatus?.message?.includes('could not be found')) {
            getLoggingService().info('[SeriesCompleteness]', `Stale TMDB show ID ${storedTmdbId} for "${seriesTitle}", clearing and falling back...`)
            staleTmdbIdForCleanup = storedTmdbId
          } else {
            throw e
          }
        }
      }

      if (!tmdbId && imdbId && this.tmdb.isConfigured()) {
        try {
          const found = await this.tmdb.findByExternalId(imdbId, 'imdb_id')
          if (found.tv_results && found.tv_results.length === 1) {
            const candidateId = String(found.tv_results[0].id)
            try {
              showDetails = await this.tmdb.getTVShowDetails(candidateId)
              tmdbId = candidateId
            } catch (verifErr) {
              getLoggingService().warn('[SeriesCompleteness]', `Verification failed for IMDb candidate ${candidateId} on "${seriesTitle}":`, verifErr)
            }
          }
        } catch (error) {
          getLoggingService().warn('[SeriesCompleteness]', `IMDb lookup failed for "${seriesTitle}"`, error)
        }
      }

      if (!tmdbId && this.tmdb.isConfigured()) {
        try {
          const search = await this.tmdb.searchTVShow(seriesTitle)
          const knownYear = episodes.find(e => e.year)?.year
          const candidates = knownYear
            ? search.results.filter(r => r.first_air_date?.startsWith(String(knownYear)))
            : (search.results.length === 1 ? search.results : [])
          if (candidates.length === 1) {
            const candidateId = String(candidates[0].id)
            try {
              showDetails = await this.tmdb.getTVShowDetails(candidateId)
              tmdbId = candidateId
            } catch (verifErr) {
              getLoggingService().warn('[SeriesCompleteness]', `Verification failed for title search candidate ${candidateId} on "${seriesTitle}":`, verifErr)
            }
          }
        } catch (error) {
          getLoggingService().warn('[SeriesCompleteness]', `Search failed for "${seriesTitle}"`, error)
        }
      }
    }

    if (!tmdbId || !showDetails || !Array.isArray(showDetails.seasons) || !tmdbApiKey || !this.tmdb.isConfigured()) {
      const unmatched = await this.createUnmatchedResult(seriesTitle, episodes, effectiveSourceId, effectiveLibraryId, prefetchedData?.existingCompleteness, staleTmdbIdForCleanup)
      await this.db.withBatch(async () => {
        if (staleTmdbIdForCleanup && persistedExisting?.id && !isLocked) {
          await this.db.identities.deleteIdentity('series', persistedExisting.id, 'tmdb', staleTmdbIdForCleanup)
          await this.db.tvShows.clearTmdbId(persistedExisting.id)
        }
        if (staleTmdbIdForCleanup && !isLocked) {
          for (const ep of episodes) {
            if (ep.id && !ep.user_fixed_match && (ep.series_tmdb_id === staleTmdbIdForCleanup || ep.tmdb_id === staleTmdbIdForCleanup)) {
              await this.db.media.updateEpisodeMetadata(ep.id, { seriesTmdbId: undefined, tmdbId: undefined })
            }
          }
        }
        await this.db.tvShows.upsertCompleteness(unmatched)
      })
      return prefetchedData?.returnConstructed ? unmatched : await this.db.tvShows.getCompletenessByTitle(seriesTitle, effectiveSourceId, effectiveLibraryId)
    }

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
    let knownStorageDebtCount = 0
    let scoredSize = 0
    let weightedEfficiencyNumerator = 0
    let scoredCount = 0
    let totalEfficiencyScore = 0

    for (const ep of episodes) {
      const epSize = ep.file_size || 0
      totalSize += epSize
      if (ep.storage_debt_bytes !== undefined && ep.storage_debt_bytes !== null) {
        totalStorageDebt += ep.storage_debt_bytes
        knownStorageDebtCount++
      }
      if (ep.efficiency_score !== undefined && ep.efficiency_score !== null && ep.efficiency_score >= 0) {
        weightedEfficiencyNumerator += ep.efficiency_score * epSize
        totalEfficiencyScore += ep.efficiency_score
        scoredSize += epSize
        scoredCount++
      }
    }

    const efficiencyScore = scoredCount > 0
      ? (scoredSize > 0 ? Math.round(weightedEfficiencyNumerator / scoredSize) : Math.round(totalEfficiencyScore / scoredCount))
      : null

    const externalIds = fullDetails.external_ids || (showDetails as { external_ids?: { imdb_id?: string | null; tvdb_id?: number | string | null } }).external_ids
    const resolvedTvdbId = persistedExisting?.tvdb_id || (externalIds?.tvdb_id ? String(externalIds.tvdb_id) : undefined)
    const resolvedImdbId = externalIds?.imdb_id ? String(externalIds.imdb_id) : undefined

    const result: SeriesCompleteness = {
      id: persistedExisting?.id,
      series_title: seriesTitle,
      source_id: effectiveSourceId,
      library_id: effectiveLibraryId,
      total_seasons: showDetails.number_of_seasons,
      total_episodes: analysis.total,
      owned_seasons: new Set(episodes.map(e => e.season_number)).size,
      owned_episodes: analysis.owned,
      missing_seasons: JSON.stringify(showDetails.seasons.filter(s => s.episode_count > 0 && !episodes.some(e => e.season_number === s.season_number)).map(s => s.season_number)),
      missing_episodes: JSON.stringify(analysis.missing),
      completeness_percentage: analysis.percentage,
      tmdb_id: tmdbId || persistedExisting?.tmdb_id || undefined,
      tvdb_id: resolvedTvdbId,
      poster_url: this.tmdb.buildImageUrl(showDetails.poster_path, 'w500') || persistedExisting?.poster_url || undefined,
      backdrop_url: this.tmdb.buildImageUrl(showDetails.backdrop_path, 'original') || persistedExisting?.backdrop_url || undefined,
      status: showDetails.status,
      user_fixed_match: persistedExisting?.user_fixed_match,
      efficiency_score: efficiencyScore ?? undefined,
      storage_debt_bytes: knownStorageDebtCount === episodes.length ? totalStorageDebt : undefined,
      total_size: totalSize,
    }

    await this.db.withBatch(async () => {
      if (staleTmdbIdForCleanup && persistedExisting?.id) {
        await this.db.identities.deleteIdentity('series', persistedExisting.id, 'tmdb', staleTmdbIdForCleanup)
      }
      const cId = await this.db.tvShows.upsertCompleteness(result)
      const entityId = cId || persistedExisting?.id

      if (entityId && !isLocked) {
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
          originalLanguage?: string
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
        if (result.tmdb_id && ep.series_tmdb_id !== result.tmdb_id) {
          updates.seriesTmdbId = result.tmdb_id
          needsUpdate = true
        }

        // 8. Backfill episode TMDB ID
        if (!ep.tmdb_id && tmdbEp?.id) {
          updates.tmdbId = String(tmdbEp.id)
          needsUpdate = true
        }

        // 9. Backfill original language
        const origLang = (showDetails as { original_language?: string }).original_language
        if (!ep.original_language && origLang) {
          updates.originalLanguage = origLang
          needsUpdate = true
        }

        if (needsUpdate) {
          await this.db.media.updateEpisodeMetadata(ep.id, updates)
        }
      }

      return cId
    })

    return prefetchedData?.returnConstructed ? result : await this.db.tvShows.getCompletenessByTitle(seriesTitle, sourceId || '', libraryId || '')
  }

  private async createUnmatchedResult(title: string, owned: MediaItem[], sourceId: string, libraryId: string, preFetchedExisting?: SeriesCompleteness | null, invalidTmdbId?: string): Promise<SeriesCompleteness> {
    const existing = preFetchedExisting !== undefined ? preFetchedExisting : await this.db.tvShows.getCompletenessByTitle(title, sourceId, libraryId)

    if (existing?.completeness_percentage != null && existing.tmdb_id !== invalidTmdbId) return existing

    const posterUrl = existing?.poster_url ?? owned.find(e => e.poster_url)?.poster_url
    const tmdbId = existing?.tmdb_id && existing.tmdb_id !== invalidTmdbId
      ? existing.tmdb_id
      : owned.find(e => e.series_tmdb_id && e.series_tmdb_id !== invalidTmdbId)?.series_tmdb_id
    const totalSize = owned.reduce((sum, ep) => sum + ((ep as { size?: number }).size ?? ep.file_size ?? 0), 0)

    return {
      id: existing?.id,
      series_title: title,
      source_id: sourceId,
      library_id: libraryId,
      total_seasons: new Set(owned.map(e => e.season_number)).size,
      total_episodes: owned.length,
      owned_seasons: new Set(owned.map(e => e.season_number)).size,
      owned_episodes: owned.length,
      missing_seasons: '[]',
      missing_episodes: '[]',
      completeness_percentage: null,
      poster_url: posterUrl ?? undefined,
      tmdb_id: tmdbId ?? undefined,
      status: existing?.status,
      efficiency_score: null,
      storage_debt_bytes: null,
      evidence_status: 'insufficient',
      confidence: 'none',
      savings_basis: 'insufficient_data',
      total_size: totalSize,
    }
  }
}

let serviceInstance: SeriesCompletenessService | null = null
export function getSeriesCompletenessService(): SeriesCompletenessService {
  return serviceInstance ??= new SeriesCompletenessService()
}
