import { getSeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getTMDBService } from '@main/services/TMDBService'
import { getWindowFromEvent } from '@main/ipc/utils/safeSend'
import { createProgressUpdater } from '@main/ipc/utils/progressUpdater'
import { NonEmptyStringSchema, OptionalSourceIdSchema, PositiveIntSchema, SeriesAnalyzeAllTupleSchema, SeriesGetEpisodesTupleSchema, SeriesGetSeasonDetailsTupleSchema, SeriesGetEpisodeStillTupleSchema, SeriesFixMatchTupleSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { getDeduplicationService } from '@main/services/DeduplicationService'

export function registerSeriesHandlers() {
  const service = getSeriesCompletenessService()
  const db = getDatabase()
  const tmdb = getTMDBService()

  createValidatedIpcHandlerWithEvent('series:analyzeAll', SeriesAnalyzeAllTupleSchema, async (event, sourceId, libraryId) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'series:progress', 'media')
    try { return await service.analyzeAllSeries(sourceId, libraryId, onProgress) } finally { flush() }
  })

  createIpcHandler('series:cancelAnalysis', async () => {
    service.cancel()
    return { success: true }
  })

  createValidatedIpcHandler('series:analyze', NonEmptyStringSchema, async (title) => {
    return await service.analyzeSeries(title)
  })

  createValidatedIpcHandler('series:getAll', OptionalSourceIdSchema, async (sourceId) => {
    return await db.tvShows.getAllCompleteness(sourceId)
  })

  createValidatedIpcHandler('series:getIncomplete', OptionalSourceIdSchema, async (sourceId) => {
    return await db.tvShows.getIncomplete(sourceId)
  })

  createIpcHandler('series:getStats', async () => {
    return await db.stats.getLibraryStats()
  })

  createValidatedIpcHandler('series:getEpisodes', SeriesGetEpisodesTupleSchema, async (title, sourceId) => {
    return await db.tvShows.getEpisodes(title, sourceId)
  })

  createValidatedIpcHandler('series:delete', PositiveIntSchema, async (id) => {
    await db.tvShows.deleteCompleteness(id)
    return true
  })

  createValidatedIpcHandler('tmdb:getTVShowDetails', NonEmptyStringSchema, async (tmdbId) => {
    const d = await tmdb.getTVShowDetails(tmdbId)
    return { overview: d.overview || null }
  })

  createValidatedIpcHandler('tmdb:getMovieDetails', NonEmptyStringSchema, async (tmdbId) => {
    const d = await tmdb.getMovieDetails(tmdbId)
    return { overview: d.overview || null, releaseDate: d.release_date || null, runtime: d.runtime || null }
  })

  createValidatedIpcHandler('series:getSeasonDetails', SeriesGetSeasonDetailsTupleSchema, async (tmdbId, season) => {
    const d = await tmdb.getSeasonDetails(tmdbId, season)
    return { overview: d.overview || null, episodeCount: d.episodes?.length || 0, airDate: d.air_date || null, name: d.name || null }
  })

  createValidatedIpcHandler('series:getSeasonPoster', SeriesGetSeasonDetailsTupleSchema, async (tmdbId, season) => {
    const d = await tmdb.getSeasonDetails(tmdbId, season)
    return tmdb.buildImageUrl(d.poster_path, 'w500')
  })

  createValidatedIpcHandler('series:getEpisodeStill', SeriesGetEpisodeStillTupleSchema, async (tmdbId, season, episode) => {
    const d = await tmdb.getSeasonDetails(tmdbId, season)
    const ep = d.episodes.find(e => e.episode_number === episode)
    return ep ? tmdb.buildImageUrl(ep.still_path, 'w300') : null
  })

  createValidatedIpcHandler('series:searchTMDB', NonEmptyStringSchema, async (query) => {
    await tmdb.initialize()
    const res = await tmdb.searchTVShow(query)
    return res.results.map(s => ({ id: s.id, name: s.name, first_air_date: s.first_air_date, overview: s.overview, poster_url: tmdb.buildImageUrl(s.poster_path, 'w500'), vote_average: s.vote_average }))
  })

  createValidatedIpcHandler('series:fixMatch', SeriesFixMatchTupleSchema, async (title, sourceId, tmdbId) => {
    await tmdb.initialize()
    const d = await tmdb.getTVShowDetails(tmdbId.toString())
    const poster = tmdb.buildImageUrl(d.poster_path, 'w500') || undefined
    const updated = await db.media.updateSeriesMatch(title, sourceId, tmdbId.toString(), poster, d.name)
    await getDeduplicationService().scanForDuplicates(sourceId)
    const completeness = await service.analyzeSeries(d.name, sourceId)
    return { success: true, updatedEpisodes: updated, completeness, newTitle: d.name }
  })

  getLoggingService().info('[series]', 'Series completeness IPC handlers registered')
}

