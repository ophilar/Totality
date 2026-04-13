import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import * as path from 'path'
import { z } from 'zod'
import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from '../services/QualityAnalyzer'
import { getGeminiService } from '../services/GeminiService'
import { getTMDBService } from '../services/TMDBService'
import { invalidateNfsMappingsCache } from '../providers/kodi/KodiDatabaseSchema'
import { getErrorMessage, isNodeError } from './utils'
import fs from 'fs/promises'
import { validateInput, PositiveIntSchema, NonEmptyStringSchema, SettingKeySchema, SettingValueSchema, MediaItemFiltersSchema, TVShowFiltersSchema, MediaItemSchema, QualityScoreSchema, NfsMappingsSchema, ExportCSVOptionsSchema, AddExclusionSchema, OptionalSourceIdSchema, FilePathSchema, LetterOffsetSchema } from '../validation/schemas'
import { getLoggingService } from '../services/LoggingService'

import { registerListHandlers } from './utils/genericHandlers'

/**
 * Register all database-related IPC handlers
 */
export function registerDatabaseHandlers() {
  const db = getDatabase()

  // Register generic list/count handlers
  registerListHandlers('db:media', (f) => db.media.getItems(f), (f) => db.media.count(f), MediaItemFiltersSchema, {
    listAlias: 'db.media.getItems',
    countAlias: 'db:countMediaItems'
  })
  registerListHandlers('db:tvshows', (f) => db.tvShows.getSummaries(f), (f) => db.tvShows.count(f), TVShowFiltersSchema, {
    listAlias: 'db:getTVShows',
    countAlias: 'db:countTVShows'
  })

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  // HANDLERS REPLACED BY registerListHandlers:
  // - db.media.getItems -> db:media:list
  // - db:countMediaItems -> db:media:count
  // - db:getTVShows -> db:tvshows:list
  // - db:countTVShows -> db:tvshows:count

  ipcMain.handle('db:countTVEpisodes', async (_event, filters?: unknown) => {
    try {
      const validFilters = validateInput(TVShowFiltersSchema, filters, 'db:countTVEpisodes')
      return db.media.count({ ...validFilters, type: 'episode' } as any)
    } catch (error) {
      getLoggingService().error('[database]', 'Error counting TV episodes:', error)
      throw error
    }
  })

  ipcMain.handle('db:getLetterOffset', async (_event, params: unknown) => {
    try {
      const { table, letter, sourceId, libraryId } = validateInput(LetterOffsetSchema, params, 'db:getLetterOffset')
      return db.media.getLetterOffset(table as any, letter, { sourceId, libraryId })
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting letter offset:', error)
      throw error
    }
  })

  ipcMain.handle('db.media.getItem', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db.media.getItem')
      return db.media.getItem(validId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting media item:', error)
      throw error
    }
  })

  ipcMain.handle('db:upsertMediaItem', async (_event, item: unknown) => {
    try {
      const validItem = validateInput(MediaItemSchema, item, 'db:upsertMediaItem')
      return db.media.upsertItem(validItem as any)
    } catch (error) {
      getLoggingService().error('[database]', 'Error upserting media item:', error)
      throw error
    }
  })

  ipcMain.handle('db:getMediaItemVersions', async (_event, mediaItemId: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, mediaItemId, 'db:getMediaItemVersions')
      return db.media.getItemVersions(validId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting media item versions:', error)
      throw error
    }
  })

  ipcMain.handle('db:deleteMediaItem', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:deleteMediaItem')
      db.media.deleteItem(validId)
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error deleting media item:', error)
      throw error
    }
  })

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  ipcMain.handle('db:getQualityScores', async () => {
    try {
      return db.media.getQualityScores()
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting quality scores:', error)
      throw error
    }
  })

  ipcMain.handle('db:getQualityScoreByMediaId', async (_event, mediaItemId: unknown) => {
    try {
      const validMediaItemId = validateInput(PositiveIntSchema, mediaItemId, 'db:getQualityScoreByMediaId')
      return db.media.getQualityScoreByMediaId(validMediaItemId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting quality score:', error)
      throw error
    }
  })

  ipcMain.handle('db:upsertQualityScore', async (_event, score: unknown) => {
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

  ipcMain.handle('db:getSetting', async (_event, key: unknown) => {
    try {
      const validKey = validateInput(SettingKeySchema, key, 'db:getSetting')
      return db.getSetting(validKey)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting setting:', error)
      throw error
    }
  })

  const sensitiveSettingKeys = new Set(['plex_token', 'tmdb_api_key', 'musicbrainz_api_token', 'gemini_api_key'])

  ipcMain.handle('db:setSetting', async (event, key: unknown, value: unknown) => {
    try {
      const validKey = validateInput(SettingKeySchema, key, 'db:setSetting')
      const validValue = validateInput(SettingValueSchema, value, 'db:setSetting')
      getLoggingService().info('[IPC db:setSetting]', validKey, sensitiveSettingKeys.has(validKey) ? '(redacted)' : validValue)
      await db.setSetting(validKey, validValue)

      // Invalidate quality analyzer cache when quality settings change
      if (validKey.startsWith('quality_')) {
        getQualityAnalyzer().invalidateThresholdsCache()
      }

      // Refresh TMDB API key when it changes (no restart needed)
      if (validKey === 'tmdb_api_key') {
        getTMDBService().refreshApiKey()
      }

      // Refresh Gemini API key/model/enabled when they change (no restart needed)
      if (validKey === 'gemini_api_key' || validKey === 'gemini_model' || validKey === 'ai_enabled') {
        getGeminiService().refreshApiKey()
      }

      // Broadcast settings change event to all windows
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

  ipcMain.handle('db:getAllSettings', async () => {
    try {
      return db.config.getAllSettings()
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting all settings:', error)
      throw error
    }
  })

  // Library Protection
  ipcMain.handle('db:setLibraryProtected', async (_event, sourceId: string, libraryId: string, isProtected: boolean) => {
    try {
      db.sources.setLibraryProtected(sourceId, libraryId, isProtected)
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error setting library protected:', error)
      throw error
    }
  })

  ipcMain.handle('db:verifyPin', async (_event, pin: string) => {
    try {
      return await db.config.verifyPin(pin)
    } catch (error) {
      getLoggingService().error('[database]', 'Error verifying PIN:', error)
      throw error
    }
  })

  ipcMain.handle('db:setPin', async (_event, pin: string) => {
    try {
      await db.config.setPin(pin)
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error setting PIN:', error)
      throw error
    }
  })

  ipcMain.handle('db:hasPin', async () => {
    try {
      return db.config.hasPin()
    } catch (error) {
      getLoggingService().error('[database]', 'Error checking for PIN:', error)
      throw error
    }
  })

  // NFS Mount Mappings (for Kodi NFS path conversion)
  ipcMain.handle('settings:getNfsMappings', async () => {
    try {
      const json = db.getSetting('nfs_mount_mappings')
      return json ? JSON.parse(json) : {}
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting NFS mappings:', error)
      return {}
    }
  })

  ipcMain.handle('settings:setNfsMappings', async (_event, mappings: unknown) => {
    try {
      const validMappings = validateInput(NfsMappingsSchema, mappings, 'settings:setNfsMappings')
      await db.setSetting('nfs_mount_mappings', JSON.stringify(validMappings))
      invalidateNfsMappingsCache()
      return true
    } catch (error) {
      getLoggingService().error('[database]', 'Error setting NFS mappings:', error)
      throw error
    }
  })

  ipcMain.handle('settings:testNfsMapping', async (_event, nfsPath: unknown, localPath: unknown) => {
    validateInput(NonEmptyStringSchema, nfsPath, 'settings:testNfsMapping')
    const validLocalPath = validateInput(FilePathSchema, localPath, 'settings:testNfsMapping')
    try {
      const stats = await fs.stat(validLocalPath)
      if (!stats.isDirectory()) {
        return { success: false, error: `Path is not a directory: ${validLocalPath}` }
      }

      const entries = await fs.readdir(validLocalPath, { withFileTypes: true })
      const folderCount = entries.filter(e => e.isDirectory()).length
      const fileCount = entries.filter(e => e.isFile()).length

      return {
        success: true,
        folderCount,
        fileCount,
        message: `Found ${entries.length} items (${folderCount} folders, ${fileCount} files)`
      }
    } catch (error: unknown) {
      // Provide user-friendly error messages
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

  // ============================================================================
  // STATISTICS
  // ============================================================================

  ipcMain.handle('db:getLibraryStats', async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'db:getLibraryStats')
      return db.stats.getLibraryStats(validSourceId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting library stats:', error)
      throw error
    }
  })

  ipcMain.handle('db:getDashboardSummary', async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'db:getDashboardSummary')
      return db.stats.getDashboardSummary(validSourceId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting dashboard summary:', error)
      throw error
    }
  })

  // ============================================================================
  // MATCH FIXING - Fix incorrect TMDB matches for movies
  // ============================================================================

  /**
   * Search TMDB for movies to fix a match
   */
  const OptionalYearSchema = z.number().int().min(1800).max(2100).optional()

  ipcMain.handle('movie:searchTMDB', async (_event, query: unknown, year?: unknown) => {
    try {
      const validQuery = validateInput(NonEmptyStringSchema, query, 'movie:searchTMDB')
      const validYear = validateInput(OptionalYearSchema, year, 'movie:searchTMDB')
      getLoggingService().info('[database]', '[movie:searchTMDB] Searching for:', validQuery, 'year:', validYear)
      const tmdb = getTMDBService()
      await tmdb.initialize()
      const response = await tmdb.searchMovie(validQuery, validYear)
      getLoggingService().info('[database]', '[movie:searchTMDB] Got response:', JSON.stringify(response).substring(0, 500))

      // Handle null/undefined results
      if (!response || !response.results) {
        getLoggingService().info('[database]', '[movie:searchTMDB] No results in response')
        return []
      }

      getLoggingService().info('[database]', '[movie:searchTMDB] Got', response.results.length, 'results')

      // Transform results to include poster URLs
      const results = response.results.map(movie => ({
        id: movie.id,
        title: movie.title,
        release_date: movie.release_date,
        overview: movie.overview,
        poster_url: tmdb.buildImageUrl(movie.poster_path, 'w500'),
        vote_average: movie.vote_average,
      }))
      getLoggingService().info('[database]', '[movie:searchTMDB] Returning', results.length, 'transformed results')
      return results
    } catch (error) {
      getLoggingService().error('[database]', 'Error searching TMDB for movies:', error)
      throw error
    }
  })

  /**
   * Fix the TMDB match for a movie
   */
  ipcMain.handle('movie:fixMatch', async (event, mediaItemId: unknown, tmdbId: unknown) => {
    try {
      const validMediaItemId = validateInput(PositiveIntSchema, mediaItemId, 'movie:fixMatch')
      const validTmdbId = validateInput(PositiveIntSchema, tmdbId, 'movie:fixMatch')
      const tmdb = getTMDBService()
      const win = BrowserWindow.fromWebContents(event.sender)

      // Get movie details from TMDB for the poster, title, and year
      await tmdb.initialize()
      const movieDetails = await tmdb.getMovieDetails(validTmdbId.toString())
      const posterUrl = tmdb.buildImageUrl(movieDetails.poster_path, 'w500') || undefined
      const title = movieDetails.title
      const year = movieDetails.release_date
        ? parseInt(movieDetails.release_date.split('-')[0], 10)
        : undefined

      // Update the movie with the new TMDB ID, poster, title, and year
      await db.media.updateMovieMatch(validMediaItemId, validTmdbId.toString(), posterUrl, title, year)

      // Check for duplicates in the same source
      const item = db.media.getItem(validMediaItemId)
      if (item && item.source_id) {
        const { getDeduplicationService } = require('../services/DeduplicationService')
        await getDeduplicationService().scanForDuplicates(item.source_id)
      }

      // Send library update for live refresh
      win?.webContents.send('library:updated', { type: 'media' })

      return {
        success: true,
        tmdbId: validTmdbId,
        posterUrl,
        title,
        year,
      }
    } catch (error) {
      getLoggingService().error('[database]', 'Error fixing movie match:', error)
      throw error
    }
  })

  // ============================================================================
  // DATA MANAGEMENT - Export/Import/Reset
  // ============================================================================

  /**
   * Get the database file path
   */
  ipcMain.handle('db:getPath', async () => {
    try {
      return db.getDbPath()
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting database path:', error)
      throw error
    }
  })

  ipcMain.handle('db:openFolder', async () => {
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

  /**
   * Export database to JSON file
   */
  ipcMain.handle('db:export', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      // Show save dialog
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Database',
        defaultPath: `totality-backup-${new Date().toISOString().split('T')[0]}.json`,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true }
      }

      // Export data
      const data = db.exportData()
      await fs.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8')

      return { success: true, path: result.filePath }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error exporting database:', error)
      throw error
    }
  })

  /**
   * Export working document CSV for tracking upgrades and completions
   */
  ipcMain.handle('db:exportCSV', async (event, options: unknown) => {
    try {
      const validOptions = validateInput(ExportCSVOptionsSchema, options, 'db:exportCSV')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      // Show save dialog
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Working Document',
        defaultPath: `totality-working-${new Date().toISOString().split('T')[0]}.csv`,
        filters: [
          { name: 'CSV Files', extensions: ['csv'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true }
      }

      // Export data as CSV
      const csv = db.media.exportWorkingCSV(validOptions)
      await fs.writeFile(result.filePath, csv, 'utf-8')

      return { success: true, path: result.filePath }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error exporting CSV:', error)
      throw error
    }
  })

  /**
   * Import database from JSON file
   */
  ipcMain.handle('db:import', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      // Show open dialog
      const result = await dialog.showOpenDialog(win, {
        title: 'Import Database',
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true }
      }

      // Read and parse file
      const content = await fs.readFile(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content)

      // Validate it looks like our export format
      if (!data._meta || !Array.isArray(data._meta)) {
        throw new Error('Invalid export file format')
      }

      // Import data
      const importResult = await db.importData(data)

      return {
        success: true,
        imported: importResult.imported,
        errors: importResult.errors,
      }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error importing database:', error)
      throw error
    }
  })

  /**
   * Reset the database (delete all data)
   */
  ipcMain.handle('db:reset', async () => {
    try {
      await db.resetDatabase()
      return { success: true }
    } catch (error: unknown) {
      getLoggingService().error('[database]', 'Error resetting database:', error)
      throw error
    }
  })

  // ============================================================================
  // GLOBAL SEARCH
  // ============================================================================

  /**
   * Search across all media types for global search bar
   */
  ipcMain.handle('media:search', async (_event, query: unknown) => {
    try {
      const validQuery = validateInput(NonEmptyStringSchema, query, 'media:search')
      return db.media.globalSearch(validQuery)
    } catch (error) {
      getLoggingService().error('[database]', 'Error in global search:', error)
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }
  })

  // ============================================================================
  // EXCLUSIONS
  // ============================================================================

  ipcMain.handle('db:addExclusion', async (_event, exclusionType: unknown, referenceId?: unknown, referenceKey?: unknown, parentKey?: unknown, title?: unknown) => {
    try {
      const validArgs = validateInput(AddExclusionSchema, { exclusionType, referenceId, referenceKey, parentKey, title }, 'db:addExclusion')
      getLoggingService().info('[IPC db:addExclusion]', validArgs.exclusionType, validArgs.title || validArgs.referenceKey || '')
      return db.exclusions.addExclusion({ exclusion_type: validArgs.exclusionType as any, reference_id: validArgs.referenceId, reference_key: validArgs.referenceKey, parent_key: validArgs.parentKey, title: validArgs.title })
    } catch (error) {
      getLoggingService().error('[database]', 'Error adding exclusion:', error)
      throw error
    }
  })

  ipcMain.handle('db:removeExclusion', async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'db:removeExclusion')
      getLoggingService().info('[database]', '[IPC db:removeExclusion] id:', validId)
      db.exclusions.delete(validId)
    } catch (error) {
      getLoggingService().error('[database]', 'Error removing exclusion:', error)
      throw error
    }
  })

  const OptionalStringSchema = z.string().max(500).optional()

  ipcMain.handle('db:getExclusions', async (_event, exclusionType?: unknown, parentKey?: unknown) => {
    try {
      const validExclusionType = validateInput(OptionalStringSchema, exclusionType, 'db:getExclusions')
      const validParentKey = validateInput(OptionalStringSchema, parentKey, 'db:getExclusions')
      return db.exclusions.getExclusions(validExclusionType, validParentKey)
    } catch (error) {
      getLoggingService().error('[database]', 'Error getting exclusions:', error)
      return []
    }
  })

  getLoggingService().info('[database]', 'Database IPC handlers registered')
}
