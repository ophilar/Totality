import { vi } from 'vitest'
import { BetterSQLiteService, resetBetterSQLiteServiceForTesting, getDatabase } from '@main/database/BetterSQLiteService'
import * as dbFuncs from '@main/database/BetterSQLiteService'
import path from 'node:path'
import fs from 'node:fs'
import { ipcMain } from 'electron'

/**
 * Setup a clean test database
 */
export async function setupTestDb() {
  const workerId = process.env.VITEST_WORKER_ID || process.pid
  const dbDir = path.resolve(process.cwd(), 'tests/tmp', `worker-${workerId}`)
  
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const dbId = Math.random().toString(36).substring(7)
  const dbPath = path.join(dbDir, `test-${dbId}.db`)
  
  // Reset the singleton
  resetBetterSQLiteServiceForTesting()
  
  const dbService = getDatabase()
  await dbService.initialize(dbPath)
  
  return dbService
}

/**
 * Cleanup test database
 */
export function cleanupTestDb() {
  resetBetterSQLiteServiceForTesting()
}

import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { registerSeriesHandlers } from '@main/ipc/series'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerMusicHandlers } from '@main/ipc/music'
import { registerSourceHandlers } from '@main/ipc/sources'
import { registerCollectionHandlers } from '@main/ipc/collections'
import { registerTaskQueueHandlers } from '@main/ipc/taskQueue'
import { registerWishlistHandlers } from '@main/ipc/wishlist'

/**
 * Sets up a real bridge between Renderer and Main process handlers.
 */
export function setupRealIntegratedBridge() {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()

  // Intercept registrations
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
    handlers.set(channel, handler)
    return undefined as any
  })

  // Register real handlers (The DB must be initialized before this)
  registerSeriesHandlers()
  registerDatabaseHandlers()
  registerMusicHandlers()
  registerSourceHandlers()
  registerCollectionHandlers()
  registerTaskQueueHandlers()
  registerWishlistHandlers()

  // Helper to invoke a handler with safety and logging
  const invoke = async (channel: string, ...args: any[]) => {
    if (!channel) return undefined
    const handler = handlers.get(channel)
    
    if (!handler) {
      if (channel.includes(':count')) return 0
      if (channel.includes(':list') || channel.includes('getAll')) return []
      if (channel.includes('getStats')) return {}
      return undefined
    }

    const event = { sender: { send: vi.fn() } }
    try {
      const result = await handler(event, ...args)
      // Safety: Never return undefined for list/count channels
      if (result === undefined) {
        if (channel.includes(':count')) return 0
        if (channel.includes(':list') || channel.includes('getAll')) return []
      }
      return result
    } catch (e) {
      if (e instanceof Error && e.message.includes('Database not initialized')) return []
      return undefined
    }
  }

  // Create an exhaustive API object that matches preload scripts
  const api: any = {
    // Database / Media retrieval
    getMediaItems: (f: any) => invoke('db:getMediaItems', f),
    countMediaItems: (f: any) => invoke('db:countMediaItems', f),
    mediaList: (f: any) => invoke(IPC_CHANNELS.DATABASE.MEDIA_LIST, f),
    mediaCount: (f: any) => invoke(IPC_CHANNELS.DATABASE.MEDIA_COUNT, f),
    getTVShows: (f: any) => invoke('db:getTVShows', f),
    countTVShows: (f: any) => invoke('db:countTVShows', f),
    getLibraryOverview: (sId: string) => invoke(IPC_CHANNELS.DATABASE.GET_LIBRARY_OVERVIEW, sId),
    getDashboardSummary: (sId?: string) => invoke(IPC_CHANNELS.DATABASE.GET_DASHBOARD_SUMMARY, sId).then(r => r || {}),
    tvShowList: (f: any) => invoke(IPC_CHANNELS.DATABASE.TVSHOWS_LIST, f),
    tvShowCount: (f: any) => invoke(IPC_CHANNELS.DATABASE.TVSHOWS_COUNT, f),
    getLibraryStats: (sId: string) => invoke(IPC_CHANNELS.DATABASE.GET_LIBRARY_STATS, sId).then(r => r || {}),
    getSetting: (k: string) => invoke(IPC_CHANNELS.DATABASE.GET_SETTING, k).then(r => r || ''),
    getAllSettings: () => invoke(IPC_CHANNELS.DATABASE.GET_ALL_SETTINGS).then(r => r || {}),
    
    // Music
    musicGetArtists: (f: any) => invoke('music:getArtists', f),
    musicArtistList: (f: any) => invoke('music:artists:list', f),
    musicArtistCount: (f: any) => invoke('music:artists:count', f).then(r => r || 0),
    musicGetAlbums: (f: any) => invoke('music:getAlbums', f),
    musicAlbumList: (f: any) => invoke('music:albums:list', f),
    musicAlbumCount: (f: any) => invoke('music:albums:count', f).then(r => r || 0),
    musicGetTracks: (f: any) => invoke('music:getTracks', f),
    musicTrackList: (f: any) => invoke('music:tracks:list', f),
    musicTrackCount: (f: any) => invoke('music:tracks:count', f).then(r => r || 0),
    musicGetTracksByAlbum: (id: number) => invoke(IPC_CHANNELS.MUSIC.GET_TRACKS_BY_ALBUM, id),
    musicGetAlbumCompleteness: (id: number) => invoke(IPC_CHANNELS.MUSIC.GET_ALBUM_COMPLETENESS, id),
    musicGetAllArtistCompleteness: (sId: string) => invoke(IPC_CHANNELS.MUSIC.GET_ALL_ARTIST_COMPLETENESS, sId),

    // Sources
    sourcesList: (t: any) => invoke(IPC_CHANNELS.SOURCES.LIST, t).then(r => r || []),
    sourcesGetActive: () => invoke(IPC_CHANNELS.SOURCES.GET_ACTIVE),
    sourcesGetLibrariesWithStatus: (sId: string) => invoke(IPC_CHANNELS.SOURCES.GET_LIBRARIES_WITH_STATUS, sId).then(r => r || []),
    sourcesGetStats: (sId?: string) => invoke(IPC_CHANNELS.SOURCES.GET_STATS, sId).then(r => r || {}),
    sourcesGetSupportedProviders: () => invoke(IPC_CHANNELS.SOURCES.GET_SUPPORTED_PROVIDERS).then(r => r || []),
    
    // Series / Collections
    seriesGetAll: (sId: string) => invoke('series:getAll', sId).then(r => r || []),
    seriesGetEpisodes: (t: string, sId: string) => invoke('series:getEpisodes', t, sId).then(r => r || []),
    collectionsGetAll: (sId: string) => invoke(IPC_CHANNELS.COLLECTIONS.GET_ALL, sId).then(r => r || []),

    // Wishlist
    wishlistGetAll: (f: any) => invoke(IPC_CHANNELS.WISHLIST.GET_ALL, f).then(r => r || []),
    wishlistGetCount: () => invoke(IPC_CHANNELS.WISHLIST.GET_COUNT).then(r => r || 0),
    wishlistGetCountsByReason: () => invoke(IPC_CHANNELS.WISHLIST.GET_COUNTS_BY_REASON).then(r => r || {}),
    wishlistGetRegion: () => invoke(IPC_CHANNELS.WISHLIST.GET_REGION).then(r => r || 'US'),
    wishlistAdd: (i: any) => invoke(IPC_CHANNELS.WISHLIST.ADD, i),
    wishlistDelete: (id: number) => invoke(IPC_CHANNELS.WISHLIST.DELETE, id),
    wishlistUpdateStatus: (id: number, s: string) => invoke(IPC_CHANNELS.WISHLIST.UPDATE_STATUS, id, s),
    wishlistUpdatePriority: (id: number, p: number) => invoke(IPC_CHANNELS.WISHLIST.UPDATE_PRIORITY, id, p),

    // Source Management
    sourcesUpsert: (s: any) => invoke(IPC_CHANNELS.SOURCES.UPSERT, s),
    sourcesDelete: (id: string) => invoke(IPC_CHANNELS.SOURCES.DELETE, id),
    sourcesToggle: (id: string, e: boolean) => invoke(IPC_CHANNELS.SOURCES.TOGGLE, id, e),
    sourcesSetLibrariesEnabled: (id: string, l: any[]) => invoke(IPC_CHANNELS.SOURCES.SET_LIBRARIES_ENABLED, id, l),
    sourcesSetLibraryProtected: (sId: string, lId: string, p: boolean) => invoke(IPC_CHANNELS.SOURCES.SET_LIBRARY_PROTECTED, sId, lId, p),
    
    // Database Management
    dbReset: () => invoke(IPC_CHANNELS.DATABASE.RESET),
    dbImport: (d: any) => invoke(IPC_CHANNELS.DATABASE.IMPORT, d),
    dbExport: () => invoke(IPC_CHANNELS.DATABASE.EXPORT),
    dbRunLibraryScan: (sId: string) => invoke(IPC_CHANNELS.DATABASE.RUN_LIBRARY_SCAN, sId),
    dbRunCompletenessAnalysis: (sId: string) => invoke(IPC_CHANNELS.DATABASE.RUN_COMPLETENESS_ANALYSIS, sId),
    dbOptimize: () => invoke(IPC_CHANNELS.DATABASE.OPTIMIZE),
    dbRematchItem: (id: number, t: any) => invoke(IPC_CHANNELS.DATABASE.REMATCH_ITEM, id, t),
    dbIgnoreDuplicate: (sId: string, eId: string, t: string) => invoke(IPC_CHANNELS.DATABASE.IGNORE_DUPLICATE, sId, eId, t),

    // Task Queue
    taskQueueGetState: () => invoke(IPC_CHANNELS.TASK_QUEUE.GET_STATE).then(r => r || { tasks: [], isPaused: false }),

    // Metadata
    tmdbGetTVShowDetails: (id: string) => invoke('tmdb:getTVShowDetails', id),

    log: {
      info: (s: string, m: any) => console.log(`[${s}] ${m}`),
      warn: (s: string, m: any) => console.warn(`[${s}] ${m}`),
      error: (s: string, m: any) => console.error(`[${s}] ${m}`),
    },

    // Event Listeners (mock all as non-firing to avoid crashes)
    ...Object.keys(IPC_CHANNELS).reduce((acc: any, key) => {
      const cat = (IPC_CHANNELS as any)[key]
      Object.keys(cat).forEach(chanKey => {
        const chan = cat[chanKey]
        if (typeof chan === 'string' && chan.includes(':')) {
          const parts = chan.split(':')
          const eventName = `on${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts[1].charAt(0).toUpperCase()}${parts[1].slice(1)}`
          acc[eventName] = () => () => {}
        }
      })
      return acc
    }, {}),
    
    // Explicit manual ones for clarity
    onLibraryUpdated: () => () => {},
    onSourceUpdate: () => () => {},
    onScanProgress: () => () => {},
    onScanCompleted: () => () => {},
    onScanError: () => () => {},
    onSeriesProgress: () => () => {},
    onCollectionsProgress: () => () => {},
    onMusicProgress: () => () => {},
    onMusicAnalysisProgress: () => () => {},
    onTmdbApiKeySet: () => () => {},
    onSourcesScanProgress: () => () => {},
    onThemeUpdate: () => () => {},
    onAutoUpdateAvailable: () => () => {},
    onAutoUpdateDownloaded: () => () => {},
    onAutoUpdateError: () => () => {},
    onNotification: () => () => {},
    onAutoRefreshStarted: () => () => {},
    onAutoRefreshComplete: () => () => {},
  };

  (window as any).electronAPI = api
  return { handlers, invoke, api }
}

/**
 * Creates a temporary directory for tests and returns a handle to clean it up.
 */
export function createTempDir(prefix: string) {
  const dirPath = path.resolve(process.cwd(), 'tests/tmp', `${prefix}-${Math.random().toString(36).substring(7)}`)
  
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }

  return {
    path: dirPath,
    cleanup: () => {
      try {
        if (fs.existsSync(dirPath)) {
          fs.rmSync(dirPath, { recursive: true, force: true })
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}
