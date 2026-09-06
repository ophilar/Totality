import { z } from 'zod'
import { getSeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getTMDBService } from '@main/services/TMDBService'
import { MetadataRegistryService } from '@main/services/metadata/MetadataRegistryService'
import { getWindowFromEvent } from '@main/ipc/utils/safeSend'
import { createProgressUpdater } from '@main/ipc/utils/progressUpdater'
import { NonEmptyStringSchema, OptionalSourceIdSchema, PositiveIntSchema, SeriesAnalyzeAllTupleSchema, SeriesGetSeasonDetailsTupleSchema, SeriesGetEpisodeStillTupleSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { getDeduplicationService } from '@main/services/DeduplicationService'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'
import type { MediaItem } from '@main/types/database'

import { getStatsCacheService } from '@main/services/StatsCacheService'

const ScopedStringSchema = z.string().min(1).max(200)

const SeriesIdentityTupleSchema = z.tuple([
  NonEmptyStringSchema,
  ScopedStringSchema,
  NonEmptyStringSchema,
  ScopedStringSchema,
])

const SeriesFixMatchTupleSchema = z.tuple([
  NonEmptyStringSchema,
  ScopedStringSchema,
  NonEmptyStringSchema,
  ScopedStringSchema,
  NonEmptyStringSchema,
  NonEmptyStringSchema,
])

function collectAudioLanguages(episodes: MediaItem[]): string[] {
  const languages = new Set<string>()
  for (const ep of episodes) {
    if (ep.audio_tracks) {
      try {
        const tracks = JSON.parse(ep.audio_tracks) as Array<{ language?: string; lang?: string }>
        if (Array.isArray(tracks)) {
          for (const track of tracks) {
            const lang = (track.language || track.lang || '').trim().toLowerCase()
            if (lang) languages.add(lang)
          }
        }
      } catch (error) {
        getLoggingService().error('[series]', `Failed to parse audio tracks for media item ${ep.id ?? 'unknown'}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (ep.audio_language) {
      const lang = ep.audio_language.trim().toLowerCase()
      if (lang) languages.add(lang)
    }
  }
  return Array.from(languages)
}

export function registerSeriesHandlers() {
  const service = getSeriesCompletenessService()
  const db = getDatabase()
  const tmdb = getTMDBService()

  async function analyzeIdentityScoped(
    title: string,
    sourceId: string,
    seriesIdentityKey: string,
    libraryId: string,
    providedEpisodes?: MediaItem[]
  ) {
    const episodes = providedEpisodes ?? await db.tvShows.getEpisodes(title, sourceId, seriesIdentityKey, libraryId)
    if (episodes.length === 0) return null

    const completenessRows = await db.tvShows.getAllCompleteness(sourceId, libraryId)
    const existingCompleteness = completenessRows.find(row => row.series_identity_key === seriesIdentityKey) ?? null

    const res = await service.analyzeSeries(title, sourceId, libraryId, undefined, episodes, {
      existingCompleteness,
      returnConstructed: true,
    })
    getStatsCacheService().invalidate()
    return res
  }

  createValidatedIpcHandlerWithEvent('series:analyzeAll', SeriesAnalyzeAllTupleSchema, async (event, sourceId, libraryId) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'series:progress', 'media')
    try {
      const res = await service.analyzeAllSeries(sourceId, libraryId, onProgress)
      getStatsCacheService().invalidate()
      return res
    } finally { flush() }
  })

  createIpcHandler('series:cancelAnalysis', async () => {
    service.cancel()
    return { success: true }
  })

  createValidatedIpcHandler('series:analyzeByIdentity', SeriesIdentityTupleSchema, async (title, sourceId, seriesIdentityKey, libraryId) => {
    return await analyzeIdentityScoped(title, sourceId, seriesIdentityKey, libraryId)
  })

  createValidatedIpcHandler('series:getAll', OptionalSourceIdSchema, async (sourceId) => {
    return await db.tvShows.getAllCompleteness(sourceId)
  })

  createValidatedIpcHandler('series:getIncomplete', OptionalSourceIdSchema, async (sourceId) => {
    return await db.tvShows.getIncomplete(sourceId)
  })

  createIpcHandler('series:getStats', async () => {
    return await getStatsCacheService().getSeriesStats(() => db.stats.getLibraryStats())
  })

  createValidatedIpcHandler('series:getEpisodesByIdentity', SeriesIdentityTupleSchema, async (title, sourceId, seriesIdentityKey, libraryId) => {
    return await db.tvShows.getEpisodes(title, sourceId, seriesIdentityKey, libraryId)
  })

  createValidatedIpcHandler('series:getAudioLanguagesByIdentity', SeriesIdentityTupleSchema, async (title, sourceId, seriesIdentityKey, libraryId) => {
    const episodes = await db.tvShows.getEpisodes(title, sourceId, seriesIdentityKey, libraryId)
    return collectAudioLanguages(episodes)
  })

  createValidatedIpcHandler('series:delete', PositiveIntSchema, async (id) => {
    await db.tvShows.deleteCompleteness(id)
    getStatsCacheService().invalidate()
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

  createValidatedIpcHandler('series:fixMatch', SeriesFixMatchTupleSchema, async (title, sourceId, seriesIdentityKey, libraryId, providerId, externalId) => {
    const completenessRows = await db.tvShows.getAllCompleteness(sourceId, libraryId)
    const existingCompleteness = completenessRows.find(row => row.series_identity_key === seriesIdentityKey)
    if (!existingCompleteness?.id) {
      throw new Error(`Series identity "${seriesIdentityKey}" does not exist in source "${sourceId}" library "${libraryId}"`)
    }

    const details = await MetadataRegistryService.getInstance()
      .getCompositeProvider()
      .getDetails(externalId, 'tv')

    if (!details) {
      throw new Error(`Could not find details for ${providerId}:${externalId}`)
    }

    const resolvedTmdbId = providerId === 'tmdb' ? externalId : details.externalIds?.tmdbId
    const resolvedTvdbId = providerId === 'tvdb' ? externalId : details.externalIds?.tvdbId
    const resolvedImdbId = providerId === 'omdb' || providerId === 'imdb' ? externalId : details.externalIds?.imdbId
    const resolvedAnilistId = providerId === 'anilist' ? externalId : details.externalIds?.anilistId
    const tmdbId = resolvedTmdbId == null ? null : String(resolvedTmdbId)
    const tvdbId = resolvedTvdbId == null ? null : String(resolvedTvdbId)
    const imdbId = resolvedImdbId == null ? null : String(resolvedImdbId)
    const anilistId = resolvedAnilistId == null ? null : String(resolvedAnilistId)

    if (!tmdbId && !tvdbId && !imdbId && !anilistId) {
      throw new Error('An authoritative external ID (TMDB, TVDB, IMDb, or AniList) could not be resolved for this match')
    }

    const canonicalKey = deriveSeriesIdentityKey({
      sourceId,
      libraryId,
      folderRelativePath: details.title,
      tmdbId,
      tvdbId,
    })
    const duplicateCompleteness = completenessRows.find(row =>
      row.id !== existingCompleteness.id && (
        row.series_identity_key === canonicalKey
        || Boolean(tmdbId && row.tmdb_id === tmdbId)
        || Boolean(tvdbId && row.tvdb_id === tvdbId)
      )
    )
    if (duplicateCompleteness) {
      throw new Error(`Selected match already belongs to TV series identity "${duplicateCompleteness.series_identity_key}" in this library`)
    }

    const identities = [
      tmdbId ? { provider: 'tmdb', externalId: tmdbId } : null,
      tvdbId ? { provider: 'tvdb', externalId: tvdbId } : null,
      imdbId ? { provider: 'imdb', externalId: imdbId } : null,
      anilistId ? { provider: 'anilist', externalId: anilistId } : null,
    ].filter((identity): identity is { provider: string; externalId: string } => identity !== null)

    const episodes = await db.tvShows.getEpisodes(title, sourceId, seriesIdentityKey, libraryId)
    const poster = details.posterUrl || null

    await db.db.execute('BEGIN IMMEDIATE')
    try {
      await db.db.execute({
        sql: `UPDATE media_items
              SET series_identity_key = ?, series_title = ?, series_tmdb_id = ?,
                  poster_url = COALESCE(?, poster_url), user_fixed_match = 1, updated_at = datetime('now')
              WHERE type = 'episode' AND source_id = ? AND library_id = ? AND series_identity_key = ?`,
        args: [canonicalKey, details.title, tmdbId, poster, sourceId, libraryId, seriesIdentityKey],
      })
      await db.db.execute({
        sql: `UPDATE series_completeness
              SET series_title = ?, series_identity_key = ?, tmdb_id = ?, tvdb_id = ?,
                  poster_url = COALESCE(?, poster_url), user_fixed_match = 1, updated_at = datetime('now')
              WHERE id = ? AND source_id = ? AND library_id = ? AND series_identity_key = ?`,
        args: [details.title, canonicalKey, tmdbId, tvdbId, poster, existingCompleteness.id, sourceId, libraryId, seriesIdentityKey],
      })

      for (const identity of identities) {
        await db.identities.upsertIdentity({
          entityType: 'series',
          entityId: existingCompleteness.id,
          provider: identity.provider,
          externalId: identity.externalId,
          locked: true,
          lockSource: 'manual',
        })
      }
      for (const alias of details.alternateTitles || []) {
        await db.identities.addAlias({ entityType: 'series', entityId: existingCompleteness.id, alias, provider: providerId })
      }

      await db.db.execute('COMMIT')
    } catch (error) {
      await db.db.execute('ROLLBACK')
      throw error
    }

    await getDeduplicationService().scanForDuplicates(sourceId)
    const completeness = await analyzeIdentityScoped(details.title, sourceId, canonicalKey, libraryId)
    getStatsCacheService().invalidate()
    return { success: true, updatedEpisodes: episodes.length, completeness, newTitle: details.title }
  })

  getLoggingService().info('[series]', 'Series completeness IPC handlers registered')
}
