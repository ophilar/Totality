import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { z } from 'zod'
import { getSeriesCompletenessService } from '../services/SeriesCompletenessService'
import { getDatabase } from '../database/getDatabase'
import { getTMDBService } from '../services/TMDBService'
import { getWindowFromEvent } from './utils/safeSend'
import { createProgressUpdater } from './utils/progressUpdater'
import { validateInput, NonEmptyStringSchema, OptionalSourceIdSchema, PositiveIntSchema, CanonicalSeriesIdentityKeySchema } from '../validation/schemas'
import { getTaskQueueService } from '../services/TaskQueueService'
import { createIpcHandler, createIpcHandlerWithEvent } from './utils/createHandler'


/**
 * Register all series completeness IPC handlers
 */
export function registerSeriesHandlers() {
  // ============================================================================
  // SERIES COMPLETENESS ANALYSIS
  // ============================================================================

  /**
   * Analyze all series in the library for completeness
   * @param sourceId Optional source ID to scope analysis
   * @param libraryId Optional library ID to scope analysis
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.seriesAnalyzeAll, async (event, sourceId?: unknown, libraryId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'series:analyzeAll.sourceId') : undefined
    const validLibraryId = libraryId !== undefined ? validateInput(NonEmptyStringSchema, libraryId, 'series:analyzeAll.libraryId') : undefined

    // Guard: prevent concurrent analysis for the same source/library
    if (getTaskQueueService().hasActiveTask('series-completeness', validSourceId, validLibraryId)) {
      throw new Error('A series analysis is already in progress for this library')
    }

    const win = getWindowFromEvent(event)
    const service = getSeriesCompletenessService()
    const { onProgress, flush } = createProgressUpdater(win, 'series:progress', 'media')

    try {
      const result = await service.analyzeAllSeries((progress) => {
        onProgress(progress)
      }, validSourceId, validLibraryId)

      return result
    } catch (error) {
      console.error('Error analyzing series completeness:', error)
      throw error
    } finally {
      flush()
    }
  })

  /**
   * Cancel series analysis
   */
  createIpcHandler(IPC_CHANNELS.seriesCancelAnalysis, async () => {
    try {
      const service = getSeriesCompletenessService()
      service.cancel()
      return { success: true }
    } catch (error) {
      console.error('Error cancelling series analysis:', error)
      throw error
    }
  })

  /**
   * Analyze a single series by canonical identity key
   */
  createIpcHandler(IPC_CHANNELS.seriesAnalyzeByIdentity, async (seriesIdentityKey: unknown, sourceId?: unknown, libraryId?: unknown) => {
    const validIdentityKey = validateInput(NonEmptyStringSchema, seriesIdentityKey, 'series:analyzeByIdentity.seriesIdentityKey')
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'series:analyzeByIdentity.sourceId') : undefined
    const validLibraryId = libraryId !== undefined ? validateInput(NonEmptyStringSchema, libraryId, 'series:analyzeByIdentity.libraryId') : undefined
    try {
      const service = getSeriesCompletenessService()
      return await service.analyzeSeries(validIdentityKey, validSourceId, validLibraryId)
    } catch (error) {
      console.error(`Error analyzing series by identity "${validIdentityKey}":`, error)
      throw error
    }
  })

  /**
   * Analyze a single series by canonical identity key
   */
  createIpcHandler(IPC_CHANNELS.seriesAnalyze, async (seriesIdentityKey: unknown, sourceId?: unknown, libraryId?: unknown) => {
    const validKey = validateInput(NonEmptyStringSchema, seriesIdentityKey, 'series:analyze.seriesIdentityKey')
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'series:analyze.sourceId') : undefined
    const validLibraryId = libraryId !== undefined ? validateInput(NonEmptyStringSchema, libraryId, 'series:analyze.libraryId') : undefined
    try {
      const service = getSeriesCompletenessService()
      return await service.analyzeSeries(validKey, validSourceId, validLibraryId)
    } catch (error) {
      console.error(`Error analyzing series "${validKey}":`, error)
      throw error
    }
  })

  // ============================================================================
  // SERIES COMPLETENESS DATA
  // ============================================================================

  /**
   * Get all series completeness records
   */
  createIpcHandler(IPC_CHANNELS.seriesGetAll, async (sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'series:getAll.sourceId') : undefined
    try {
      const db = getDatabase()
      return db.getSeriesCompleteness(validSourceId)
    } catch (error) {
      console.error('Error getting series completeness:', error)
      throw error
    }
  })

  /**
   * Get incomplete series only
   * @param sourceId Optional source ID to filter by
   */
  createIpcHandler(IPC_CHANNELS.seriesGetIncomplete, async (sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'series:getIncomplete.sourceId') : undefined
    try {
      const db = getDatabase()
      return db.getIncompleteSeries(validSourceId)
    } catch (error) {
      console.error('Error getting incomplete series:', error)
      throw error
    }
  })

  /**
   * Get series completeness statistics
   */
  createIpcHandler(IPC_CHANNELS.seriesGetStats, async () => {
    try {
      const db = getDatabase()
      return db.getSeriesCompletenessStats()
    } catch (error) {
      console.error('Error getting series stats:', error)
      throw error
    }
  })

  /**
   * Get episodes for a specific series by canonical identity key
   */
  createIpcHandler(IPC_CHANNELS.seriesGetEpisodes, async (seriesIdentityKey: unknown, sourceId?: unknown, explicitKey?: unknown, libraryId?: unknown) => {
    const rawKey = (explicitKey || seriesIdentityKey) as string
    const validKey = validateInput(NonEmptyStringSchema, rawKey, 'series:getEpisodes.seriesIdentityKey')
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'series:getEpisodes.sourceId') : undefined
    const validLibraryId = libraryId !== undefined ? validateInput(NonEmptyStringSchema, libraryId, 'series:getEpisodes.libraryId') : undefined

    if (!validKey.startsWith('tmdb:') && !validKey.startsWith('tvdb:') && !validKey.startsWith('unresolved:')) {
      throw new Error(`series:getEpisodes requires a canonical series identity key (received: "${validKey}"). Title-based queries are not permitted.`)
    }

    try {
      const db = getDatabase()
      return db.getEpisodes('', validSourceId || '', validKey, validLibraryId || '')
    } catch (error) {
      console.error(`Error getting episodes for identity "${validKey}":`, error)
      throw error
    }
  })

  /**
   * Get episodes for a series scoped by identity
   */
  createIpcHandler(IPC_CHANNELS.seriesGetEpisodesByIdentity, async (seriesTitle: unknown, sourceId: unknown, seriesIdentityKey: unknown, libraryId: unknown) => {
    const validTitle = validateInput(NonEmptyStringSchema, seriesTitle, 'series:getEpisodesByIdentity.seriesTitle')
    const validSourceId = validateInput(NonEmptyStringSchema, sourceId, 'series:getEpisodesByIdentity.sourceId')
    const validIdentityKey = validateInput(NonEmptyStringSchema, seriesIdentityKey, 'series:getEpisodesByIdentity.seriesIdentityKey')
    const validLibraryId = validateInput(NonEmptyStringSchema, libraryId, 'series:getEpisodesByIdentity.libraryId')
    try {
      const db = getDatabase()
      return db.getEpisodes(validTitle, validSourceId, validIdentityKey, validLibraryId)
    } catch (error) {
      console.error(`Error getting episodes for identity "${validIdentityKey}":`, error)
      throw error
    }
  })

  /**
   * Get audio languages for a series scoped by identity
   */
  createIpcHandler(IPC_CHANNELS.seriesGetAudioLanguagesByIdentity, async (seriesTitle: unknown, sourceId: unknown, seriesIdentityKey: unknown, libraryId: unknown) => {
    const validTitle = validateInput(NonEmptyStringSchema, seriesTitle, 'series:getAudioLanguagesByIdentity.seriesTitle')
    const validSourceId = validateInput(NonEmptyStringSchema, sourceId, 'series:getAudioLanguagesByIdentity.sourceId')
    const validIdentityKey = validateInput(NonEmptyStringSchema, seriesIdentityKey, 'series:getAudioLanguagesByIdentity.seriesIdentityKey')
    const validLibraryId = validateInput(NonEmptyStringSchema, libraryId, 'series:getAudioLanguagesByIdentity.libraryId')
    try {
      const db = getDatabase()
      const episodes = db.getEpisodes(validTitle, validSourceId, validIdentityKey, validLibraryId)
      const languages = new Set<string>()
      for (const ep of episodes) {
        if (ep.audio_language) languages.add(ep.audio_language)
        if (ep.audio_tracks) {
          try {
            const tracks = JSON.parse(ep.audio_tracks) as Array<{ language?: string }>
            for (const t of tracks) {
              if (t.language) languages.add(t.language)
            }
          } catch {
            // ignore
          }
        }
      }
      return Array.from(languages)
    } catch (error) {
      console.error(`Error getting audio languages for identity "${validIdentityKey}":`, error)
      throw error
    }
  })

  /**
   * Delete a series completeness record
   */
  createIpcHandler(IPC_CHANNELS.seriesDelete, async (id: unknown) => {
    const validId = validateInput(PositiveIntSchema, id, 'series:delete.id')
    try {
      const db = getDatabase()
      return await db.deleteSeriesCompleteness(validId)
    } catch (error) {
      console.error(`Error deleting series completeness ${validId}:`, error)
      throw error
    }
  })

  // ============================================================================
  // TMDB ARTWORK FETCHING
  // ============================================================================

  /**
   * Get TV show details from TMDB (overview for series view)
   */
  createIpcHandler(IPC_CHANNELS.tmdbGetTVShowDetails, async (tmdbId: unknown) => {
    const validTmdbId = validateInput(NonEmptyStringSchema, tmdbId, 'tmdb:getTVShowDetails')
    try {
      const tmdb = getTMDBService()
      const details = await tmdb.getTVShowDetails(validTmdbId)
      return {
        overview: details.overview || null,
        backdropPath: details.backdrop_path || null,
      }
    } catch (error) {
      console.error(`Error fetching TV show details for ${validTmdbId}:`, error)
      return null
    }
  })

  /**
   * Get movie details from TMDB (overview for missing movie popup)
   */
  createIpcHandler(IPC_CHANNELS.tmdbGetMovieDetails, async (tmdbId: unknown) => {
    const validTmdbId = validateInput(NonEmptyStringSchema, tmdbId, 'tmdb:getMovieDetails')
    try {
      const tmdb = getTMDBService()
      const details = await tmdb.getMovieDetails(validTmdbId)
      return {
        overview: details.overview || null,
        releaseDate: details.release_date || null,
        runtime: details.runtime || null,
        backdropPath: details.backdrop_path || null,
      }
    } catch (error) {
      console.error(`Error fetching movie details for ${validTmdbId}:`, error)
      return null
    }
  })

  /**
   * Get season details from TMDB (overview, episode count, air date)
   */
  createIpcHandler(IPC_CHANNELS.seriesGetSeasonDetails, async (tmdbId: unknown, seasonNumber: unknown) => {
    const validTmdbId = validateInput(NonEmptyStringSchema, tmdbId, 'series:getSeasonDetails.tmdbId')
    const validSeasonNumber = validateInput(z.number().int().nonnegative(), seasonNumber, 'series:getSeasonDetails.seasonNumber')
    try {
      const tmdb = getTMDBService()
      const seasonDetails = await tmdb.getSeasonDetails(validTmdbId, validSeasonNumber)
      return {
        overview: seasonDetails.overview || null,
        episodeCount: seasonDetails.episodes?.length || 0,
        airDate: seasonDetails.air_date || null,
        name: seasonDetails.name || null,
      }
    } catch (error) {
      console.error(`Error fetching season details for ${validTmdbId} S${validSeasonNumber}:`, error)
      return null
    }
  })

  /**
   * Get season poster URL from TMDB
   */
  createIpcHandler(IPC_CHANNELS.seriesGetSeasonPoster, async (tmdbId: unknown, seasonNumber: unknown) => {
    const validTmdbId = validateInput(NonEmptyStringSchema, tmdbId, 'series:getSeasonPoster.tmdbId')
    const validSeasonNumber = validateInput(z.number().int().nonnegative(), seasonNumber, 'series:getSeasonPoster.seasonNumber')
    try {
      const tmdb = getTMDBService()
      const seasonDetails = await tmdb.getSeasonDetails(validTmdbId, validSeasonNumber)
      return tmdb.buildImageUrl(seasonDetails.poster_path, 'w500')
    } catch (error) {
      console.error(`Error fetching season poster for ${validTmdbId} S${validSeasonNumber}:`, error)
      return null
    }
  })

  /**
   * Get episode still URL from TMDB
   */
  createIpcHandler(IPC_CHANNELS.seriesGetEpisodeStill, async (tmdbId: unknown, seasonNumber: unknown, episodeNumber: unknown) => {
    const validTmdbId = validateInput(NonEmptyStringSchema, tmdbId, 'series:getEpisodeStill.tmdbId')
    const validSeasonNumber = validateInput(z.number().int().nonnegative(), seasonNumber, 'series:getEpisodeStill.seasonNumber')
    const validEpisodeNumber = validateInput(z.number().int().nonnegative(), episodeNumber, 'series:getEpisodeStill.episodeNumber')
    try {
      const tmdb = getTMDBService()
      const seasonDetails = await tmdb.getSeasonDetails(validTmdbId, validSeasonNumber)
      const episode = seasonDetails.episodes.find(ep => ep.episode_number === validEpisodeNumber)
      if (episode) {
        return tmdb.buildImageUrl(episode.still_path, 'w300')
      }
      return null
    } catch (error) {
      console.error(`Error fetching episode still for ${validTmdbId} S${validSeasonNumber}E${validEpisodeNumber}:`, error)
      return null
    }
  })

  // ============================================================================
  // MATCH FIXING - Fix incorrect TMDB matches for TV series
  // ============================================================================

  /**
   * Search TMDB for TV shows to fix a match
   */
  createIpcHandler(IPC_CHANNELS.seriesSearchTMDB, async (query: unknown) => {
    const validQuery = validateInput(NonEmptyStringSchema, query, 'series:searchTMDB.query')
    try {
      const tmdb = getTMDBService()
      await tmdb.initialize()
      const response = await tmdb.searchTVShow(validQuery)

      // Transform results to include poster URLs
      return response.results.map(show => ({
        id: show.id,
        name: show.name,
        first_air_date: show.first_air_date,
        overview: show.overview,
        poster_url: tmdb.buildImageUrl(show.poster_path, 'w500'),
        vote_average: show.vote_average,
      }))
    } catch (error) {
      console.error('Error searching TMDB for TV shows:', error)
      throw error
    }
  })

  /**
   * Fix the TMDB match for a TV series
   * Updates all episodes of the series with the new TMDB ID, canonical identity key, and title
   */
  createIpcHandler(IPC_CHANNELS.seriesFixMatch, async (seriesIdentityKey: unknown, sourceId: unknown, libraryId: unknown, tmdbId: unknown) => {
      const validSeriesIdentityKey = validateInput(CanonicalSeriesIdentityKeySchema, seriesIdentityKey, 'series:fixMatch.seriesIdentityKey')
      const validSourceId = validateInput(NonEmptyStringSchema, sourceId, 'series:fixMatch.sourceId')
      const validLibraryId = (typeof libraryId === 'string' && libraryId.trim() !== '') ? libraryId.trim() : undefined
      const validTmdbId = validateInput(PositiveIntSchema, tmdbId, 'series:fixMatch.tmdbId')
      try {
        const db = getDatabase()
        const tmdb = getTMDBService()
        const service = getSeriesCompletenessService()

        // Get show details from TMDB for the poster and title
        await tmdb.initialize()
        const showDetails = await tmdb.getTVShowDetails(validTmdbId.toString())
        const posterUrl = tmdb.buildImageUrl(showDetails.poster_path, 'w500') || undefined
        const newSeriesTitle = showDetails.name

        // Update all episodes with the new TMDB ID, canonical identity key, and series title
        const updatedCount = await db.updateSeriesMatch(
          validSeriesIdentityKey,
          validSourceId,
          validLibraryId,
          validTmdbId.toString(),
          posterUrl,
          newSeriesTitle
        )

        // Re-analyze the series with the canonical identity key and library scope
        const newIdentityKey = `tmdb:${validTmdbId}`
        const completeness = await service.analyzeSeries(
          newIdentityKey,
          validSourceId,
          validLibraryId,
          validTmdbId.toString()
        )

        return {
          success: true,
          updatedEpisodes: updatedCount,
          completeness,
          newTitle: newSeriesTitle,
          newIdentityKey,
        }
      } catch (error) {
        console.error('Error fixing series match:', error)
        throw error
      }
    })

  console.log('Series completeness IPC handlers registered')
}
