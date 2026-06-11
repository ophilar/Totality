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
import { registerMonitoringHandlers } from '@main/ipc/monitoring'
import { registerLoggingHandlers } from '@main/ipc/logging'
import { registerDuplicateHandlers } from '@main/ipc/duplicates'
import { registerAutoUpdateHandlers } from '@main/ipc/autoUpdate'
import { registerGeminiHandlers } from '@main/ipc/gemini'
import { registerQualityHandlers } from '@main/ipc/quality'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import { registerNotificationHandlers } from '@main/ipc/notifications'
import { registerJellyfinHandlers } from '@main/ipc/jellyfin'

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
  registerMonitoringHandlers()
  registerLoggingHandlers()
  registerDuplicateHandlers()
  registerAutoUpdateHandlers()
  registerGeminiHandlers()
  registerQualityHandlers()
  registerTranscodingHandlers()
  registerNotificationHandlers()
  registerJellyfinHandlers()

  // Helper to invoke a handler with no fallbacks and loud errors
  const invoke = async (channel: string, ...args: any[]) => {
    if (!channel) throw new Error('IPC Invoke: Channel is required')
    const handler = handlers.get(channel)
    
    if (!handler) {
      throw new Error(`IPC Invoke: No handler registered for channel "${channel}"`)
    }

    const event = { sender: { send: vi.fn() } }
    return await handler(event, ...args)
  }

  // Create an exhaustive API object that matches preload scripts
  const api: any = {
    invoke,
    // Database / Media retrieval
    getMediaItems: (f: any) => invoke('db:getMediaItems', f),
    countMediaItems: (f: any) => invoke('db:countMediaItems', f),
    mediaList: (f: any) => invoke(IPC_CHANNELS.DATABASE.MEDIA_LIST, f),
    mediaCount: (f: any) => invoke(IPC_CHANNELS.DATABASE.MEDIA_COUNT, f),
    getMediaItem: (id: number) => invoke(IPC_CHANNELS.DATABASE.MEDIA_GET_ITEM, id),
    getMediaItemVersions: (id: number) => invoke(IPC_CHANNELS.DATABASE.MEDIA_GET_VERSIONS, id),
    getTVShows: (f: any) => invoke('db:getTVShows', f),
    countTVShows: (f: any) => invoke('db:countTVShows', f),
    getLibraryOverview: (sId: string) => invoke(IPC_CHANNELS.DATABASE.GET_LIBRARY_OVERVIEW, sId),
    getDashboardSummary: (sId?: string) => invoke(IPC_CHANNELS.DATABASE.GET_DASHBOARD_SUMMARY, sId),
    tvShowList: (f: any) => invoke(IPC_CHANNELS.DATABASE.TVSHOWS_LIST, f),
    tvShowCount: (f: any) => invoke(IPC_CHANNELS.DATABASE.TVSHOWS_COUNT, f),
    countTVEpisodes: (f: any) => invoke(IPC_CHANNELS.DATABASE.TV_EPISODES_COUNT, f),
    getLibraryStats: (sId: string) => invoke(IPC_CHANNELS.DATABASE.GET_LIBRARY_STATS, sId),
    getSetting: (k: string) => invoke(IPC_CHANNELS.DATABASE.GET_SETTING, k),
    setSetting: (k: string, v: string) => invoke(IPC_CHANNELS.DATABASE.SET_SETTING, k, v),
    getAllSettings: () => invoke(IPC_CHANNELS.DATABASE.GET_ALL_SETTINGS),
    isVerboseLogging: () => invoke(IPC_CHANNELS.LOGGING.IS_VERBOSE),
    setVerboseLogging: (e: boolean) => invoke(IPC_CHANNELS.LOGGING.SET_VERBOSE, e),
    getLogs: (l: number) => invoke(IPC_CHANNELS.LOGGING.GET_ALL, l),
    getFileLoggingSettings: () => invoke(IPC_CHANNELS.LOGGING.GET_FILE_SETTINGS),
    setFileLoggingSettings: (s: any) => invoke(IPC_CHANNELS.LOGGING.SET_FILE_SETTINGS, s),
    monitoringGetConfig: () => invoke(IPC_CHANNELS.MONITORING.GET_CONFIG),
    monitoringSetConfig: (c: any) => invoke(IPC_CHANNELS.MONITORING.SET_CONFIG, c),
    
    // Transcoding
    checkAvailability: () => invoke('transcoding:checkAvailability'),
    generateTranscodeParams: (p: string, o: any) => invoke('transcoding:getParameters', p, o),
    startTranscoding: (id: number, o: any) => invoke('transcoding:start', id, o),
    stopTranscoding: () => invoke('transcoding:stop'),
    onProgress: (cb: any) => () => {},

    // Duplicates
    duplicatesGetPending: (sId?: string) => invoke('duplicates:getPending', sId),
    duplicatesScan: (sId?: string) => invoke('duplicates:scan', sId),
    duplicatesGetRecommendation: (ids: number[]) => invoke('duplicates:getRecommendation', ids),
    duplicatesResolve: (gId: number, kId: number, d: boolean) => invoke('duplicates:resolve', gId, kId, d),

    // Music
    musicGetArtists: (f: any) => invoke('music:getArtists', f),
    musicArtistList: (f: any) => invoke('music:artists:list', f),
    musicArtistCount: (f: any) => invoke('music:artists:count', f),
    musicGetAlbums: (f: any) => invoke('music:getAlbums', f),
    musicAlbumList: (f: any) => invoke('music:albums:list', f),
    musicAlbumCount: (f: any) => invoke('music:albums:count', f),
    musicGetTracks: (f: any) => invoke('music:getTracks', f),
    musicTrackList: (f: any) => invoke('music:tracks:list', f),
    musicTrackCount: (f: any) => invoke('music:tracks:count', f),
    musicGetTracksByAlbum: (id: number) => invoke(IPC_CHANNELS.MUSIC.GET_TRACKS_BY_ALBUM, id),
    musicGetAlbumCompleteness: (id: number) => invoke(IPC_CHANNELS.MUSIC.GET_ALBUM_COMPLETENESS, id),
    musicGetAllArtistCompleteness: (sId: string) => invoke(IPC_CHANNELS.MUSIC.GET_ALL_ARTIST_COMPLETENESS, sId),
    musicGetAlbumsNeedingUpgrade: (l: number) => invoke(IPC_CHANNELS.MUSIC.GET_ALBUMS_NEEDING_UPGRADE, l),

    // Sources
    sourcesList: (t: any) => invoke(IPC_CHANNELS.SOURCES.LIST, t),
    sourcesGetActive: () => invoke(IPC_CHANNELS.SOURCES.GET_ACTIVE),
    sourcesGetLibrariesWithStatus: (sId: string) => invoke(IPC_CHANNELS.SOURCES.GET_LIBRARIES_WITH_STATUS, sId),
    sourcesGetStats: (sId?: string) => invoke(IPC_CHANNELS.SOURCES.GET_STATS, sId),
    sourcesGetSupportedProviders: () => invoke(IPC_CHANNELS.SOURCES.GET_SUPPORTED_PROVIDERS),
    sourcesUpsert: (s: any) => invoke(IPC_CHANNELS.SOURCES.UPSERT, s),
    sourcesDelete: (id: string) => invoke(IPC_CHANNELS.SOURCES.DELETE, id),
    sourcesToggle: (id: string, e: boolean) => invoke(IPC_CHANNELS.SOURCES.TOGGLE, id, e),
    sourcesSetLibrariesEnabled: (id: string, l: any[]) => invoke(IPC_CHANNELS.SOURCES.SET_LIBRARIES_ENABLED, id, l),
    sourcesSetLibraryProtected: (sId: string, lId: string, p: boolean) => invoke(IPC_CHANNELS.SOURCES.SET_LIBRARY_PROTECTED, sId, lId, p),
    
    // Plex Specific
    plexStartAuth: () => invoke(IPC_CHANNELS.SOURCES.PLEX.START_AUTH),
    plexCheckAuth: (id: string) => invoke(IPC_CHANNELS.SOURCES.PLEX.CHECK_AUTH, id),
    plexSelectServer: (p: any) => invoke(IPC_CHANNELS.SOURCES.PLEX.SELECT_SERVER, p),
    plexAuthenticateAndDiscover: (id: string) => invoke(IPC_CHANNELS.SOURCES.PLEX.AUTHENTICATE_AND_DISCOVER, id),

    // Jellyfin/Emby Specific
    jellyfinAuthenticate: (c: any) => invoke(IPC_CHANNELS.SOURCES.JELLYFIN.AUTHENTICATE, c),
    jellyfinGetLibraries: (c: any) => invoke(IPC_CHANNELS.SOURCES.JELLYFIN.GET_LIBRARIES, c),

    // Series / Collections
    seriesGetAll: (sId: string) => invoke('series:getAll', sId),
    seriesGetEpisodes: (t: string, sId: string) => invoke('series:getEpisodes', t, sId),
    collectionsGetAll: (sId: string) => invoke(IPC_CHANNELS.COLLECTIONS.GET_ALL, sId),

    // Wishlist
    wishlistGetAll: (f: any) => invoke(IPC_CHANNELS.WISHLIST.GET_ALL, f),
    wishlistGetCount: () => invoke(IPC_CHANNELS.WISHLIST.GET_COUNT),
    wishlistGetCountsByReason: () => invoke(IPC_CHANNELS.WISHLIST.GET_COUNTS_BY_REASON),
    wishlistGetRegion: () => invoke(IPC_CHANNELS.WISHLIST.GET_REGION),
    wishlistAdd: (i: any) => invoke(IPC_CHANNELS.WISHLIST.ADD, i),
    wishlistDelete: (id: number) => invoke(IPC_CHANNELS.WISHLIST.DELETE, id),
    wishlistUpdateStatus: (id: number, s: string) => invoke(IPC_CHANNELS.WISHLIST.UPDATE_STATUS, id, s),
    wishlistUpdatePriority: (id: number, p: number) => invoke(IPC_CHANNELS.WISHLIST.UPDATE_PRIORITY, id, p),

    // AI
    aiIsConfigured: () => invoke(IPC_CHANNELS.AI.IS_CONFIGURED),
    aiGetRateLimitInfo: () => invoke(IPC_CHANNELS.AI.GET_RATE_LIMIT_INFO),
    aiSendMessage: (p: any) => invoke(IPC_CHANNELS.AI.SEND_MESSAGE, p),
    aiQualityReport: (p: any) => invoke(IPC_CHANNELS.AI.QUALITY_REPORT, p),
    aiUpgradePriorities: (p: any) => invoke(IPC_CHANNELS.AI.UPGRADE_PRIORITIES, p),
    aiCompletenessInsights: (p: any) => invoke(IPC_CHANNELS.AI.COMPLETENESS_INSIGHTS, p),
    aiWishlistAdvice: (p: any) => invoke(IPC_CHANNELS.AI.WISHLIST_ADVICE, p),
    aiCompressionAdvice: (p: any) => invoke(IPC_CHANNELS.AI.COMPRESSION_ADVICE, p),
    aiExplainQuality: (p: any) => invoke(IPC_CHANNELS.AI.EXPLAIN_QUALITY, p),
    
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
    taskQueueGetState: () => invoke(IPC_CHANNELS.TASK_QUEUE.GET_STATE).then(r => r || api.__taskState),
    onTaskQueueUpdated: (cb: any) => {
      api.__taskListeners = api.__taskListeners || []
      api.__taskListeners.push(cb)
      return () => { api.__taskListeners = api.__taskListeners.filter((l: any) => l !== cb) }
    },
    __triggerTaskQueueUpdate: (state: any) => {
      api.__taskState = state
      if (api.__taskListeners) {
        api.__taskListeners.forEach((l: any) => l(state))
      }
    },

    // Metadata
    tmdbGetTVShowDetails: (id: string) => invoke('tmdb:getTVShowDetails', id),

    getAppVersion: () => invoke('app:getVersion'),
    openExternal: (url: string) => invoke('app:openExternal', url),

    // Auto Update
    autoUpdateGetState: () => invoke(IPC_CHANNELS.AUTO_UPDATE.GET_STATE),
    autoUpdateCheckForUpdates: () => invoke(IPC_CHANNELS.AUTO_UPDATE.CHECK_FOR_UPDATES),
    autoUpdateDownloadUpdate: () => invoke(IPC_CHANNELS.AUTO_UPDATE.DOWNLOAD_UPDATE),
    autoUpdateInstallUpdate: () => invoke(IPC_CHANNELS.AUTO_UPDATE.INSTALL_UPDATE),
    onAutoUpdateStateChanged: (cb: any) => () => {},

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
    onAiStreamDelta: () => () => {},
    onAiStreamComplete: () => () => {},
    onAiChatStreamDelta: () => () => {},
    onAiChatStreamComplete: () => () => {},
    onAiAnalysisStreamDelta: () => () => {},
    onAiAnalysisStreamComplete: () => () => {},
    onAiToolUse: () => () => {},
  };

  // Assign to both global and window to be absolutely sure
  if (typeof window !== 'undefined') {
    (window as any).electronAPI = api
  }
  (globalThis as any).electronAPI = api
  
  return { handlers, invoke, api }
}

import * as http from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * A real local HTTP server used for integrated testing of provider APIs.
 * This satisfies the "No Mocks" mandate by providing a real network endpoint.
 */
export class LocalIntegratedApiServer {
  private server: http.Server
  private responses: Map<string, { status: number; body: any; headers?: any }> = new Map()
  private handlers: Map<string, (req: http.IncomingMessage, body: any) => { status: number; body: any; headers?: any }> = new Map()
  public url: string = ''
  public lastRequest: { url?: string; method?: string; body?: any; headers?: http.IncomingHttpHeaders } = {}

  constructor() {
    this.server = http.createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        let parsedBody = body
        if (body && (req.headers['content-type']?.includes('json') || body.startsWith('{'))) {
          try { parsedBody = JSON.parse(body) } catch { /* ignore */ }
        }

        this.lastRequest = {
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: parsedBody
        }

        const parsedUrl = new URL(req.url || '', `http://${req.headers.host}`)
        const path = parsedUrl.pathname

        let response: { status: number; body: any; headers?: any } | undefined

        // Try handlers first (matching by prefix)
        for (const [prefix, handler] of this.handlers.entries()) {
          if (path.startsWith(prefix)) {
            response = handler(req, parsedBody)
            if (response) break
          }
        }

        // Fallback to static responses
        if (!response) {
          response = this.responses.get(path) || { status: 404, body: { error: 'Not Found' } }
        }
        
        res.writeHead(response.status, {
          'Content-Type': 'application/json',
          ...(response.headers || {})
        })
        res.end(JSON.stringify(response.body))
      })
    })
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const port = (this.server.address() as AddressInfo).port
        this.url = `http://127.0.0.1:${port}`
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    return new Promise(resolve => this.server.close(() => resolve()))
  }

  setResponse(path: string, body: any, status = 200, headers?: any) {
    this.responses.set(path, { status, body, headers })
  }

  setHandler(path: string, handler: (req: http.IncomingMessage, body: any) => { status: number; body: any; headers?: any }) {
    this.handlers.set(path, handler)
  }
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
