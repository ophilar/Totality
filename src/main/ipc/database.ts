import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import * as path from 'path'
import { z } from 'zod'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { getGeminiService } from '@main/services/GeminiService'
import { getTMDBService } from '@main/services/TMDBService'
import { invalidateNfsMappingsCache } from '@main/providers/kodi/KodiDatabaseSchema'
import { getErrorMessage, isNodeError, createValidatedIpcHandler, createIpcHandler, createValidatedIpcHandlerWithEvent, createIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import fs from 'fs/promises'
import {
  PositiveIntSchema,
  NonEmptyStringSchema,
  SettingKeySchema,
  SettingValueSchema,
  MediaItemFiltersSchema,
  TVShowFiltersSchema,
  MediaItemSchema,
  QualityScoreSchema,
  NfsMappingsSchema,
  ExportCSVOptionsSchema,
  AddExclusionSchema,
  OptionalSourceIdSchema,
  FilePathSchema,
  LetterOffsetSchema,
  SetSettingTupleSchema,
  TestNfsMappingTupleSchema,
  FixMatchTupleSchema,
  AddExclusionTupleSchema,
  GetExclusionsTupleSchema,
} from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { getSourceManager } from '@main/services/SourceManager'
import { MediaItemType } from '@main/types/database'

import { registerListHandlers } from '@main/ipc/utils/genericHandlers'

/**
 * Register all database-related IPC handlers
 */
export function registerDatabaseHandlers() {
  const db = getDatabase()

  // Register generic list/count handlers
  registerListHandlers('db:media', (f: any) => db.media.getItems(f), (f: any) => db.media.count(f), MediaItemFiltersSchema, {
    listAlias: 'db:getMediaItems',
    countAlias: 'db:countMediaItems'
  })
  registerListHandlers('db:tvshows', (f: any) => db.tvShows.getSummaries(f), (f: any) => db.tvShows.count(f), TVShowFiltersSchema, {
    listAlias: 'db:getTVShows',
    countAlias: 'db:countTVShows'
  })

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.TV_EPISODES_COUNT, TVShowFiltersSchema, async (filters) => {
    return await db.media.count({ ...filters, type: MediaItemType.Episode } as any)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_LETTER_OFFSET, LetterOffsetSchema, async (params) => {
    return await db.media.getLetterOffset(params.table as any, params.letter, { sourceId: params.sourceId, libraryId: params.libraryId })
  })

  const getMediaItemHandler = async (id: number) => {
    return await db.media.getItem(id)
  }

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_GET_ITEM, PositiveIntSchema, getMediaItemHandler)
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_GET_BY_ID, PositiveIntSchema, getMediaItemHandler)

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_UPSERT, MediaItemSchema, async (item) => {
    return await db.media.upsertItem(item as any)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_GET_VERSIONS, PositiveIntSchema, async (mediaItemId) => {
    return await db.media.getItemVersions(mediaItemId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.MEDIA_DELETE, PositiveIntSchema, async (id) => {
    await db.media.deleteItem(id)
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
    return await db.media.upsertQualityScore(score as any)
  })

  // ============================================================================
  // SETTINGS
  // ============================================================================

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_SETTING, SettingKeySchema, async (key) => {
    return await db.config.getSetting(key)
  })

  const sensitiveSettingKeys = new Set(['plex_token', 'tmdb_api_key', 'musicbrainz_api_token', 'gemini_api_key'])

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.SET_SETTING, SetSettingTupleSchema, async (event, key, value) => {
    getLoggingService().info('[IPC db:setSetting]', key, sensitiveSettingKeys.has(key) ? '(redacted)' : value)
    await db.config.setSetting(key, value)

    if (key.startsWith('quality_')) getQualityAnalyzer().invalidateThresholdsCache()
    if (key === 'tmdb_api_key') {
      getTMDBService().refreshApiKey()
      if (value) getSourceManager().triggerPostScanAnalysis().catch(() => {})
    }
    if (['gemini_api_key', 'gemini_model', 'ai_enabled'].includes(key)) {
      getGeminiService().refreshApiKey()
      if (key === 'gemini_api_key' && value) {
        const { getGeminiAnalysisService } = await import('@main/services/GeminiAnalysisService')
        getGeminiAnalysisService().generateCompletenessInsights(() => {}).catch(() => {})
      }
    }
    if (key === 'ffprobe_enabled' && value === 'true') getQualityAnalyzer().analyzeAllMediaItems().catch(() => {})

    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('settings:changed', { key, hasValue: !!value })
    return true
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.GET_ALL_SETTINGS, async () => {
    return await db.config.getAllSettings()
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.SET_LIBRARY_PROTECTED, z.tuple([z.string(), z.string(), z.boolean()]), async (sourceId, libraryId, isProtected) => {
    await db.sources.setLibraryProtected(sourceId, libraryId, isProtected)
    return true
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.VERIFY_PIN, z.string(), async (pin) => {
    return await db.config.verifyPin(pin)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.SET_PIN, z.string(), async (pin) => {
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

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.GET_DASHBOARD_SUMMARY, OptionalSourceIdSchema, async (sourceId) => {
    return await db.stats.getDashboardSummary(sourceId)
  })

  const OptionalYearSchema = z.number().int().min(1800).max(2100).optional()

  createValidatedIpcHandler(IPC_CHANNELS.MOVIE.SEARCH_TMDB, z.tuple([NonEmptyStringSchema, OptionalYearSchema]), async (query, year) => {
    const tmdb = getTMDBService()
    await tmdb.initialize()
    const res = await tmdb.searchMovie(query, year)
    return (res?.results || []).map((m: any) => ({ id: m.id, title: m.title, release_date: m.release_date, overview: m.overview, poster_url: tmdb.buildImageUrl(m.poster_path, 'w500'), vote_average: m.vote_average }))
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.MOVIE.FIX_MATCH, FixMatchTupleSchema, async (event, mediaItemId, tmdbId) => {
    const tmdb = getTMDBService()
    await tmdb.initialize()
    const details = await tmdb.getMovieDetails(tmdbId.toString())
    const posterUrl = tmdb.buildImageUrl(details.poster_path, 'w500') || undefined
    const year = details.release_date ? parseInt(details.release_date.split('-')[0], 10) : undefined
    await db.media.updateMovieMatch(mediaItemId, tmdbId.toString(), posterUrl, details.title, year)
    const item = await db.media.getItem(mediaItemId)
    if (item?.source_id) {
      const { getDeduplicationService } = await import('@main/services/DeduplicationService')
      await getDeduplicationService().scanForDuplicates(item.source_id)
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.send('library:updated', { type: 'media' })
    return { success: true, tmdbId, posterUrl, title: details.title, year }
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.GET_PATH, async () => {
    return db.getDbPath()
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.OPEN_FOLDER, async () => {
    await shell.openPath(path.dirname(db.getDbPath()))
    return { success: true }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.EXPORT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const res = await dialog.showSaveDialog(win, { title: 'Export Database', defaultPath: `totality-backup-${new Date().toISOString().split('T')[0]}.json`, filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }] })
    if (res.canceled || !res.filePath) return { success: false, cancelled: true }
    await fs.writeFile(res.filePath, JSON.stringify(await db.exportData(), null, 2), 'utf-8')
    return { success: true, path: res.filePath }
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.EXPORT_CSV, ExportCSVOptionsSchema, async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const res = await dialog.showSaveDialog(win, { title: 'Export Working Document', defaultPath: `totality-working-${new Date().toISOString().split('T')[0]}.csv`, filters: [{ name: 'CSV Files', extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }] })
    if (res.canceled || !res.filePath) return { success: false, cancelled: true }
    await fs.writeFile(res.filePath, await db.media.exportWorkingCSV(options), 'utf-8')
    return { success: true, path: res.filePath }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.DATABASE.IMPORT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const res = await dialog.showOpenDialog(win, { title: 'Import Database', filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }], properties: ['openFile'] })
    if (res.canceled || res.filePaths.length === 0) return { success: false, cancelled: true }
    const data = JSON.parse(await fs.readFile(res.filePaths[0], 'utf-8'))
    if (!data._meta) throw new Error('Invalid format')
    const result = await db.importData(data)
    return { success: true, imported: result.imported, errors: result.errors }
  })

  createIpcHandler(IPC_CHANNELS.DATABASE.RESET, async () => {
    await db.resetDatabase()
    return { success: true }
  })

  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.SEARCH, NonEmptyStringSchema, async (query) => {
    return await db.media.globalSearch(query)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.ADD_EXCLUSION, AddExclusionTupleSchema, async (type, refId, refKey, pKey, title) => {
    return await db.exclusions.addExclusion({ exclusion_type: type as any, reference_id: refId, reference_key: refKey, parent_key: pKey, title })
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

