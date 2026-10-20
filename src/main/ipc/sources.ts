import { IPC_CHANNELS } from '../../shared/ipcChannels'
/**
 * IPC Handlers for Source Management
 *
 * Handles all source-related IPC calls from the renderer process.
 */

import { dialog, shell } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getSourceManager } from '../services/SourceManager'
import { getDatabase } from '../database/getDatabase'
import { getKodiLocalDiscoveryService } from '../services/KodiLocalDiscoveryService'
import { getKodiMySQLConnectionService, type KodiMySQLConfig } from '../services/KodiMySQLConnectionService'
import { getMediaMonkeyDiscoveryService } from '../services/MediaMonkeyDiscoveryService'
import { getMediaFileAnalyzer } from '../services/MediaFileAnalyzer'
import type { ProviderType } from '../providers/base/MediaProvider'
import type { KodiLocalProvider } from '../providers/kodi/KodiLocalProvider'
import { KodiMySQLProvider } from '../providers/kodi/KodiMySQLProvider'
import { safeSend, getWindowFromEvent } from './utils/safeSend'
import { getErrorMessage } from './utils'
import { createProgressUpdater } from './utils/progressUpdater'
import {
  validateInput,
  AddSourceSchema,
  UpdateSourceSchema,
  KodiMySQLConfigSchema,
  KodiMySQLTestConfigSchema,
  SafeUrlSchema,
  SourceIdSchema,
  BooleanSchema,
  FilePathSchema,
  OptionalProviderTypeSchema,
  LocalFolderConfigSchema,
  LocalFolderWithLibrariesSchema,
} from '../validation/schemas'
import { createIpcHandler, createIpcHandlerWithEvent } from './utils/createHandler'


/**
 * Register all source-related IPC handlers
 */
export function registerSourceHandlers(): void {
  const manager = getSourceManager()

  // ============================================================================
  // GENERAL
  // ============================================================================

  /**
   * Open a URL in the default browser
   * SECURITY: Only allows https:// and http:// URLs
   */
  createIpcHandler(IPC_CHANNELS.appOpenExternal, async (url: unknown) => {
    const validUrl = validateInput(SafeUrlSchema, url, 'app:openExternal')
    console.log('[IPC app:openExternal]', validUrl)
    await shell.openExternal(validUrl)
  })

  // ============================================================================
  // SOURCE CRUD
  // ============================================================================

  /**
   * Add a new media source
   */
  createIpcHandler(IPC_CHANNELS.sourcesAdd, async (config: unknown) => {
    try {
      const validatedConfig = validateInput(AddSourceSchema, config, 'sources:add')
      console.log('[IPC sources:add] Adding source:', validatedConfig.displayName, `(${validatedConfig.sourceType})`)
      return await manager.addSource(validatedConfig)
    } catch (error: unknown) {
      console.error('Error adding source:', error)
      throw error
    }
  })

  /**
   * Update an existing media source
   */
  createIpcHandler(IPC_CHANNELS.sourcesUpdate, async (sourceId: unknown, updates: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:update')
      const validatedUpdates = validateInput(UpdateSourceSchema, updates, 'sources:update')
      console.log('[IPC sources:update] Updating source:', validSourceId)
      await manager.updateSource(validSourceId, validatedUpdates)
    } catch (error: unknown) {
      console.error('Error updating source:', error)
      throw error
    }
  })

  /**
   * Remove a media source
   */
  createIpcHandler(IPC_CHANNELS.sourcesRemove, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:remove')
      console.log('[IPC sources:remove] Removing source:', validSourceId)
      await manager.removeSource(validSourceId)
    } catch (error: unknown) {
      console.error('Error removing source:', error)
      throw error
    }
  })

  /**
   * Get all sources (optionally filtered by type)
   */
  createIpcHandler(IPC_CHANNELS.sourcesList, async (type?: unknown) => {
    try {
      const validType = type !== undefined ? validateInput(OptionalProviderTypeSchema, type, 'sources:list') : undefined
      return await manager.getSources(validType)
    } catch (error: unknown) {
      console.error('Error listing sources:', error)
      throw error
    }
  })

  /**
   * Get a single source by ID
   */
  createIpcHandler(IPC_CHANNELS.sourcesGet, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:get')
      return await manager.getSource(validSourceId)
    } catch (error: unknown) {
      console.error('Error getting source:', error)
      throw error
    }
  })

  /**
   * Get enabled sources only
   */
  createIpcHandler(IPC_CHANNELS.sourcesGetEnabled, async () => {
    try {
      return await manager.getEnabledSources()
    } catch (error: unknown) {
      console.error('Error getting enabled sources:', error)
      throw error
    }
  })

  /**
   * Toggle source enabled status
   */
  createIpcHandler(IPC_CHANNELS.sourcesToggle, async (sourceId: unknown, enabled: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:toggle')
      const validEnabled = validateInput(BooleanSchema, enabled, 'sources:toggle')
      await manager.toggleSource(validSourceId, validEnabled)
    } catch (error: unknown) {
      console.error('Error toggling source:', error)
      throw error
    }
  })

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  /**
   * Test connection for a source
   */
  createIpcHandler(IPC_CHANNELS.sourcesTestConnection, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:testConnection')
      return await manager.testConnection(validSourceId)
    } catch (error: unknown) {
      console.error('Error testing connection:', error)
      throw error
    }
  })

  // ============================================================================
  // PLEX-SPECIFIC AUTH
  // ============================================================================

  /**
   * Start Plex OAuth flow
   */
  createIpcHandler(IPC_CHANNELS.plexStartAuth, async () => {
    try {
      return await manager.plexStartAuth()
    } catch (error: unknown) {
      console.error('Error starting Plex auth:', error)
      throw error
    }
  })

  /**
   * Check Plex auth PIN (poll for completion)
   */
  createIpcHandler(IPC_CHANNELS.plexCheckAuth, async (pinId: number) => {
    try {
      return await manager.plexCompleteAuth(pinId)
    } catch (error: unknown) {
      console.error('Error checking Plex auth:', error)
      throw error
    }
  })

  /**
   * Authenticate with token and discover servers
   */
  createIpcHandler(IPC_CHANNELS.plexAuthenticateAndDiscover, async (token: string, displayName: string) => {
    try {
      return await manager.plexAuthenticateAndDiscover(token, displayName)
    } catch (error: unknown) {
      console.error('Error authenticating Plex:', error)
      throw error
    }
  })

  /** Select a Plex server for a specific source. */
  createIpcHandler(IPC_CHANNELS.plexSelectServer, async (sourceId: string, serverId: string) =>
    manager.plexSelectServer(sourceId, serverId)
  )

  /** Get Plex servers for a specific source. */
  createIpcHandler(IPC_CHANNELS.plexGetServers, async (sourceId: string) => manager.plexGetServers(sourceId))

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  /**
   * Get libraries for a source
   */
  createIpcHandler(IPC_CHANNELS.sourcesGetLibraries, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:getLibraries')
      return await manager.getLibraries(validSourceId)
    } catch (error: unknown) {
      const msg = getErrorMessage(error)
      console.warn(`[IPC] sources:getLibraries failed for ${sourceId}: ${msg}`)
      return []
    }
  })

  /**
   * Get libraries for a source with enabled status from database
   */
  createIpcHandler(IPC_CHANNELS.sourcesGetLibrariesWithStatus, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:getLibrariesWithStatus')
      const db = getDatabase()
      const manager = getSourceManager()

      // Get libraries from the provider
      const libraries = await manager.getLibraries(validSourceId)

      // Get stored library settings from database
      const storedLibraries = db.getSourceLibraries(validSourceId) as Array<{
        libraryId: string; libraryName: string; libraryType: string
        isEnabled: boolean; lastScanAt: string | null; itemsScanned: number; upgradeMinTier: string | null
      }>
      const storedMap = new Map(storedLibraries.map(l => [l.libraryId, l]))

      // Merge: libraries from provider + enabled status + upgrade targets from DB
      return libraries.map(lib => {
        const stored = storedMap.get(lib.id)
        return {
          ...lib,
          isEnabled: stored ? stored.isEnabled : true, // Default to enabled
          lastScanAt: stored?.lastScanAt || null,
          itemsScanned: stored?.itemsScanned || 0,
          upgradeMinTier: stored?.upgradeMinTier ?? null,
        }
      })
    } catch (error: unknown) {
      const msg = getErrorMessage(error)
      console.warn(`[IPC] sources:getLibrariesWithStatus failed for ${sourceId}: ${msg}`)
      return []
    }
  })

  /**
   * Toggle a library's enabled status
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.sourcesToggleLibrary, async (event, sourceId: unknown, libraryId: unknown, enabled: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:toggleLibrary')
      const validLibraryId = validateInput(SourceIdSchema, libraryId, 'sources:toggleLibrary')
      const validEnabled = validateInput(BooleanSchema, enabled, 'sources:toggleLibrary')
      console.log('[IPC sources:toggleLibrary]', validSourceId, validLibraryId, validEnabled ? 'enabled' : 'disabled')
      const db = getDatabase()
      await db.toggleLibrary(validSourceId, validLibraryId, validEnabled)

      // Notify renderer that library settings changed
      const win = getWindowFromEvent(event)
      safeSend(win, IPC_CHANNELS.libraryUpdated, { type: 'libraryToggle', sourceId: validSourceId, libraryId: validLibraryId, enabled: validEnabled })

      return { success: true }
    } catch (error: unknown) {
      console.error('Error toggling library:', error)
      throw error
    }
  })

  /**
   * Set or clear per-library upgrade minimum tier
   */
  createIpcHandler(IPC_CHANNELS.sourcesSetLibraryUpgradeTier, async (sourceId: unknown, libraryId: unknown, minTier: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:setLibraryUpgradeTier')
      const validLibraryId = validateInput(SourceIdSchema, libraryId, 'sources:setLibraryUpgradeTier')
      const validMinTier = (minTier === null || minTier === '' || minTier === undefined)
        ? null
        : String(minTier)
      if (validMinTier !== null && !['SD', '720p', '1080p', '4K'].includes(validMinTier)) {
        throw new Error(`Invalid upgrade_min_tier: ${validMinTier}`)
      }
      getDatabase().setLibraryUpgradeTier(validSourceId, validLibraryId, validMinTier)
      return { success: true }
    } catch (error: unknown) {
      console.error('Error setting library upgrade tier:', error)
      throw error
    }
  })

  /**
   * Set multiple libraries' enabled status at once (used during source setup)
   */
  createIpcHandler(IPC_CHANNELS.sourcesSetLibrariesEnabled, async (sourceId: unknown, libraries: Array<{
    id: string
    name: string
    type: string
    enabled: boolean
  }>) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:setLibrariesEnabled')
      const db = getDatabase()
      await db.setLibrariesEnabled(validSourceId, libraries)
      return { success: true }
    } catch (error: unknown) {
      console.error('Error setting libraries enabled:', error)
      throw error
    }
  })

  /**
   * Get only enabled library IDs for a source
   */
  createIpcHandler(IPC_CHANNELS.sourcesGetEnabledLibraryIds, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:getEnabledLibraryIds')
      const db = getDatabase()
      return db.getEnabledLibraryIds(validSourceId)
    } catch (error: unknown) {
      console.error('Error getting enabled library IDs:', error)
      throw error
    }
  })

  /**
   * Stop current scan
   */
  createIpcHandler(IPC_CHANNELS.sourcesStopScan, async () => {
    try {
      console.log('[IPC] Stopping scan...')
      manager.stopScan()
      return { success: true }
    } catch (error: unknown) {
      console.error('Error stopping scan:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Scan a library
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.sourcesScanLibrary, async (event, sourceId: unknown, libraryId: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:scanLibrary')
    const validLibraryId = validateInput(SourceIdSchema, libraryId, 'sources:scanLibrary')
    const win = getWindowFromEvent(event)
    console.log(`[IPC sources:scanLibrary] Starting scan for ${validSourceId}/${validLibraryId}, win exists: ${!!win}`)
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
    let progressCount = 0

    try {
      const result = await manager.scanLibrary(validSourceId, validLibraryId, (progress) => {
        progressCount++
        if (progressCount <= 3 || progressCount % 50 === 0) {
          console.log(`[IPC sources:scanLibrary] Progress #${progressCount}: ${progress.percentage?.toFixed(1)}% - ${progress.currentItem}`)
        }
        onProgress(progress, { sourceId: validSourceId, libraryId: validLibraryId })
      })

      console.log(`[IPC sources:scanLibrary] Scan complete, sent ${progressCount} progress events`)
      return result
    } catch (error: unknown) {
      console.error('Error scanning library:', error)
      throw error
    } finally {
      flush()
    }
  })

  /**
   * Scan all enabled sources
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.sourcesScanAll, async (event) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

    try {
      const results = await manager.scanAllSources((sourceId, sourceName, progress) => {
        onProgress(progress, { sourceId, sourceName })
      })

      // Convert Map to array for IPC
      return Array.from(results.entries()).map(([key, value]) => ({
        key,
        ...value,
      }))
    } catch (error: unknown) {
      console.error('Error scanning all sources:', error)
      throw error
    } finally {
      flush()
    }
  })

  // ============================================================================
  // INCREMENTAL SCANNING
  // ============================================================================

  /**
   * Scan a single media item by file path
   * If libraryId is not provided, attempts to auto-detect from file path
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.sourcesScanItem, async (event, sourceId: unknown, libraryId: unknown, filePath: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:scanItem')
    const validLibraryId = libraryId != null ? validateInput(SourceIdSchema, libraryId, 'sources:scanItem') : null
    const validFilePath = validateInput(FilePathSchema, filePath, 'sources:scanItem')
    const win = getWindowFromEvent(event)
    console.log(`[IPC sources:scanItem] Starting single item scan for ${path.basename(validFilePath)}`)

    // If libraryId not provided, determine the appropriate default based on provider type
    let resolvedLibraryId = validLibraryId
    if (!resolvedLibraryId) {
      // Get the provider to determine its type
      const provider = manager.getProvider(validSourceId)
      if (provider?.providerType === 'kodi-local' || provider?.providerType === 'kodi-mysql') {
        // Kodi uses 'movies' and 'tvshows' as library IDs
        resolvedLibraryId = 'movies'
      } else {
        // LocalFolderProvider uses 'movie' and 'tvshows'
        resolvedLibraryId = 'movie'
      }
      console.log(`[IPC sources:scanItem] No libraryId provided, using default for ${provider?.providerType || 'unknown'}: ${resolvedLibraryId}`)
    }

    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

    try {
      const result = await manager.scanTargetedFiles(validSourceId, resolvedLibraryId, [validFilePath], (progress) => {
        onProgress(progress, { sourceId: validSourceId, libraryId: resolvedLibraryId })
      })

      console.log(`[IPC sources:scanItem] Scan complete: ${result.itemsScanned} items`)
      return result
    } catch (error: unknown) {
      console.error('Error scanning single item:', error)
      throw error
    } finally {
      flush()
    }
  })

  /**
   * Incremental scan of a single library (only new/changed items since last scan)
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.sourcesScanLibraryIncremental, async (event, sourceId: unknown, libraryId: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'sources:scanLibraryIncremental')
    const validLibraryId = validateInput(SourceIdSchema, libraryId, 'sources:scanLibraryIncremental')
    const win = getWindowFromEvent(event)
    console.log(`[IPC sources:scanLibraryIncremental] Starting incremental scan for ${validSourceId}/${validLibraryId}`)
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

    try {
      const result = await manager.scanLibraryIncremental(validSourceId, validLibraryId, (progress) => {
        onProgress(progress, { sourceId: validSourceId, libraryId: validLibraryId })
      })

      console.log(`[IPC sources:scanLibraryIncremental] Scan complete: ${result.itemsScanned} items`)
      return result
    } catch (error: unknown) {
      console.error('Error in incremental library scan:', error)
      throw error
    } finally {
      flush()
    }
  })

  /**
   * Incremental scan of all enabled sources (only new/changed items since last scan)
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.sourcesScanAllIncremental, async (event) => {
    const win = getWindowFromEvent(event)
    console.log('[IPC sources:scanAllIncremental] Starting incremental scan of all sources')
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')

    try {
      const results = await manager.scanAllIncremental((sourceId, sourceName, progress) => {
        onProgress(progress, { sourceId, sourceName })
      })

      console.log('[IPC sources:scanAllIncremental] Incremental scan complete')

      // Convert Map to array for IPC
      return Array.from(results.entries()).map(([key, value]) => ({
        key,
        ...value,
      }))
    } catch (error: unknown) {
      console.error('Error in incremental scan all:', error)
      throw error
    } finally {
      flush()
    }
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get aggregated stats across all sources
   */
  createIpcHandler(IPC_CHANNELS.sourcesGetStats, async () => {
    try {
      return await manager.getAggregatedStats()
    } catch (error: unknown) {
      console.error('Error getting stats:', error)
      throw error
    }
  })

  /**
   * Get supported provider types
   */
  createIpcHandler(IPC_CHANNELS.sourcesGetSupportedProviders, async () => {
    try {
      return manager.getSupportedProviders()
    } catch (error: unknown) {
      console.error('Error getting supported providers:', error)
      throw error
    }
  })

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  /**
   * Detect local Kodi installation
   * Returns installation info or null if not found
   */
  createIpcHandler(IPC_CHANNELS.kodiDetectLocal, async () => {
    try {
      const discovery = getKodiLocalDiscoveryService()
      return await discovery.detectLocalInstallation()
    } catch (error: unknown) {
      console.error('Error detecting local Kodi:', error)
      return null
    }
  })

  /**
   * Check if Kodi process is currently running
   */
  createIpcHandler(IPC_CHANNELS.kodiIsRunning, async () => {
    try {
      const discovery = getKodiLocalDiscoveryService()
      return await discovery.isKodiRunning()
    } catch (error: unknown) {
      console.error('Error checking if Kodi is running:', error)
      return false
    }
  })

  /**
   * Detect local MediaMonkey installation
   * Returns detection result with found installations
   */
  createIpcHandler(IPC_CHANNELS.mediamonkeyDetectLocal, async () => {
    try {
      const discovery = getMediaMonkeyDiscoveryService()
      return await discovery.detect()
    } catch (error: unknown) {
      console.error('Error detecting local MediaMonkey:', error)
      return null
    }
  })

  /**
   * Open file picker for MediaMonkey database
   */
  createIpcHandler(IPC_CHANNELS.mediamonkeySelectDatabase, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select MediaMonkey Database',
        filters: [{ name: 'SQLite Database', extensions: ['db', 'DB'] }],
        properties: ['openFile'],
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    } catch (error: unknown) {
      console.error('Error opening file dialog:', error)
      return null
    }
  })

  /**
   * Check if MediaMonkey process is currently running
   */
  createIpcHandler(IPC_CHANNELS.mediamonkeyIsRunning, async () => {
    try {
      const discovery = getMediaMonkeyDiscoveryService()
      return await discovery.isMediaMonkeyRunning()
    } catch (error: unknown) {
      console.error('Error checking if MediaMonkey is running:', error)
      return false
    }
  })

  /**
   * Import collections from Kodi local database
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.kodiImportCollections, async (event, sourceId: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'kodi:importCollections')
    const provider = manager.getProvider(validSourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    // Check if it's a Kodi local provider
    if (provider.providerType !== 'kodi-local') {
      throw new Error('Collection import is only supported for Kodi local sources')
    }

    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'kodi:collectionProgress', 'media')

    try {
      // Import collections
      const kodiProvider = provider as KodiLocalProvider
      const result = await kodiProvider.importCollections((progress: { current: number; total: number; currentItem: string }) => {
        onProgress(progress)
      })

      return result
    } catch (error: unknown) {
      console.error('Error importing Kodi collections:', error)
      throw error
    } finally {
      flush()
    }
  })

  /**
   * Get collections from Kodi local database (without importing)
   */
  createIpcHandler(IPC_CHANNELS.kodiGetCollections, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'kodi:getCollections')
      const provider = manager.getProvider(validSourceId)
      if (!provider) {
        throw new Error(`Source not found: ${sourceId}`)
      }

      if (provider.providerType !== 'kodi-local') {
        throw new Error('This operation is only supported for Kodi local sources')
      }

      const kodiProvider = provider as KodiLocalProvider
      return await kodiProvider.getCollections()
    } catch (error: unknown) {
      console.error('Error getting Kodi collections:', error)
      throw error
    }
  })

  // ============================================================================
  // KODI MYSQL/MARIADB CONNECTION
  // ============================================================================

  /**
   * Test MySQL/MariaDB connection and detect Kodi databases
   */
  createIpcHandler(IPC_CHANNELS.kodiTestMySQLConnection, async (config: unknown) => {
    try {
      const validConfig = validateInput(KodiMySQLTestConfigSchema, config, 'kodi:testMySQLConnection')
      const connectionService = getKodiMySQLConnectionService()
      const mysqlConfig: KodiMySQLConfig = {
        host: validConfig.host,
        port: validConfig.port || 3306,
        username: validConfig.username,
        password: validConfig.password,
        databasePrefix: validConfig.databasePrefix || 'kodi_',
        ssl: validConfig.ssl,
        connectionTimeout: validConfig.connectionTimeout || 10000,
      }
      return await connectionService.testConnection(mysqlConfig)
    } catch (error: unknown) {
      console.error('Error testing MySQL connection:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Connection test failed',
      }
    }
  })

  /**
   * Detect Kodi databases on MySQL server
   */
  createIpcHandler(IPC_CHANNELS.kodiDetectMySQLDatabases, async (config: unknown) => {
    try {
      const validConfig = validateInput(KodiMySQLTestConfigSchema, config, 'kodi:detectMySQLDatabases')
      const connectionService = getKodiMySQLConnectionService()
      const mysqlConfig: KodiMySQLConfig = {
        host: validConfig.host,
        port: validConfig.port || 3306,
        username: validConfig.username,
        password: validConfig.password,
        databasePrefix: validConfig.databasePrefix || 'kodi_',
      }
      return await connectionService.detectDatabases(mysqlConfig)
    } catch (error: unknown) {
      console.error('Error detecting MySQL databases:', error)
      return {
        videoDatabase: null,
        videoVersion: null,
        musicDatabase: null,
        musicVersion: null,
      }
    }
  })

  /**
   * Add a Kodi MySQL source with authentication
   */
  createIpcHandler(IPC_CHANNELS.kodiAuthenticateMySQL, async (config: unknown) => {
    try {
      const validatedConfig = validateInput(KodiMySQLConfigSchema, config, 'kodi:authenticateMySQL')

      const provider = new KodiMySQLProvider({
        sourceType: 'kodi-mysql' as ProviderType,
        displayName: validatedConfig.displayName,
        connectionConfig: {},
      })

      const authResult = await provider.authenticate({
        host: validatedConfig.host,
        port: validatedConfig.port || 3306,
        username: validatedConfig.username,
        password: validatedConfig.password,
        videoDatabaseName: validatedConfig.videoDatabaseName,
        musicDatabaseName: validatedConfig.musicDatabaseName,
        databasePrefix: validatedConfig.databasePrefix || 'kodi_',
        ssl: validatedConfig.ssl,
      })

      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error,
        }
      }

      // Add the source to the database
      const manager = getSourceManager()
      const source = await manager.addSource({
        sourceType: 'kodi-mysql' as ProviderType,
        displayName: validatedConfig.displayName,
        connectionConfig: provider.getConnectionConfig(),
        isEnabled: true,
      })

      return {
        success: true,
        source,
        serverName: authResult.serverName,
        serverVersion: authResult.serverVersion,
      }
    } catch (error: unknown) {
      console.error('Error authenticating Kodi MySQL:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  })

  // ============================================================================
  // FFPROBE FILE ANALYSIS
  // ============================================================================

  /**
   * Check if FFprobe is available on the system
   */
  createIpcHandler(IPC_CHANNELS.ffprobeIsAvailable, async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.isAvailable()
    } catch (error: unknown) {
      console.error('Error checking FFprobe availability:', error)
      return false
    }
  })

  /**
   * Get FFprobe version
   */
  createIpcHandler(IPC_CHANNELS.ffprobeGetVersion, async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.getVersion()
    } catch (error: unknown) {
      console.error('Error getting FFprobe version:', error)
      return null
    }
  })

  /**
   * Analyze a media file with FFprobe
   */
  createIpcHandler(IPC_CHANNELS.ffprobeAnalyzeFile, async (filePath: unknown) => {
    try {
      const validFilePath = validateInput(FilePathSchema, filePath, 'ffprobe:analyzeFile')
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.analyzeFile(validFilePath)
    } catch (error: unknown) {
      console.error('Error analyzing file:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Failed to analyze file',
        filePath,
        audioTracks: [],
        subtitleTracks: [],
      }
    }
  })

  /**
   * Enable/disable FFprobe analysis for a Kodi source
   */
  createIpcHandler(IPC_CHANNELS.ffprobeSetEnabled, async (sourceId: unknown, enabled: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'ffprobe:setEnabled')
      const validEnabled = validateInput(BooleanSchema, enabled, 'ffprobe:setEnabled')
      const provider = manager.getProvider(validSourceId)
      if (!provider) {
        throw new Error(`Source not found: ${sourceId}`)
      }

      if (provider.providerType !== 'kodi-local') {
        throw new Error('FFprobe analysis is only supported for Kodi local sources')
      }

      const kodiProvider = provider as KodiLocalProvider
      kodiProvider.setFFprobeAnalysis(validEnabled)
      return { success: true, enabled: validEnabled }
    } catch (error: unknown) {
      console.error('Error setting FFprobe analysis:', error)
      throw error
    }
  })

  /**
   * Check if FFprobe analysis is enabled for a source
   */
  createIpcHandler(IPC_CHANNELS.ffprobeIsEnabled, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'ffprobe:isEnabled')
      const provider = manager.getProvider(validSourceId)
      if (!provider) {
        return false
      }

      if (provider.providerType !== 'kodi-local') {
        return false
      }

      const kodiProvider = provider as KodiLocalProvider
      return kodiProvider.isFFprobeAnalysisEnabled()
    } catch (error: unknown) {
      console.error('Error checking FFprobe status:', error)
      return false
    }
  })

  /**
   * Check if FFprobe is available for a specific Kodi source
   * (combines system check with provider support)
   */
  createIpcHandler(IPC_CHANNELS.ffprobeIsAvailableForSource, async (sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'ffprobe:isAvailableForSource')
      const provider = manager.getProvider(validSourceId)
      if (!provider || provider.providerType !== 'kodi-local') {
        return { available: false, reason: 'Source is not a Kodi local source' }
      }

      const kodiProvider = provider as KodiLocalProvider
      const isAvailable = await kodiProvider.isFFprobeAvailable()
      const version = isAvailable ? await kodiProvider.getFFprobeVersion() : null

      return {
        available: isAvailable,
        version,
        reason: isAvailable ? null : 'FFprobe not found on system. Install FFmpeg to enable file analysis.',
      }
    } catch (error: unknown) {
      console.error('Error checking FFprobe for source:', error)
      return { available: false, reason: getErrorMessage(error) }
    }
  })

  /**
   * Check if FFprobe can be auto-installed on this platform
   */
  createIpcHandler(IPC_CHANNELS.ffprobeCanInstall, async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return analyzer.canInstall()
    } catch (error: unknown) {
      console.error('Error checking FFprobe install capability:', error)
      return false
    }
  })

  /**
   * Install FFprobe automatically
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.ffprobeInstall, async (event) => {
    try {
      const analyzer = getMediaFileAnalyzer()
      const win = getWindowFromEvent(event)

      const result = await analyzer.installFFprobe((progress) => {
        // Send progress updates to renderer
        safeSend(win, IPC_CHANNELS.ffprobeInstallProgress, progress)
      })

      return result
    } catch (error: unknown) {
      console.error('Error installing FFprobe:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Installation failed',
      }
    }
  })

  /**
   * Uninstall bundled FFprobe
   */
  createIpcHandler(IPC_CHANNELS.ffprobeUninstall, async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      const success = await analyzer.uninstallFFprobe()
      return { success }
    } catch (error: unknown) {
      console.error('Error uninstalling FFprobe:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Check for FFprobe updates
   */
  createIpcHandler(IPC_CHANNELS.ffprobeCheckForUpdate, async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.checkForUpdate()
    } catch (error: unknown) {
      console.error('Error checking for FFprobe update:', error)
      return {
        currentVersion: null,
        latestVersion: null,
        updateAvailable: false,
        error: getErrorMessage(error),
      }
    }
  })

  /**
   * Check if current FFprobe is the bundled version
   */
  createIpcHandler(IPC_CHANNELS.ffprobeIsBundled, async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.isBundledVersion()
    } catch (error: unknown) {
      console.error('Error checking FFprobe bundle status:', error)
      return false
    }
  })

  /**
   * Check if FFmpeg is available (needed for embedded artwork extraction)
   */
  createIpcHandler(IPC_CHANNELS.ffmpegIsAvailable, async () => {
    try {
      const analyzer = getMediaFileAnalyzer()
      return await analyzer.isFFmpegAvailable()
    } catch {
      return false
    }
  })

  // ============================================================================
  // LOCAL FOLDER SOURCE
  // ============================================================================

  /**
   * Open folder picker dialog for selecting a local media folder
   */
  createIpcHandlerWithEvent(IPC_CHANNELS.localSelectFolder, async (event) => {
    try {
      const win = getWindowFromEvent(event)
      if (!win) {
        return { cancelled: true }
      }

      const result = await dialog.showOpenDialog(win, {
        title: 'Select Media Folder',
        properties: ['openDirectory'],
        buttonLabel: 'Select Folder',
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true }
      }

      return {
        cancelled: false,
        folderPath: result.filePaths[0],
      }
    } catch (error: unknown) {
      console.error('Error opening folder dialog:', error)
      return { cancelled: true, error: getErrorMessage(error) }
    }
  })

  /**
   * Detect subfolders in a local folder and guess their media type
   */
  createIpcHandler(IPC_CHANNELS.localDetectSubfolders, async (folderPath: unknown) => {
    try {
      const validFolderPath = validateInput(FilePathSchema, folderPath, 'local:detectSubfolders')
      const entries = await fs.readdir(validFolderPath, { withFileTypes: true })
      const subfolders: Array<{
        name: string
        path: string
        suggestedType: 'movies' | 'tvshows' | 'music' | 'unknown'
      }> = []

      // Known folder name patterns
      const moviePatterns = ['movies', 'films', 'movie', 'film']
      const tvPatterns = ['tv shows', 'tv', 'shows', 'series', 'television', 'tvshows']
      const musicPatterns = ['music', 'audio', 'songs', 'albums', 'artists']

      // System folders to skip
      const skipFolders = ['@eadir', '.ds_store', 'thumbs', 'metadata', '$recycle.bin', 'system volume information']

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const folderName = entry.name.toLowerCase()

        // Skip system/hidden folders
        if (skipFolders.includes(folderName) || folderName.startsWith('.')) continue

        // Detect media type from folder name
        let suggestedType: 'movies' | 'tvshows' | 'music' | 'unknown' = 'unknown'

        if (moviePatterns.includes(folderName)) {
          suggestedType = 'movies'
        } else if (tvPatterns.includes(folderName)) {
          suggestedType = 'tvshows'
        } else if (musicPatterns.includes(folderName)) {
          suggestedType = 'music'
        }

        subfolders.push({
          name: entry.name,
          path: path.join(validFolderPath, entry.name),
          suggestedType,
        })
      }

      // Sort: known types first, then alphabetically
      subfolders.sort((a, b) => {
        if (a.suggestedType !== 'unknown' && b.suggestedType === 'unknown') return -1
        if (a.suggestedType === 'unknown' && b.suggestedType !== 'unknown') return 1
        return a.name.localeCompare(b.name)
      })

      return { subfolders }
    } catch (error: unknown) {
      console.error('Error detecting subfolders:', error)
      return { subfolders: [], error: getErrorMessage(error) }
    }
  })

  /**
   * Add a local folder as a media source with specific library configurations
   */
  createIpcHandler(IPC_CHANNELS.localAddSourceWithLibraries, async (config: unknown) => {
    const validated = validateInput(LocalFolderWithLibrariesSchema, config, 'local:addSourceWithLibraries')
    try {
      // Create the source with 'mixed' type - we'll handle library creation manually
      const source = await manager.addSource({
        sourceType: 'local',
        displayName: validated.displayName,
        connectionConfig: {
          folderPath: validated.folderPath,
          mediaType: 'mixed',
          name: validated.displayName,
          // Store the custom library config
          customLibraries: validated.libraries,
        },
        isEnabled: true,
      })

      return source
    } catch (error: unknown) {
      console.error('Error adding local folder source with libraries:', error)
      throw error
    }
  })

  /**
   * Add a local folder as a media source
   */
  createIpcHandler(IPC_CHANNELS.localAddSource, async (config: unknown) => {
    const validated = validateInput(LocalFolderConfigSchema, config, 'local:addSource')
    try {
      return await manager.addSource({
        sourceType: 'local',
        displayName: validated.displayName,
        connectionConfig: {
          folderPath: validated.folderPath,
          mediaType: validated.mediaType,
          name: validated.displayName,
        },
        isEnabled: true,
      })
    } catch (error: unknown) {
      console.error('Error adding local folder source:', error)
      throw error
    }
  })

  console.log('[IPC] Source handlers registered')
}
