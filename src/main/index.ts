import { app, BrowserWindow, ipcMain, protocol, net, dialog, Tray, Menu, nativeImage, session } from 'electron'
import { IPC_CHANNELS } from '../shared/ipcChannels'
import { createSyncHandler, validateSenderFrame } from './ipc/utils/createHandler'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as os from 'os'
import * as fs from 'fs'


// Disable Chromium SUID sandbox on Linux. AppImage packages cannot set root
// ownership on the chrome-sandbox binary, so the SUID sandbox is unavailable in
// that distribution format. Electron's contextIsolation + nodeIntegration:false
// still provide strong process-level security for the renderer.
// To restore full OS-level sandboxing on Linux, distribute as .deb or Snap instead.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

// GPU crash fallback: disable hardware acceleration only if a previous crash was recorded.
// On first run (no flag file) hardware acceleration is enabled for smooth rendering.
// If the GPU process crashes, a flag file is written and the app prompts to restart in
// software mode — keeping all other users on GPU-accelerated rendering.
const getGpuFlagPath = (): string => {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'totality', '.gpu-disabled')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'totality', '.gpu-disabled')
  }
  return path.join(os.homedir(), '.config', 'totality', '.gpu-disabled')
}

const GPU_FLAG_PATH = getGpuFlagPath()
const gpuDisabled = fs.existsSync(GPU_FLAG_PATH)

if (gpuDisabled) {
  console.log('[GPU] Hardware acceleration disabled (crash flag present)')
  app.disableHardwareAcceleration()
}

// Register custom protocol for serving local artwork files
// Must be registered before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-artwork',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])
import { getDatabaseServiceSync } from './database/DatabaseFactory'
import { getDatabase } from './database/getDatabase'
import { ApplicationShutdown } from './services/ApplicationShutdown'
import { getSourceManager } from './services/SourceManager'
import { registerDatabaseHandlers } from './ipc/database'
import { registerQualityHandlers } from './ipc/quality'
import { registerSeriesHandlers } from './ipc/series'
import { registerCollectionHandlers } from './ipc/collections'
import { registerSourceHandlers } from './ipc/sources'
import { registerJellyfinHandlers } from './ipc/jellyfin'
import { registerMusicHandlers } from './ipc/music'
import { registerWishlistHandlers } from './ipc/wishlist'
import { registerMonitoringHandlers } from './ipc/monitoring'
import { registerNotificationHandlers } from './ipc/notifications'
import { registerTaskQueueHandlers } from './ipc/taskQueue'
import { registerLoggingHandlers } from './ipc/logging'
import { registerAutoUpdateHandlers } from './ipc/autoUpdate'
import { registerMoodHandlers, setMoodMainWindow } from './ipc/mood'
import { registerTimelinesHandlers } from './ipc/timelines'
import { registerBarcodeHandlers } from './ipc/barcode'
import { registerTranscodingHandlers, resumeBackgroundPreflights } from './ipc/transcoding'
import { registerDuplicateHandlers } from './ipc/duplicates'
import { registerPlaybackTargetProfileHandlers } from './ipc/playbackTargetProfiles'
import { registerPlaybackCompatibilityHandlers } from './ipc/playbackCompatibility'
import { registerOptimizationHandlers } from './ipc/optimization'
import { getLiveMonitoringService } from './services/LiveMonitoringService'
import { getTaskQueueService } from './services/TaskQueueService'
import { setTrayUpdateCallback } from './ipc/utils/notificationEmitter'
import { getLoggingService } from './services/LoggingService'
import { fetchWithTimeout } from './services/utils/httpClient'
import { getAutoUpdateService } from './services/AutoUpdateService'
import { getWishlistCompletionService } from './services/WishlistCompletionService'
import { getWebServerService, initWebServerService } from './services/WebServerService'
import { getCredentialEncryptionService } from './services/CredentialEncryptionService'
import type { MediaSource } from './types/database'
import { registerWebAccessHandlers } from './ipc/webAccess'
import { SETTING_KEYS } from '../shared/settingKeys'

// __dirname is provided by CommonJS/Node
declare const __dirname: string

// Crash handlers - ensure database integrity on unexpected errors
// With better-sqlite3 (WAL mode): data is auto-persisted, forceSave() just checkpoints WAL
process.on('uncaughtException', (error) => {
  console.error('[CRASH] Uncaught exception:', error)
  try {
    const db = getDatabaseServiceSync()
    if (db.isInitialized) {
      db.endBatch()
      console.log('[CRASH] better-sqlite3 data already persisted (WAL mode)')
    }
  } catch (e) {
    console.error('[CRASH] Failed to checkpoint database:', e)
  }
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH] Unhandled rejection at:', promise, 'reason:', reason)
  try {
    const db = getDatabaseServiceSync()
    if (db.isInitialized) {
      db.endBatch()
      // better-sqlite3: no action needed, WAL mode auto-persists
    }
  } catch (e) {
    console.error('[CRASH] Failed to checkpoint database:', e)
  }
  // Don't exit on unhandled rejection - log and continue
})

// The built directory structure:
// ├─┬ dist                    <- renderer build output
// │ └── index.html
// │
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.cjs           <- this file at runtime
// │ └─┬ preload
// │   └── index.cjs
//
const DIST = path.join(__dirname, '../../dist')
const VITE_PUBLIC = app.isPackaged
  ? DIST
  : path.join(__dirname, '../../src/renderer/public')

process.env.DIST = DIST
process.env.VITE_PUBLIC = VITE_PUBLIC

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    width: 1215,
    height: 840,
    minWidth: 1000,
    minHeight: 600,
    icon: path.join(VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // Electron 20+ default; overridden on Linux by --no-sandbox above
      spellcheck: false,
    },
    titleBarStyle: 'default',
    frame: true,
    backgroundColor: '#14151a', // Match app's dark background
    show: false, // Don't show until ready
  })

  // Show window when React signals it's ready (via IPC)
  const fallbackTimer = setTimeout(() => win?.show(), 3000)
  ipcMain.once(IPC_CHANNELS.appReady, (event) => {
    validateSenderFrame(event, IPC_CHANNELS.appReady)
    clearTimeout(fallbackTimer)
    win?.show()
  })

  // App version handler
  createSyncHandler(IPC_CHANNELS.appGetVersion, () => app.getVersion())

  // Disable default menu
  win.removeMenu()

  // Minimize to tray: intercept close to hide instead of quit
  win.on('close', (event) => {
    if (isQuitting) return

    const db = getDatabaseServiceSync()
    if (!db.isInitialized) return
    event.preventDefault()
    void db.getSetting('minimize_to_tray').then(minimizeToTray => {
      if (minimizeToTray === 'true') win?.hide()
      else { isQuitting = true; win?.close() }
    }).catch(error => {
      console.error('[Window] Failed to read minimize-to-tray setting:', error)
      isQuitting = true
      win?.close()
    })
  })

  // Content Security Policy — defense-in-depth against XSS
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = !!VITE_DEV_SERVER_URL
    const csp = [
      "default-src 'self'",
      // unsafe-inline needed for Tailwind; unsafe-eval needed for Vite HMR in dev
      `style-src 'self' 'unsafe-inline'`,
      `script-src 'self'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
      // TMDB posters, provider artwork (http: for local-network servers), local-artwork protocol, data URIs
      "img-src 'self' https: http: local-artwork: data:",
      // API calls to Plex, Jellyfin, Emby, TMDB, MusicBrainz; ws: for Vite HMR in dev
      `connect-src 'self' https: http:${isDev ? ' ws:' : ''}`,
      "font-src 'self' data:",
    ]
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp.join('; ')],
      },
    })
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(DIST, 'index.html'))
  }

  // Only open DevTools in development mode (docked to prevent window close issues)
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'bottom' })
  }
}

function createTray() {
  const iconPath = path.join(VITE_PUBLIC, 'icon.png')
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('Totality')

  updateTrayMenu()

  tray.on('click', () => {
    if (win?.isVisible()) {
      win.hide()
    } else {
      win?.show()
      win?.focus()
    }
  })
}

function updateTrayMenu() {
  if (!tray) return

  let taskLabel = ''
  try {
    const tqs = getTaskQueueService()
    const state = tqs.getQueueState()
    if (state.currentTask) {
      const pct = state.currentTask.progress?.percentage
      taskLabel = pct !== undefined ? `${state.currentTask.label} (${Math.round(pct)}%)` : state.currentTask.label
    }
  } catch { /* service not ready */ }

  let unreadCount = 0
  try {
    const db = getDatabase()
    const counts = db.getNotificationCount()
    unreadCount = counts.unread
  } catch { /* db not ready */ }

  const monitoringService = getLiveMonitoringService()
  const isMonitoring = monitoringService.getStatus().isActive

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'Show Totality', click: () => { win?.show(); win?.focus() } },
    { type: 'separator' },
  ]

  if (taskLabel) {
    template.push({ label: taskLabel, enabled: false })
    template.push({ type: 'separator' })
  }

  if (unreadCount > 0) {
    template.push({ label: `${unreadCount} notification${unreadCount !== 1 ? 's' : ''}`, enabled: false })
    template.push({ type: 'separator' })
  }

  template.push({
    label: isMonitoring ? 'Pause monitoring' : 'Resume monitoring',
    click: () => {
      if (isMonitoring) monitoringService.stop()
      else monitoringService.start()
      updateTrayMenu()
    },
  })

  template.push({ type: 'separator' })
  template.push({ label: 'Quit', click: () => { isQuitting = true; app.quit() } })

  tray.setContextMenu(Menu.buildFromTemplate(template))
}

// GPU crash detection: if the GPU process dies, write a flag so the next launch
// disables hardware acceleration and offers to restart in software mode.
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU') return
  console.error('[GPU] GPU process gone, reason:', details.reason)
  try {
    fs.mkdirSync(path.dirname(GPU_FLAG_PATH), { recursive: true })
    fs.writeFileSync(GPU_FLAG_PATH, '1')
    console.log('[GPU] Crash flag written — hardware acceleration will be disabled on next launch')
  } catch (e) {
    console.error('[GPU] Failed to write crash flag:', e)
  }
  if (win && !win.isDestroyed()) {
    dialog.showMessageBox(win, {
      type: 'warning',
      title: 'GPU Crash Detected',
      message: 'The GPU process crashed. Totality will restart with software rendering to prevent future crashes.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        app.relaunch()
        app.exit(0)
      }
    }).catch(() => { /* ignore dialog error */ })
  }
})

// Guard against double database close from concurrent quit events
let isClosing = false

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin' && !isClosing) {
    app.quit()
    win = null
  }
})

// Before quit, close database and cleanup services
app.on('before-quit', async (event) => {
  isQuitting = true
  if (isClosing) return
  event.preventDefault()
  isClosing = true

  // Stop web server
  getWebServerService()?.stop()
  const autoUpdateService = getAutoUpdateService()
  const willAutoInstall = autoUpdateService.getState().status === 'downloaded'
  const db = getDatabaseServiceSync()
  const shutdown = new ApplicationShutdown({
    stopAcceptingWork: async () => {
      getLiveMonitoringService().stop()
      getAutoUpdateService().cleanup()
    },
    pauseTaskQueue: async () => {
      await getTaskQueueService().stopForShutdown()
    },
    shutdownWorkerPool: async () => {
      try {
        const { getFFprobeWorkerPool } = await import('./services/FFprobeWorkerPool')
        await getFFprobeWorkerPool().shutdown()
      } catch {
        // Pool may not have been initialized
      }
    },
    persistInterruptedTasks: async () => {
      getTaskQueueService().persistInterruptedTasks()
    },
    checkpointWal: async () => {
      // WAL checkpoint
    },
    closeDatabase: async () => {
      await db.close()
    },
    shutdownLogging: async () => {
      await getLoggingService().shutdown()
    },
  })

  try {
    await shutdown.execute()
  } catch (error) {
    console.error('[App] Shutdown encountered error:', error)
  }

  if (willAutoInstall) {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.quitAndInstall(false, true)
  } else {
    app.exit()
  }
})

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked and no other windows are open
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  try {
    // Initialize logging first (before other services so their logs are captured)
    getLoggingService().initialize()

    // Register local-artwork protocol handler for serving local album artwork
    const userDataPath = app.getPath('userData')
    const artworkBasePath = path.join(userDataPath, 'artwork')

    // Resolve the artwork base path once at startup to avoid repeated sync realpathSync
    // on every image request. Falls back to the raw path if it doesn't exist yet.
    let realArtworkBasePath = artworkBasePath
    try {
      realArtworkBasePath = fs.realpathSync(artworkBasePath)
    } catch { /* artwork dir may not exist until first scan */ }

    protocol.handle('local-artwork', async (request) => {
      const url = new URL(request.url)

      if (url.hostname === 'plex') {
        const [, id, kind] = url.pathname.split('/')
        if (!/^\d+$/.test(id) || (kind !== 'episode' && kind !== 'season')) {
          return new Response(null, { status: 400 })
        }
        const item = getDatabaseServiceSync().getMediaItem(Number(id))
        const stored = kind === 'episode' ? item?.episode_thumb_url : item?.season_poster_url
        if (item?.source_type !== 'plex' || !stored) return new Response(null, { status: 404 })

        const started = performance.now()
        const context = { mediaItemId: item.id, sourceId: item.source_id, kind }
        const logger = getLoggingService()
        let endpointOrigin: string | undefined
        let status: number | undefined
        try {
          const server = getSourceManager().getPlexProvider(item.source_id!)?.getSelectedServer()
          if (!server) throw new Error('Plex source has no active connection')
          const artworkPath = new URL(stored).pathname
          if (!/^\/library\/metadata\/\d+\/thumb(?:\/\d+)?$/.test(artworkPath)) {
            throw new Error('Invalid Plex artwork path')
          }
          const endpoint = new URL(artworkPath, server.uri)
          endpointOrigin = endpoint.origin
          logger.debug('[Artwork]', 'Plex artwork request started', { ...context, endpoint: endpointOrigin })
          const response = await fetchWithTimeout(endpoint.href, {
            headers: { 'X-Plex-Token': server.accessToken },
            redirect: 'error',
            signal: request.signal,
          }, 10_000)
          status = response.status
          const contentType = response.headers.get('content-type')
          if (!response.ok) {
            await response.body?.cancel()
            throw new Error(`Plex artwork returned HTTP ${response.status}`)
          }
          if (!contentType?.startsWith('image/')) {
            await response.body?.cancel()
            throw new Error('Plex artwork response was not an image')
          }
          const body = await response.arrayBuffer()
          logger.debug('[Artwork]', 'Plex artwork loaded', { ...context, endpoint: endpoint.origin, status: response.status, durationMs: Math.round(performance.now() - started) })
          return new Response(body, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } })
        } catch (error) {
          const cause = error instanceof Error && 'cause' in error && error.cause instanceof Error ? error.cause : error
          logger.warn('[Artwork]', 'Plex artwork request failed', { ...context, endpoint: endpointOrigin, status, reason: cause instanceof Error ? cause.message : String(cause), durationMs: Math.round(performance.now() - started) })
          return new Response(null, { status: 502 })
        }
      }

      // Check if this is a direct file path request
      // URL format: local-artwork://file?path=C:\path\to\file.jpg
      if (url.hostname === 'file') {
        const filePath = url.searchParams.get('path')
        if (!filePath) return new Response('Not found', { status: 404 })

        // SECURITY: Only allow image file extensions to prevent arbitrary file reads
        const ext = path.extname(filePath).toLowerCase()
        const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'])
        if (!ALLOWED_IMAGE_EXTS.has(ext)) {
          console.warn('[Security] Blocked non-image file request:', filePath)
          return new Response('Forbidden', { status: 403 })
        }

        const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false)
        if (fileExists) {
          return net.fetch(pathToFileURL(filePath).href)
        }
        return new Response('Not found', { status: 404 })
      }

      // Standard app-cached artwork
      // URL format: local-artwork://albums/123.jpg
      // SECURITY: Prevent path traversal attacks by validating the resolved path
      const urlPath = url.pathname.replace(/^\/+/, '') // Remove leading slashes
      const normalizedPath = path.normalize(urlPath)

      // Block any path traversal attempts (../ sequences)
      if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
        console.warn('[Security] Blocked path traversal attempt:', urlPath)
        return new Response('Forbidden', { status: 403 })
      }

      const filePath = path.resolve(artworkBasePath, normalizedPath)

      // Ensure resolved path is within the artwork directory
      // Use async realpath to resolve symlinks before comparison
      let realFilePath: string
      try {
        realFilePath = await fs.promises.realpath(filePath)
      } catch {
        // File doesn't exist or can't be resolved — treat as not-found or traversal attempt
        const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false)
        if (!fileExists) return new Response('Not found', { status: 404 })
        return new Response('Forbidden', { status: 403 })
      }
      if (!realFilePath.startsWith(realArtworkBasePath + path.sep) && realFilePath !== realArtworkBasePath) {
        console.warn('[Security] Blocked path escape attempt:', urlPath)
        return new Response('Forbidden', { status: 403 })
      }

      // Serve the file
      return net.fetch(pathToFileURL(filePath).href)
    })
    console.log('Local artwork protocol registered')

    // Initialize database
    const db = getDatabaseServiceSync()
    await db.initialize()
    console.log('Database initialized successfully (better-sqlite3)')

    await getCredentialEncryptionService().migrateCredentials(
      async () => db.getRawMediaSources().map((source: MediaSource) => ({ source_id: source.source_id, connection_config: source.connection_config })),
      async (sourceId, connectionConfig) => {
        const source = db.getRawMediaSources().find((candidate: MediaSource) => candidate.source_id === sourceId)
        if (!source) throw new Error(`Media source ${sourceId} was not found during credential migration`)
        await db.upsertMediaSource({ ...source, connection_config: connectionConfig })
      },
      async () => db.getRawSettings(),
      async (key, value) => { await db.setSetting(key, value) },
    )
    console.log('Credential migration completed')

    // Note: BetterSQLiteService runs PRAGMA integrity_check during initialize().
    // If integrity fails, it logs an error but continues (data is still usable).

    // Inject database getter into logging service (replaces dynamic require)
    getLoggingService().setDatabaseGetter(() => getDatabase())

    // Initialize file-based logging (requires database for settings)
    await getLoggingService().initializeFileLogging()

    // Initialize source manager (loads providers from database)
    const sourceManager = getSourceManager()
    await sourceManager.initialize()
    console.log('Source manager initialized successfully')

    // Intercept ipcMain.handle to build handler map for web server RPC bridge
    const webHandlerMap = new Map<string, Function>()
    const origHandle = ipcMain.handle.bind(ipcMain)
    ipcMain.handle = ((channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      webHandlerMap.set(channel, handler)
      return origHandle(channel, handler)
    }) as typeof ipcMain.handle

    // Register IPC handlers
    registerDatabaseHandlers()
    registerQualityHandlers()
    registerSeriesHandlers()
    registerCollectionHandlers()
    registerSourceHandlers()
    registerJellyfinHandlers()
    registerMusicHandlers()
    registerWishlistHandlers()
    registerMonitoringHandlers()
    registerNotificationHandlers()
    registerTaskQueueHandlers()
    registerLoggingHandlers()
    registerAutoUpdateHandlers()
    registerMoodHandlers()
    registerTimelinesHandlers()
    registerBarcodeHandlers()
    registerTranscodingHandlers()
    registerDuplicateHandlers()
    registerPlaybackTargetProfileHandlers()
    registerPlaybackCompatibilityHandlers()
    registerOptimizationHandlers()
    registerWebAccessHandlers()

    // Restore ipcMain.handle to original (interception complete)
    ipcMain.handle = origHandle

    // Initialize web server (uses captured handler map)
    const webServer = initWebServerService(webHandlerMap, VITE_DEV_SERVER_URL)
    const webAccessEnabled = await db.getSetting(SETTING_KEYS.web_access_enabled)
    if (webAccessEnabled === 'true') {
      webServer.start().catch(err =>
        console.error('[WebServer] Failed to auto-start:', err)
      )
    }

    // Initialize live monitoring service
    const liveMonitoringService = getLiveMonitoringService()
    await liveMonitoringService.initialize()

    // Create main window and system tray
    createWindow()
    createTray()
    setTrayUpdateCallback(() => updateTrayMenu())

    // Handle "start minimized to tray" setting
    const startMinimized = await db.getSetting('start_minimized_to_tray')
    if (startMinimized === 'true' && await db.getSetting('minimize_to_tray') === 'true') {
      win?.hide()
    }

    // Initialize auto-update service
    const autoUpdateService = getAutoUpdateService()
    autoUpdateService.initialize()

    // Start release alert polling (if enabled)
    import('./services/ReleaseAlertService').then(({ getReleaseAlertService }) => {
      getReleaseAlertService().start().catch(err =>
        console.error('[ReleaseAlertService] Failed to start:', err)
      )
    })

    // Set main window reference for services (must precede task queue restore
    // so that restored tasks can emit IPC progress events immediately)
    const taskQueueService = getTaskQueueService()
    if (win) {
      liveMonitoringService.setMainWindow(win)
      taskQueueService.setMainWindow(win)
      getLoggingService().setMainWindow(win)
      autoUpdateService.setMainWindow(win)
      getWishlistCompletionService().setMainWindow(win)
      setMoodMainWindow(win)
    }

    // Load persisted history and re-enqueue any tasks that were pending at last quit
    taskQueueService.loadPersistedHistory()
    resumeBackgroundPreflights()
    const database = getDatabase()
    if (await database.getSetting('optimization.quality_reanalysis_pending') === 'true') {
      taskQueueService.addTask({ type: 'quality-analysis', label: 'Refresh media quality' })
    }
    if (await database.getSetting('optimization.savings_reanalysis_pending') === 'true') {
      taskQueueService.addTask({ type: 'media-analysis', label: 'Measure media files', options: { completedMediaItemIds: [] } })
    }
    console.log('Task queue service initialized')

    // Update tray menu when task queue state changes or periodically during scans
    taskQueueService.onStateChange(() => updateTrayMenu())
    setInterval(() => updateTrayMenu(), 30000)

  } catch (error) {
    console.error('Failed to initialize app:', error)
    dialog.showErrorBox('Startup Error', `Totality failed to start:\n\n${error instanceof Error ? error.message : String(error)}`)
    app.quit()
  }
})
