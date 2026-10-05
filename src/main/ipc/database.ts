import { getStatsCacheService } from '@main/services/StatsCacheService'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { BrowserWindow, dialog, shell } from 'electron'
import * as path from 'path'
import { z } from 'zod'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { getGeminiService } from '@main/services/GeminiService'
import { getTMDBService } from '@main/services/TMDBService'
import { MetadataRegistryService } from '@main/services/metadata/MetadataRegistryService'
import { invalidateNfsMappingsCache } from '@main/providers/kodi/KodiDatabaseSchema'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { createValidatedIpcHandler, createIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import fs from 'fs/promises'
import { randomUUID } from 'node:crypto'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'
import {
  PositiveIntSchema,
  SecurityPinSchema,
  NonEmptyStringSchema,
  SettingKeySchema,
  MediaItemFiltersSchema,
  TVShowFiltersSchema,
  MediaItemSchema,
  QualityScoreSchema,
  NfsMappingsSchema,
  ExportCSVOptionsSchema,
  OptionalSourceIdSchema,
  LetterOffsetSchema,
  SetSettingTupleSchema,
  TestNfsMappingTupleSchema,
  FixMatchTupleSchema,
  AddExclusionTupleSchema,
  GetExclusionsTupleSchema,
} from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { getSourceManager } from '@main/services/SourceManager'
import { MediaItemType, TaskType } from '@main/types/database'
import type { MediaItem, MediaItemFilters, QualityScore } from '@main/types/database'
import type { TMDBMovieSearchResult } from '@main/types/tmdb'
import { getDeduplicationService } from '@main/services/DeduplicationService'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { getSavedServiceHealthService } from '@main/services/SavedServiceHealthService'

import { registerListHandlers } from '@main/ipc/utils/genericHandlers'

/**
 * Register all database-related IPC handlers
 */
export function registerDatabaseHandlers() {
  const db = getDatabase()

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.CANCEL_OPERATION, z.string().min(1).max(100), async (event, requestId) => ({
    status: operationRequestRegistry.cancel(event.sender.id, requestId),
  }))

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.OPERATIONS.GET_ACTIVITY, z.tuple([]), async event => operationRequestRegistry.getSnapshot(event.sender.id))
  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.OPERATIONS.GET_RESULT, z.string().min(1).max(100), async (event, requestId) => operationRequestRegistry.getResult(event.sender.id, requestId))
  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.OPERATIONS.DISMISS, z.string().min(1).max(100), async (event, requestId) => operationRequestRegistry.dismiss(event.sender.id, requestId))

  createIpcHandler(IPC_CHANNELS.SETTINGS.SERVICE_HEALTH_STATE, async () => getSavedServiceHealthService().getSnapshot())
  createIpcHandler(IPC_CHANNELS.SETTINGS.SERVICE_HEALTH_REFRESH, async () => {
    await getGeminiService().refreshApiKey()
    await getSavedServiceHealthService().refreshSavedChecks()
    return getSavedServiceHealthService().getSnapshot()
  })
  createValidatedIpcHandler(IPC_CHANNELS.SETTINGS.SERVICE_HEALTH_RETRY, z.enum(['omdb', 'tvdb', 'musicbrainz', 'sonarr', 'radarr']), async service => {
    await getSavedServiceHealthService().retry(service)
    return getSavedServiceHealthService().getSnapshot()
  })



  // Register generic list/count handlers
  registerListHandlers('db:media', f => db.media.getItems(f as MediaItemFilters), f => db.media.count(f as MediaItemFilters), MediaItemFiltersSchema)
  registerListHandlers('db:tvshows', f => db.tvShows.getSummaries(f), f => db.tvShows.count(f), TVShowFiltersSchema)

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_OPTIMIZATION_SUMMARY, MediaItemFiltersSchema, async (filters) => {
    return await db.media.getOptimizationMetricsSummary(filters as MediaItemFilters)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.TV_EPISODES_COUNT, TVShowFiltersSchema, async (filters) => {
    return await db.media.count({ ...filters, type: MediaItemType.Episode } as MediaItemFilters)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_LETTER_OFFSET, LetterOffsetSchema, async (params) => {
    return await db.media.getLetterOffset(params.table, params.letter, { sourceId: params.sourceId, libraryId: params.libraryId })
  })

  const getMediaItemHandler = async (id: number) => {
    return await db.media.getItem(id)
  }

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_GET_ITEM, PositiveIntSchema, getMediaItemHandler)
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_GET_BY_ID, PositiveIntSchema, getMediaItemHandler)

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_UPSERT, MediaItemSchema, async (item) => {
    return await db.media.upsertItem(item as MediaItem)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_GET_VERSIONS, PositiveIntSchema, async (mediaItemId) => {
    return await db.media.getItemVersions(mediaItemId)
  })
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_DELETE, PositiveIntSchema, async (id) => {
    await db.media.deleteItem(id)
    getStatsCacheService().invalidate()
    return true
  })

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  createIpcHandler(IPC_CHANNELS.DATABASE.GET_QUALITY_SCORES, async () => {
    return await db.media.getQualityScores()
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_QUALITY_SCORE_BY_MEDIA_ID, PositiveIntSchema, async (mediaItemId) => {
    return await db.media.getQualityScoreByMediaId(mediaItemId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.UPSERT_QUALITY_SCORE, QualityScoreSchema, async (score) => {
    return await db.media.upsertQualityScore(score as Partial<QualityScore>)
  })

  // ============================================================================
  // SETTINGS
  // ============================================================================

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_SETTING, SettingKeySchema, async (key) => {
    return await db.config.getSetting(key)
  })

  const sensitiveSettingKeys = new Set(['plex_token', 'tmdb_api_key', 'musicbrainz_api_token', 'gemini_api_key', 'omdb_api_key', 'tvdb_api_key', 'tvdb_pin', 'sonarr_api_key', 'radarr_api_key'])

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.SET_SETTING, SetSettingTupleSchema, async (event, key, value) => {
    getLoggingService().info('[IPC db:setSetting]', key, sensitiveSettingKeys.has(key) ? '(redacted)' : value)
    await db.config.setSetting(key, value)

    if (key.startsWith('quality_')) getQualityAnalyzer().invalidateThresholdsCache()
    if (key === 'tmdb_api_key') {
      await getTMDBService().refreshApiKey()
    }
    if (key === 'ai_enabled') {
      await getGeminiService().refreshApiKey()
    }

    if (key === 'ffprobe_enabled' && value === 'true') {
      await getTaskQueueService().addTask({
        type: TaskType.QualityAnalysis,
        label: 'Recalculate Media Quality (FFprobe enabled)',
      })
    }

    if (key.startsWith('quality_')) {
      await getTaskQueueService().addTask({
        type: TaskType.QualityAnalysis,
        label: 'Recalculate Media Quality (Settings changed)',
      })
    }


    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('settings:changed', { key, hasValue: !!value })
    return true
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.GET_ALL_SETTINGS, async () => {
    return await db.config.getAllSettings()
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.SET_LIBRARY_PROTECTED, z.tuple([z.string(), z.string(), z.boolean()]), async (sourceId, libraryId, isProtected) => {
    if (isProtected && !await db.config.hasPin()) {
      throw new Error('Set a security PIN before protecting a library')
    }
    const manager = getSourceManager()
    const libs = await manager.getLibraries(sourceId)
    const lib = libs.find(l => l.id === libraryId)
    if (!lib) throw new Error(`Library ${libraryId} not found in source ${sourceId}`)

    await db.sources.setLibraryProtected(sourceId, libraryId, isProtected, lib.name, lib.type)
    return true
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.SET_LIBRARY_ALLOW_EXPANDED_MATCHING, z.tuple([z.string(), z.string(), z.boolean()]), async (sourceId, libraryId, allowExpandedMatching) => {
    const manager = getSourceManager()
    const libs = await manager.getLibraries(sourceId)
    const lib = libs.find(l => l.id === libraryId)
    if (!lib) throw new Error(`Library ${libraryId} not found in source ${sourceId}`)

    await db.sources.setLibraryAllowExpandedMatching(sourceId, libraryId, allowExpandedMatching, lib.name, lib.type)
    return true
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.VERIFY_PIN, z.string(), async (pin) => {
    return await db.config.verifyPin(pin)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.SET_PIN, SecurityPinSchema, async (pin) => {
    await db.config.setPin(pin)
    return true
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.HAS_PIN, async () => {
    return await db.config.hasPin()
  })

  createIpcHandler(IPC_CHANNELS.SETTINGS.GET_NFS_MAPPINGS, async () => {
    const json = await db.config.getSetting('nfs_mount_mappings')
    return json ? JSON.parse(json) : {}
  })

  createValidatedIpcHandler(IPC_CHANNELS.SETTINGS.SET_NFS_MAPPINGS, NfsMappingsSchema, async (mappings) => {
    await db.config.setSetting('nfs_mount_mappings', JSON.stringify(mappings))
    invalidateNfsMappingsCache()
    return true
  })

  createValidatedIpcHandler(IPC_CHANNELS.SETTINGS.TEST_NFS_MAPPING, TestNfsMappingTupleSchema, async (_nfsPath, localPath) => {
    try {
      const stats = await fs.stat(localPath)
      if (!stats.isDirectory()) return { success: false, error: 'Not a directory' }
      const entries = await fs.readdir(localPath, { withFileTypes: true })
      const folders = entries.filter(e => e.isDirectory()).length
      const files = entries.filter(e => e.isFile()).length
      return { success: true, folderCount: folders, fileCount: files, message: `Found ${entries.length} items` }
    } catch (e) { return { success: false, error: getErrorMessage(e) } }
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.GET_LIBRARY_OVERVIEW, async (sourceId?: string) => {
    const filters = { sourceId, limit: 200 }
    const [movies, movieCount, tvShows, tvShowCount, artists, artistCount, albums, albumCount, tracks, trackCount, stats] = await Promise.all([
      db.media.getItems({ ...filters, type: 'movie' }),
      db.media.count({ ...filters, type: 'movie' }),
      db.tvShows.getSummaries(filters),
      db.tvShows.count(filters),
      db.music.getArtists(filters),
      db.music.countMusicArtists(filters),
      db.music.getAlbums(filters),
      db.music.countMusicAlbums(filters),
      db.music.getTracks(filters),
      db.music.countMusicTracks(filters),
      db.stats.getLibraryStats(sourceId)
    ])
    return { movies: { items: movies, total: movieCount }, tvShows: { items: tvShows, total: tvShowCount }, music: { artists: { items: artists, total: artistCount }, albums: { items: albums, total: albumCount }, tracks: { items: tracks, total: trackCount } }, stats }
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_LIBRARY_STATS, OptionalSourceIdSchema, async (sourceId) => {
    return await db.stats.getLibraryStats(sourceId)
  })

  createValidatedIpcHandler(
    IPC_CHANNELS.DATABASE.GET_DASHBOARD_SUMMARY,
    z.object({
      sourceId: OptionalSourceIdSchema,
      sections: z.array(z.enum(['upgrades', 'collections', 'series', 'artists'])).min(1),
    }),
    async ({ sourceId, sections }) => await db.stats.getDashboardSummary(sourceId, sections)
  )

  const OptionalYearSchema = z.number().int().min(1800).max(2100).optional()

  createValidatedIpcHandler(IPC_CHANNELS.MOVIE.SEARCH_TMDB, z.tuple([NonEmptyStringSchema, OptionalYearSchema, z.boolean().optional()]), async (query, year, includeAdult) => {
    const tmdb = getTMDBService()
    await tmdb.initialize()
    const res = await tmdb.searchMovie(query, year, includeAdult)
    return (res?.results || []).map((m: TMDBMovieSearchResult) => ({ id: m.id, title: m.title, release_date: m.release_date, overview: m.overview, poster_url: tmdb.buildImageUrl(m.poster_path, 'w500'), vote_average: m.vote_average }))
  })

  createValidatedIpcHandlerWithEvent(
    IPC_CHANNELS.MEDIA.SEARCH_METADATA,
    z.tuple([NonEmptyStringSchema, z.enum(['movie', 'tv', 'anime', 'music', 'artwork']).optional(), z.boolean().optional(), NonEmptyStringSchema.optional(), z.string().min(1).max(100)]),
    async (event, query, type, includeAdult, artistName, requestId) => {
      const matchingService = MetadataRegistryService.getInstance().getMatchingService()
      const operation = operationRequestRegistry.register(event.sender, requestId)
      try {
        return await matchingService.matchMediaItem({ title: query, type: type || 'movie', includeAdult, artistName }, operation.signal)
      } catch (error) {
        if (operation.signal.aborted) return { status: 'cancelled' as const }
        throw error
      } finally {
        operation.dispose()
      }
    }
  )

  createValidatedIpcHandlerWithEvent(
    IPC_CHANNELS.MOVIE.FIX_MATCH,
    FixMatchTupleSchema,
    async (event, mediaItemId, providerId, externalId) => {
      const details = await MetadataRegistryService.getInstance()
        .getCompositeProvider()
        .getDetails(externalId, 'movie')

      if (!details) {
        throw new Error(`Could not find details for ${providerId}:${externalId}`)
      }

      // Determine TMDB, IMDB, and AniList IDs based on the provider and external IDs
      const tmdbId = providerId === 'tmdb' ? externalId : details.externalIds?.tmdbId || null
      const imdbId = providerId === 'omdb' || providerId === 'imdb' ? externalId : details.externalIds?.imdbId || null
      const anilistId = providerId === 'anilist' ? externalId : details.externalIds?.anilistId || null

      if (!tmdbId && !imdbId && !anilistId) {
        throw new Error(`An authoritative external ID (TMDB, IMDb, or AniList) could not be resolved for this match`)
      }

      const posterUrl = details.posterUrl || undefined
      const year = details.year

      await db.media.updateMovieMatch(
        mediaItemId,
        tmdbId || undefined,
        posterUrl,
        details.title,
        year,
        imdbId || undefined
      )
      const identityIds = details.externalIds || {}
      for (const [provider, value] of Object.entries(identityIds)) {
        if (value) await db.identities.upsertIdentity({ entityType: 'movie', entityId: mediaItemId, provider, externalId: String(value), locked: true, lockSource: 'manual' })
      }
      const aliasesToInsert = (details.alternateTitles || []).map(alias => ({ entityType: 'movie' as const, entityId: mediaItemId, alias, provider: providerId }))
      await db.identities.batchAddAliases(aliasesToInsert)

      const item = await db.media.getItem(mediaItemId)
      if (item?.source_id) {
        await getDeduplicationService().scanForDuplicates(item.source_id)
      }

      const win = BrowserWindow.fromWebContents(event.sender)
      win?.webContents.send('library:updated', { type: 'media' })

      return { success: true, tmdbId: tmdbId || undefined, posterUrl, title: details.title, year }
    }
  )

  createIpcHandler(IPC_CHANNELS.DATABASE.GET_PATH, async () => {
    return db.getDbPath()
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.OPEN_FOLDER, async () => {
    await shell.openPath(path.dirname(db.getDbPath()))
    return { success: true }
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.EXPORT, z.string().min(1).max(100), async (event, requestId) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const operation = operationRequestRegistry.register(event.sender, requestId)
    try {
      const res = await dialog.showSaveDialog(win, { title: 'Export Database', defaultPath: `totality-backup-${new Date().toISOString().split('T')[0]}.json`, filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }] })
      if (res.canceled || !res.filePath) return { success: false, cancelled: true }
      operation.signal.throwIfAborted()
      const temporaryPath = path.join(path.dirname(res.filePath), `.${path.basename(res.filePath)}.${randomUUID()}.tmp`)
      try {
        const data = await db.exportData(operation.signal)
        operation.signal.throwIfAborted()
        await fs.writeFile(temporaryPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', signal: operation.signal })
        operation.beginCommit()
        await fs.rename(temporaryPath, res.filePath)
        return { success: true, path: res.filePath }
      } finally {
        await fs.rm(temporaryPath, { force: true })
      }
    } catch (error) {
      if (operation.signal.aborted) return { success: false, cancelled: true }
      throw error
    } finally {
      operation.dispose()
    }
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.EXPORT_CSV, z.tuple([ExportCSVOptionsSchema, z.string().min(1).max(100)]), async (event, options, requestId) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const operation = operationRequestRegistry.register(event.sender, requestId)
    try {
      const res = await dialog.showSaveDialog(win, { title: 'Export Working Document', defaultPath: `totality-working-${new Date().toISOString().split('T')[0]}.csv`, filters: [{ name: 'CSV Files', extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }] })
      if (res.canceled || !res.filePath) return { success: false, cancelled: true }
      operation.signal.throwIfAborted()
      const temporaryPath = path.join(path.dirname(res.filePath), `.${path.basename(res.filePath)}.${randomUUID()}.tmp`)
      try {
        const csv = await db.media.exportWorkingCSV(options)
        operation.signal.throwIfAborted()
        await fs.writeFile(temporaryPath, csv, { encoding: 'utf-8', signal: operation.signal })
        operation.beginCommit()
        await fs.rename(temporaryPath, res.filePath)
        return { success: true, path: res.filePath }
      } finally {
        await fs.rm(temporaryPath, { force: true })
      }
    } catch (error) {
      if (operation.signal.aborted) return { success: false, cancelled: true }
      throw error
    } finally {
      operation.dispose()
    }
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.IMPORT, z.string().min(1).max(100), async (event, requestId) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const operation = operationRequestRegistry.register(event.sender, requestId)
    try {
      const res = await dialog.showOpenDialog(win, { title: 'Import Database', filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }], properties: ['openFile'] })
      if (res.canceled || res.filePaths.length === 0) return { success: false, cancelled: true }
      const contents = await fs.readFile(res.filePaths[0], { encoding: 'utf-8', signal: operation.signal })
      const data = JSON.parse(contents)
      operation.signal.throwIfAborted()
      if (!data._meta) throw new Error('Invalid format')
      const result = await db.importData(data, operation.signal, operation.beginCommit)
      return { success: true, imported: result.imported, errors: result.errors }
    } catch (error) {
      if (operation.signal.aborted) return { success: false, cancelled: true }
      throw error
    } finally {
      operation.dispose()
    }
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.RESET, async () => {
    await db.resetDatabase()
    return { success: true }
  })

  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.SEARCH, NonEmptyStringSchema, async (query) => {
    return await db.media.globalSearch(query)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.ADD_EXCLUSION, AddExclusionTupleSchema, async (type, refId, refKey, pKey, title) => {
    const exclusion: Parameters<typeof db.exclusions.addExclusion>[0] = { exclusion_type: type as Parameters<typeof db.exclusions.addExclusion>[0]['exclusion_type'], reference_id: refId, reference_key: refKey, parent_key: pKey, title }
    return await db.exclusions.addExclusion(exclusion)
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.BATCH_ADD_EXCLUSIONS, async (exclusions: Parameters<typeof db.exclusions.batchAddExclusions>[0]) => {
    return await db.exclusions.batchAddExclusions(exclusions)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.REMOVE_EXCLUSION, PositiveIntSchema, async (id) => {
    await db.exclusions.delete(id)
    return true
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_EXCLUSIONS, GetExclusionsTupleSchema, async (type, pKey) => {
    return await db.exclusions.getExclusions(type, pKey)
  })

  getLoggingService().info('[database]', 'Database IPC handlers registered')
}

