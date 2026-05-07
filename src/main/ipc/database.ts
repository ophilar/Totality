import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import * as path from 'path'
import { z } from 'zod'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { getGeminiService } from '@main/services/GeminiService'
import { getTMDBService } from '@main/services/TMDBService'
import { invalidateNfsMappingsCache } from '@main/providers/kodi/KodiDatabaseSchema'
import { getErrorMessage, isNodeError } from '@main/ipc/utils/createHandler'
import fs from 'fs/promises'
import { validateInput, PositiveIntSchema, NonEmptyStringSchema, SettingKeySchema, SettingValueSchema, MediaItemFiltersSchema, TVShowFiltersSchema, MediaItemSchema, QualityScoreSchema, NfsMappingsSchema, ExportCSVOptionsSchema, AddExclusionSchema, OptionalSourceIdSchema, FilePathSchema, LetterOffsetSchema } from '@main/validation/schemas'
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

  ipcMain.handle(IPC_CHANNELS.DATABASE.TV_EPISODES_COUNT, async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(TVShowFiltersSchema, filters, 'db:countTVEpisodes')
      return await db.media.count({ ...validFilters, type: MediaItemType.Episode } as any)
    } catch (error) {
      getLoggingService().error('[database]', 'Error counting TV episodes:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_LETTER_OFFSET, async (_event, params: unknown) => {
    try {
      const { table, letter, sourceId, libraryId } = validateInput(LetterOffsetSchema, params, 'db:getLetterOffset')
      return await db.media.getLetterOffset(table as any, letter, { sourceId, libraryId })
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting letter offset:', error)
      throw error
    }
  })

  const getMediaItemHandler = async (_event: unknown, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:media:getItem')
      return await db.media.getItem(validId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting media item:', error)
      throw error
    }
  }

  ipcMain.handle(IPC_CHANNELS.DATABASE.MEDIA_GET_ITEM, getMediaItemHandler)
  ipcMain.handle(IPC_CHANNELS.DATABASE.MEDIA_GET_BY_ID, getMediaItemHandler)

  ipcMain.handle(IPC_CHANNELS.DATABASE.MEDIA_UPSERT, async (_event, item: unknown) => {
    try {
      const validItem = validateInput(MediaItemSchema, item, 'db:upsertMediaItem')
      return await db.media.upsertItem(validItem as any)
    } catch (error) {
      getLoggingService().error('[database]', 'Error upserting media item:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.MEDIA_GET_VERSIONS, async (_event, mediaItemId: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, mediaItemId, 'db:getMediaItemVersions')
      return await db.media.getItemVersions(validId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting media item versions:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.MEDIA_DELETE, async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:deleteMediaItem')
      await db.media.deleteItem(validId)
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error deleting media item:', error)
      throw error
    }
  })

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_QUALITY_SCORES, async () => {
    try {
      return await db.media.getQualityScores()
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting quality scores:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_QUALITY_SCORE_BY_MEDIA_ID, async (_event, mediaItemId: unknown) => {
    try {
      const validMediaItemId = validateInput(PositiveIntSchema, mediaItemId, 'db:getQualityScoreByMediaId')
      return await db.media.getQualityScoreByMediaId(validMediaItemId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting quality score:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.UPSERT_QUALITY_SCORE, async (_event, score: unknown) => {
    try {
      const validScore = validateInput(QualityScoreSchema, score, 'db:upsertQualityScore')
      return await db.media.upsertQualityScore(validScore as any)
    } catch (error) {
      getLoggingService().error('[database]', 'Error upserting quality score:', error)
      throw error
    }
  })


  // ============================================================================
  // SETTINGS
  // ============================================================================

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_SETTING, async (_event, key: unknown) => {
    try {
      const validKey = validateInput(SettingKeySchema, key, 'db:getSetting')
      return await db.config.getSetting(validKey)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting setting:', error)
      throw error
    }
  })

  const sensitiveSettingKeys = new Set(['plex_token', 'tmdb_api_key', 'musicbrainz_api_token', 'gemini_api_key'])

  ipcMain.handle(IPC_CHANNELS.DATABASE.SET_SETTING, async (event, key: unknown, value: unknown) => {
    try {
      const validKey = validateInput(SettingKeySchema, key, 'db:setSetting')
      const validValue = validateInput(SettingValueSchema, value, 'db:setSetting')
      getLoggingService().info('[IPC db:setSetting]', validKey, sensitiveSettingKeys.has(validKey) ? '(redacted)' : validValue)
      await db.config.setSetting(validKey, validValue)

      if (validKey.startsWith('quality_')) {
        getQualityAnalyzer().invalidateThresholdsCache()
      }

      if (validKey === 'tmdb_api_key') {
        getTMDBService().refreshApiKey()
        if (validValue && validValue !== '') {
          getSourceManager().triggerPostScanAnalysis().catch(err => {
            getLoggingService().error('[database]', 'Failed to trigger background analysis after TMDB key change:', err)
          })
        }
      }

      if (validKey === 'gemini_api_key' || validKey === 'gemini_model' || validKey === 'ai_enabled') {
        getGeminiService().refreshApiKey()
        if (validKey === 'gemini_api_key' && validValue && validValue !== '') {
          const { getGeminiAnalysisService } = await import('@main/services/GeminiAnalysisService')
          getGeminiAnalysisService().generateCompletenessInsights(() => {}).catch(() => {})
        }
      }

      if (validKey === 'ffprobe_enabled' && validValue === 'true') {
        getQualityAnalyzer().analyzeAllMediaItems().catch(err => {
          getLoggingService().error('[database]', 'Failed to trigger quality analysis after enabling ffprobe:', err)
        })
      }

      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) {
        win.webContents.send('settings:changed', { key: validKey, hasValue: !!validValue })
      }

      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error setting setting:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_ALL_SETTINGS, async () => {
    try {
      return await db.config.getAllSettings()
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting all settings:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.SET_LIBRARY_PROTECTED, async (_event, sourceId: string, libraryId: string, isProtected: boolean) => {
    try {
      await db.sources.setLibraryProtected(sourceId, libraryId, isProtected)
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error setting library protected:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.VERIFY_PIN, async (_event, pin: string) => {
    try {
      return await db.config.verifyPin(pin)
    } catch (error) {
      getLoggingService().error('[database]', 'Error verifying PIN:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.SET_PIN, async (_event, pin: string) => {
    try {
      await db.config.setPin(pin)
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error setting PIN:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.HAS_PIN, async () => {
    try {
      return await db.config.hasPin()
    } catch (error) {
      getLoggingService().error('[database]', 'Error checking for PIN:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS.GET_NFS_MAPPINGS, async () => {
    try {
      const json = await db.config.getSetting('nfs_mount_mappings')
      return json ? JSON.parse(json) : {}
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting NFS mappings:', error)
      return {}
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS.SET_NFS_MAPPINGS, async (_event, mappings: unknown) => {
    try {
      const validMappings = validateInput(NfsMappingsSchema, mappings, 'settings:setNfsMappings')
      await db.config.setSetting('nfs_mount_mappings', JSON.stringify(validMappings))
      invalidateNfsMappingsCache()
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error setting NFS mappings:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS.TEST_NFS_MAPPING, async (_event, _nfsPath: unknown, localPath: unknown) => {
    const validLocalPath = validateInput(FilePathSchema, localPath, 'settings:testNfsMapping')
    try {
      const stats = await fs.stat(validLocalPath)
      if (!stats.isDirectory()) {
        return { success: false, error: `Path is not a directory: ${validLocalPath}` }
      }

      const entries = await fs.readdir(validLocalPath, { withFileTypes: true })
      const folderCount = entries.filter((e: any) => e.isDirectory()).length
      const fileCount = entries.filter((e: any) => e.isFile()).length

      return {
        success: true,
        folderCount,
        fileCount,
        message: `Found ${entries.length} items (${folderCount} folders, ${fileCount} files)`
      }
    } catch (error: unknown) {
      let errorMessage = getErrorMessage(error) || `Unable to access: ${validLocalPath}`
      if (isNodeError(error)) {
        if (error.code === 'ENOENT') {
          errorMessage = `Path does not exist: ${validLocalPath}`
        } else if (error.code === 'EACCES') {
          errorMessage = `Permission denied: ${validLocalPath}`
        } else if (error.code === 'ENOTDIR') {
          errorMessage = `Not a directory: ${validLocalPath}`
        }
      }
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_LIBRARY_OVERVIEW, async (_event, sourceId?: string) => {
    try {
      const filters = { sourceId, limit: 200 }
      
      const [
        movies, movieCount,
        tvShows, tvShowCount,
        artists, artistCount,
        albums, albumCount,
        tracks, trackCount,
        stats
      ] = await Promise.all([
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

      return {
        movies: { items: movies, total: movieCount },
        tvShows: { items: tvShows, total: tvShowCount },
        music: { 
          artists: { items: artists, total: artistCount },
          albums: { items: albums, total: albumCount },
          tracks: { items: tracks, total: trackCount }
        },
        stats
      }
    } catch (error) {
      getLoggingService().error('[database]', 'Error in getLibraryOverview:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_LIBRARY_STATS, async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'db:getLibraryStats')
      return await db.stats.getLibraryStats(validSourceId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting library stats:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_DASHBOARD_SUMMARY, async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'db:getDashboardSummary')
      return await db.stats.getDashboardSummary(validSourceId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting dashboard summary:', error)
      throw error
    }
  })

  const OptionalYearSchema = z.number().int().min(1800).max(2100).optional()

  ipcMain.handle(IPC_CHANNELS.MOVIE.SEARCH_TMDB, async (_event, query: unknown, year?: unknown) => {
    try {
      const validQuery = validateInput(NonEmptyStringSchema, query, 'movie:searchTMDB')
      const validYear = validateInput(OptionalYearSchema, year, 'movie:searchTMDB')
      const tmdb = getTMDBService()
      await tmdb.initialize()
      const response = await tmdb.searchMovie(validQuery, validYear)

      if (!response || !response.results) return []

      return response.results.map((movie: any) => ({
        id: movie.id,
        title: movie.title,
        release_date: movie.release_date,
        overview: movie.overview,
        poster_url: tmdb.buildImageUrl(movie.poster_path, 'w500'),
        vote_average: movie.vote_average,
      }))
    } catch (error) {
      getLoggingService().error('[database]', 'Error searching TMDB for movies:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.MOVIE.FIX_MATCH, async (event, mediaItemId: unknown, tmdbId: unknown) => {
    try {
      const validMediaItemId = validateInput(PositiveIntSchema, mediaItemId, 'movie:fixMatch')
      const validTmdbId = validateInput(PositiveIntSchema, tmdbId, 'movie:fixMatch')
      const tmdb = getTMDBService()
      const win = BrowserWindow.fromWebContents(event.sender)

      await tmdb.initialize()
      const movieDetails = await tmdb.getMovieDetails(validTmdbId.toString())
      const posterUrl = tmdb.buildImageUrl(movieDetails.poster_path, 'w500') || undefined
      const title = movieDetails.title
      const year = movieDetails.release_date ? parseInt(movieDetails.release_date.split('-')[0], 10) : undefined

      await db.media.updateMovieMatch(validMediaItemId, validTmdbId.toString(), posterUrl, title, year)

      const item = await db.media.getItem(validMediaItemId)
      if (item && item.source_id) {
        const { getDeduplicationService } = await import('@main/services/DeduplicationService')
        await getDeduplicationService().scanForDuplicates(item.source_id)
      }

      win?.webContents.send('library:updated', { type: 'media' })

      return { success: true, tmdbId: validTmdbId, posterUrl, title, year }
    } catch (error) {
      getLoggingService().error('[database]', 'Error fixing movie match:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_PATH, async () => {
    try {
      return db.getDbPath()
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting database path:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.OPEN_FOLDER, async () => {
    try {
      const dbPath = db.getDbPath()
      const folder = path.dirname(dbPath)
      await shell.openPath(folder)
      return { success: true }
    } catch (error) {
      getLoggingService().error('[database]', 'Error opening database folder:', error)
      return { success: false }
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.EXPORT, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      const result = await dialog.showSaveDialog(win, {
        title: 'Export Database',
        defaultPath: `totality-backup-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }],
      })

      if (result.canceled || !result.filePath) return { success: false, cancelled: true }

      const data = await db.exportData()
      await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
      return { success: true, path: result.filePath }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error exporting database:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.EXPORT_CSV, async (event, options: unknown) => {
    try {
      const validOptions = validateInput(ExportCSVOptionsSchema, options, 'db:exportCSV')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      const result = await dialog.showSaveDialog(win, {
        title: 'Export Working Document',
        defaultPath: `totality-working-${new Date().toISOString().split('T')[0]}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }, { name: 'All Files', extensions: ['*'] }],
      })

      if (result.canceled || !result.filePath) return { success: false, cancelled: true }

      const csv = await db.media.exportWorkingCSV(validOptions)
      await fs.writeFile(result.filePath, csv, 'utf-8')
      return { success: true, path: result.filePath }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error exporting CSV:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.IMPORT, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      const result = await dialog.showOpenDialog(win, {
        title: 'Import Database',
        filters: [{ name: 'JSON Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) return { success: false, cancelled: true }

      const content = await fs.readFile(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content)

      if (!data._meta || !Array.isArray(data._meta)) throw new Error('Invalid export file format')

      const importResult = await db.importData(data)
      return { success: true, imported: importResult.imported, errors: importResult.errors }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error importing database:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.RESET, async () => {
    try {
      await db.resetDatabase()
      return { success: true }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error resetting database:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.MEDIA.SEARCH, async (_event, query: unknown) => {
    try {
      const validQuery = validateInput(NonEmptyStringSchema, query, 'media:search')
      return await db.media.globalSearch(validQuery)
    } catch (error) {
      getLoggingService().error('[database]', 'Error in global search:', error)
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.ADD_EXCLUSION, async (_event, exclusionType: unknown, referenceId?: unknown, referenceKey?: unknown, parentKey?: unknown, title?: unknown) => {
    try {
      const validArgs = validateInput(AddExclusionSchema, { exclusionType, referenceId, referenceKey, parentKey, title }, 'db:addExclusion')
      return await db.exclusions.addExclusion({ exclusion_type: validArgs.exclusionType as any, reference_id: validArgs.referenceId, reference_key: validArgs.referenceKey, parent_key: validArgs.parentKey, title: validArgs.title })
    } catch (error) {
      getLoggingService().error('[database]', 'Error adding exclusion:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.DATABASE.REMOVE_EXCLUSION, async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:removeExclusion')
      await db.exclusions.delete(validId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error removing exclusion:', error)
      throw error
    }
  })

  const OptionalStringSchema = z.string().max(500).optional()

  ipcMain.handle(IPC_CHANNELS.DATABASE.GET_EXCLUSIONS, async (_event, exclusionType?: unknown, parentKey?: unknown) => {
    try {
      const validExclusionType = validateInput(OptionalStringSchema, exclusionType, 'db:getExclusions')
      const validParentKey = validateInput(OptionalStringSchema, parentKey, 'db:getExclusions')
      return await db.exclusions.getExclusions(validExclusionType, validParentKey)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting exclusions:', error)
      return []
    }
  })

  getLoggingService().info('[database]', 'Database IPC handlers registered')
}

