import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * IPC Handlers for Source Management
 *
 * Handles all source-related IPC calls from the renderer process.
 */

import { ipcMain, dialog, shell, IpcMainInvokeEvent } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getSourceManager } from '@main/services/SourceManager'
import { getLoggingService } from '@main/services/LoggingService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getKodiLocalDiscoveryService } from '@main/services/KodiLocalDiscoveryService'
import { getKodiMySQLConnectionService } from '@main/services/KodiMySQLConnectionService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { LibraryType, ProviderType } from '@main/types/database'
import { safeSend, getWindowFromEvent } from '@main/ipc/utils/safeSend'
import { createProgressUpdater } from '@main/ipc/utils/progressUpdater'
import { createValidatedIpcHandler, createValidatedIpcHandlerWithEvent, createIpcHandler } from '@main/ipc/utils/createHandler'
import {
  AddSourceSchema,
  UpdateSourceTupleSchema,
  ToggleSourceTupleSchema,
  ToggleLibraryTupleSchema,
  ScanLibraryTupleSchema,
  ScanItemTupleSchema,
  PlexAuthTupleSchema,
  SourceIdSchema,
  SafeUrlSchema,
  KodiMySQLConfigSchema,
  KodiMySQLTestConfigSchema,
  LocalFolderConfigSchema,
  LocalFolderWithLibrariesSchema,
  FilePathSchema,
  validateInput,
} from '@main/validation/schemas'
import { z } from 'zod'
import { KodiMySQLProvider } from '@main/providers/kodi/KodiMySQLProvider'
import { MediaMonkeyProvider } from '@main/providers/mediamonkey/MediaMonkeyProvider'

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
  ipcMain.handle('app:openExternal', async (_event, url: unknown) => {
    const validUrl = validateInput(SafeUrlSchema, url, 'app:openExternal')
    getLoggingService().info('[IPC app:openExternal]', validUrl)
    await shell.openExternal(validUrl)
  })

  // ============================================================================
  // SOURCE CRUD
  // ============================================================================

  createValidatedIpcHandler(IPC_CHANNELS.SOURCES.ADD, AddSourceSchema, async (config) => {
    return await manager.addSource(config)
  })

  createValidatedIpcHandler('sources:update', UpdateSourceTupleSchema, async (sourceId, updates) => {
    await manager.updateSource(sourceId, updates)
  })

  createValidatedIpcHandler(IPC_CHANNELS.SOURCES.REMOVE, SourceIdSchema, async (sourceId) => {
    await manager.removeSource(sourceId)
  })

  createIpcHandler(IPC_CHANNELS.SOURCES.LIST, async (type?: ProviderType) => {
    return await manager.getSources(type)
  })

  createValidatedIpcHandler('sources:get', SourceIdSchema, async (sourceId) => {
    return await manager.getSource(sourceId)
  })

  createIpcHandler(IPC_CHANNELS.SOURCES.GET_ACTIVE, async () => {
    return await manager.getEnabledSources()
  })

  createIpcHandler(IPC_CHANNELS.SOURCES.GET_SUPPORTED_PROVIDERS, async () => {
    return manager.getSupportedProviders()
  })

  createValidatedIpcHandler(IPC_CHANNELS.SOURCES.TOGGLE, ToggleSourceTupleSchema, async (sourceId, enabled) => {
    await manager.toggleSource(sourceId, enabled)
  })

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  createValidatedIpcHandler(IPC_CHANNELS.SOURCES.TEST_CONNECTION, SourceIdSchema, async (sourceId) => {
    return await manager.testConnection(sourceId)
  })

  // ============================================================================
  // PLEX AUTH
  // ============================================================================

  createIpcHandler('plex:startAuth', async () => {
    return await manager.plexStartAuth()
  })

  createValidatedIpcHandler('plex:completeAuth', z.number(), async (pinId) => {
    return await manager.plexCompleteAuth(pinId)
  })

  createValidatedIpcHandler('plex:authenticateAndDiscover', PlexAuthTupleSchema, async (token, displayName) => {
    return await manager.plexAuthenticateAndDiscover(token, displayName)
  })

  ipcMain.handle('plex:selectServer', async (_event, sourceIdOrServerId: string, serverId?: string) => {
    if (serverId) return await manager.plexSelectServer(sourceIdOrServerId, serverId)
    const plexSources = await manager.getSources(ProviderType.Plex)
    if (plexSources.length > 0) return await manager.plexSelectServer(plexSources[0].source_id, sourceIdOrServerId)
    throw new Error('No Plex source found')
  })

  createIpcHandler('plex:getServers', async (sourceId?: string) => {
    if (sourceId) return await manager.plexGetServers(sourceId)
    const plexSources = await manager.getSources(ProviderType.Plex)
    if (plexSources.length > 0) return await manager.plexGetServers(plexSources[0].source_id)
    throw new Error('No Plex source found')
  })

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  createValidatedIpcHandler('sources:getLibraries', SourceIdSchema, async (sourceId) => {
    try {
      return await manager.getLibraries(sourceId)
    } catch { return [] }
  })

  createValidatedIpcHandler(IPC_CHANNELS.SOURCES.GET_LIBRARIES_WITH_STATUS, SourceIdSchema, async (sourceId) => {
    try {
      const db = getDatabase()
      const libraries = await manager.getLibraries(sourceId)
      const storedLibraries = await db.sources.getSourceLibraries(sourceId) as any[]
      const storedMap = new Map(storedLibraries.map(l => [l.libraryId, l]))

      return libraries.map(lib => {
        const stored = storedMap.get(lib.id)
        return {
          ...lib,
          isEnabled: stored ? !!stored.isEnabled : true,
          isProtected: stored ? !!stored.isProtected : false,
          lastScanAt: stored?.lastScanAt || null,
          itemsScanned: stored?.itemsScanned || 0,
        }
      })
    } catch { return [] }
  })

  createValidatedIpcHandlerWithEvent('sources:toggleLibrary', ToggleLibraryTupleSchema, async (event: IpcMainInvokeEvent, sourceId, libraryId, enabled) => {
    const db = getDatabase()
    await db.sources.toggleLibrary(sourceId, libraryId, enabled)
    const win = getWindowFromEvent(event)
    safeSend(win, 'library:updated', { type: 'libraryToggle', sourceId, libraryId, enabled })
    return { success: true }
  })

  createValidatedIpcHandler(IPC_CHANNELS.SOURCES.SET_LIBRARIES_ENABLED, z.tuple([SourceIdSchema, z.array(z.any())]), async (sourceId, libraries) => {
    const db = getDatabase()
    await db.sources.setLibrariesEnabled(sourceId, libraries)
    return { success: true }
  })

  createValidatedIpcHandler('sources:getEnabledLibraryIds', SourceIdSchema, async (sourceId) => {
    const db = getDatabase()
    return await db.sources.getEnabledLibraryIds(sourceId)
  })

  createIpcHandler('sources:stopScan', async () => {
    manager.stopScan()
    return { success: true }
  })

  createValidatedIpcHandlerWithEvent('sources:scanLibrary', ScanLibraryTupleSchema, async (event: IpcMainInvokeEvent, sourceId, libraryId) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
    try {
      const result = await manager.scanLibrary(sourceId, libraryId, onProgress)
      if (result.success && !result.cancelled) {
        const source = await manager.getSource(sourceId)
        safeSend(win, 'scan:completed', { sourceId, libraryId, libraryName: source?.display_name || 'Library', itemsScanned: result.itemsScanned, itemsAdded: result.itemsAdded, itemsUpdated: result.itemsUpdated, isFirstScan: false })
      }
      return result
    } finally { flush() }
  })

  createValidatedIpcHandlerWithEvent('sources:scanAll', z.any().optional(), async (event: IpcMainInvokeEvent) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
    try {
      const results = await manager.scanAllSources((sId, sName, p) => onProgress(p, { sourceId: sId, sourceName: sName }))
      for (const [key, result] of results.entries()) {
        if (result.success && !result.cancelled) {
          const [sId, lId] = key.split(':')
          const source = await manager.getSource(sId)
          safeSend(win, 'scan:completed', { sourceId: sId, libraryId: lId, libraryName: source?.display_name || 'Library', itemsScanned: result.itemsScanned, itemsAdded: result.itemsAdded, itemsUpdated: result.itemsUpdated, isFirstScan: (result as any).isFirstScan || false })
        }
      }
      return Array.from(results.entries()).map(([key, value]) => ({ key, ...value }))
    } finally { flush() }
  })

  // ============================================================================
  // INCREMENTAL SCANNING
  // ============================================================================

  createValidatedIpcHandlerWithEvent('sources:scanItem', ScanItemTupleSchema, async (event: IpcMainInvokeEvent, sourceId, libraryId, filePath) => {
    const win = getWindowFromEvent(event)
    let resolvedLibraryId = libraryId
    if (!resolvedLibraryId) {
      const provider = manager.getProvider(sourceId)
      resolvedLibraryId = (provider?.providerType === ProviderType.KodiLocal || provider?.providerType === ProviderType.KodiMySQL) ? 'movies' : 'movie'
    }
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
    try {
      return await manager.scanTargetedFiles(sourceId, resolvedLibraryId, [filePath], (p) => onProgress(p, { sourceId, libraryId: resolvedLibraryId }))
    } finally { flush() }
  })

  createValidatedIpcHandlerWithEvent('sources:scanLibraryIncremental', ScanLibraryTupleSchema, async (event: IpcMainInvokeEvent, sourceId, libraryId) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
    try {
      const result = await manager.scanLibraryIncremental(sourceId, libraryId, onProgress)
      if (result.success && !result.cancelled) {
        const source = await manager.getSource(sourceId)
        safeSend(win, 'scan:completed', { sourceId, libraryId, libraryName: source?.display_name || 'Library', itemsScanned: result.itemsScanned, itemsAdded: result.itemsAdded, itemsUpdated: result.itemsUpdated, isFirstScan: false })
      }
      return result
    } finally { flush() }
  })

  createValidatedIpcHandlerWithEvent('sources:scanAllIncremental', z.any().optional(), async (event: IpcMainInvokeEvent) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'sources:scanProgress', 'media')
    try {
      const results = await manager.scanAllIncremental((sId, sName, p) => onProgress(p, { sourceId: sId, sourceName: sName }))
      for (const [key, result] of results.entries()) {
        if (result.success && !result.cancelled) {
          const [sId, lId] = key.split(':')
          const source = await manager.getSource(sId)
          safeSend(win, 'scan:completed', { sourceId: sId, libraryId: lId, libraryName: source?.display_name || 'Library', itemsScanned: result.itemsScanned, itemsAdded: result.itemsAdded, itemsUpdated: result.itemsUpdated, isFirstScan: false })
        }
      }
      return Array.from(results.entries()).map(([key, value]) => ({ key, ...value }))
    } finally { flush() }
  })

  // ============================================================================
  // STATISTICS
  // ============================================================================

  createIpcHandler(IPC_CHANNELS.SOURCES.GET_STATS, async (sourceId?: string) => {
    if (sourceId) {
      const db = getDatabase()
      return await db.stats.getSourceStats(sourceId)
    }
    return await manager.getAggregatedStats()
  })

  // ============================================================================
  // KODI LOCAL DETECTION
  // ============================================================================

  createIpcHandler('kodi:detectLocal', async () => {
    const discovery = getKodiLocalDiscoveryService()
    return await discovery.detectLocalInstallation()
  })

  createIpcHandler('kodi:isRunning', async () => {
    const discovery = getKodiLocalDiscoveryService()
    return await discovery.isKodiRunning()
  })

  createValidatedIpcHandlerWithEvent('kodi:importCollections', SourceIdSchema, async (event: IpcMainInvokeEvent, sourceId) => {
    const provider = manager.getProvider(sourceId)
    if (provider?.providerType !== ProviderType.KodiLocal) throw new Error('Not a Kodi local source')
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'kodi:collectionProgress', 'media')
    try {
      return await (provider as any).importCollections(onProgress)
    } finally { flush() }
  })

  // ============================================================================
  // KODI MYSQL
  // ============================================================================

  createValidatedIpcHandler('kodi:testMySQLConnection', KodiMySQLTestConfigSchema, async (config) => {
    const service = getKodiMySQLConnectionService()
    return await service.testConnection({ ...config, port: config.port || 3306, databasePrefix: config.databasePrefix || 'kodi_', connectionTimeout: config.connectionTimeout || 10000 } as any)
  })

  createValidatedIpcHandler('kodi:authenticateMySQL', KodiMySQLConfigSchema, async (config) => {
    const provider = new KodiMySQLProvider({ sourceType: ProviderType.KodiMySQL, displayName: config.displayName, connectionConfig: {} })
    const res = await provider.authenticate({ ...config, port: config.port || 3306, databasePrefix: config.databasePrefix || 'kodi_' } as any)
    if (!res.success) return { success: false, error: res.error }
    const source = await manager.addSource({ sourceType: ProviderType.KodiMySQL, displayName: config.displayName, connectionConfig: provider.getConnectionConfig(), isEnabled: true })
    return { success: true, source, serverName: res.serverName, serverVersion: res.serverVersion }
  })

  // ============================================================================
  // FFPROBE
  // ============================================================================

  createIpcHandler('ffprobe:isAvailable', async () => {
    return await getMediaFileAnalyzer().isAvailable()
  })

  createIpcHandler('ffprobe:getVersion', async () => {
    return await getMediaFileAnalyzer().getVersion()
  })

  createValidatedIpcHandler('ffprobe:analyzeFile', z.string(), async (filePath) => {
    return await getMediaFileAnalyzer().analyzeFile(filePath)
  })

  createValidatedIpcHandler('ffprobe:setEnabled', z.tuple([SourceIdSchema, z.boolean()]), async (sourceId, enabled) => {
    const provider = manager.getProvider(sourceId)
    if (provider?.providerType !== ProviderType.KodiLocal) throw new Error('Not a Kodi local source')
    ;(provider as any).setFFprobeAnalysis(enabled)
    return { success: true, enabled }
  })

  createValidatedIpcHandler('ffprobe:isEnabled', SourceIdSchema, async (sourceId) => {
    const provider = manager.getProvider(sourceId)
    return provider?.providerType === ProviderType.KodiLocal ? (provider as any).isFFprobeAnalysisEnabled() : false
  })

  createValidatedIpcHandler('ffprobe:isAvailableForSource', SourceIdSchema, async (sourceId) => {
    const provider = manager.getProvider(sourceId)
    if (provider?.providerType !== ProviderType.KodiLocal) return { available: false, reason: 'Not a Kodi local source' }
    const available = await (provider as any).isFFprobeAvailable()
    const version = available ? await (provider as any).getFFprobeVersion() : null
    return { available, version, reason: available ? null : 'FFprobe not found' }
  })

  createIpcHandler('ffprobe:canInstall', async () => {
    return getMediaFileAnalyzer().canInstall()
  })

  createValidatedIpcHandlerWithEvent('ffprobe:install', z.any().optional(), async (event: IpcMainInvokeEvent) => {
    const win = getWindowFromEvent(event)
    return await getMediaFileAnalyzer().installFFprobe((p) => safeSend(win, 'ffprobe:installProgress', p))
  })

  createIpcHandler('ffprobe:uninstall', async () => {
    return { success: await getMediaFileAnalyzer().uninstallFFprobe() }
  })

  createIpcHandler('ffprobe:checkForUpdate', async () => {
    return await getMediaFileAnalyzer().checkForUpdate()
  })

  createIpcHandler('ffprobe:isBundled', async () => {
    return await getMediaFileAnalyzer().isBundledVersion()
  })

  // ============================================================================
  // LOCAL FOLDER
  // ============================================================================

  createIpcHandler('local:selectFolder', async (event: any) => {
    const win = getWindowFromEvent(event)
    if (!win) return { cancelled: true }
    const result = await dialog.showOpenDialog(win, { title: 'Select Media Folder', properties: ['openDirectory'], buttonLabel: 'Select Folder' })
    return result.canceled || result.filePaths.length === 0 ? { cancelled: true } : { cancelled: false, folderPath: result.filePaths[0] }
  })

  createIpcHandler('local:selectFile', async (event: any, options?: any) => {
    const win = getWindowFromEvent(event)
    if (!win) return { cancelled: true }
    const result = await dialog.showOpenDialog(win, options || { title: 'Select File', properties: ['openFile'] })
    return result.canceled || result.filePaths.length === 0 ? { cancelled: true } : { cancelled: false, filePath: result.filePaths[0] }
  })

  createValidatedIpcHandler('local:detectSubfolders', FilePathSchema, async (folderPath) => {
    const entries = await fs.readdir(folderPath, { withFileTypes: true })
    const subfolders = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== '@eadir').map(e => {
      const name = e.name.toLowerCase()
      let suggestedType = LibraryType.Unknown
      if (['movies', 'films', 'movie'].some(p => name.includes(p))) suggestedType = LibraryType.Movie
      else if (['tv shows', 'tv', 'shows', 'series'].some(p => name.includes(p))) suggestedType = LibraryType.Show
      else if (['music', 'audio', 'songs'].some(p => name.includes(p))) suggestedType = LibraryType.Music
      return { name: e.name, path: path.join(folderPath, e.name), suggestedType }
    })
    return { subfolders: subfolders.sort((a, b) => a.name.localeCompare(b.name)) }
  })

  createValidatedIpcHandler('mediamonkey:addSource', z.object({ databasePath: z.string(), displayName: z.string(), isEnabled: z.boolean() }), async (config) => {
    return await manager.addSource({ sourceType: ProviderType.MediaMonkey, displayName: config.displayName, connectionConfig: { databasePath: config.databasePath }, isEnabled: config.isEnabled })
  })

  createValidatedIpcHandler('mediamonkey:testConnection', z.object({ databasePath: z.string() }), async (config) => {
    const provider = new MediaMonkeyProvider({ sourceType: ProviderType.MediaMonkey, displayName: 'Test', connectionConfig: { databasePath: config.databasePath } })
    return await provider.testConnection()
  })

  createValidatedIpcHandler('local:addSource', LocalFolderConfigSchema, async (config) => {
    return await manager.addSource({ sourceType: ProviderType.Local, displayName: config.displayName, connectionConfig: { folderPath: config.folderPath, mediaType: config.mediaType as LibraryType, name: config.displayName }, isEnabled: true })
  })

  createValidatedIpcHandler('local:addSourceWithLibraries', LocalFolderWithLibrariesSchema, async (config) => {
    return await manager.addSource({ sourceType: ProviderType.Local, displayName: config.displayName, connectionConfig: { folderPath: config.folderPath, mediaType: LibraryType.Mixed, name: config.displayName, customLibraries: config.libraries as any }, isEnabled: true })
  })

  getLoggingService().info('[sources]', '[IPC] Source handlers registered')
}
