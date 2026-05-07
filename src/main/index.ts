import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { app, BrowserWindow, ipcMain, protocol, net, dialog, Tray, Menu, nativeImage, session } from 'electron'
import path from 'node:path'
import * as fs from 'fs'

// Disable Chromium SUID sandbox on Linux
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
}

// Disable hardware acceleration to prevent GPU process crashes
app.disableHardwareAcceleration()

// Register custom protocol for serving local artwork files
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-artwork',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

import { getDatabase } from '@main/database/BetterSQLiteService'
import { getSourceManager } from '@main/services/SourceManager'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerQualityHandlers } from '@main/ipc/quality'
import { registerSeriesHandlers } from '@main/ipc/series'
import { registerCollectionHandlers } from '@main/ipc/collections'
import { registerSourceHandlers } from '@main/ipc/sources'
import { registerJellyfinHandlers } from '@main/ipc/jellyfin'
import { registerMusicHandlers } from '@main/ipc/music'
import { registerWishlistHandlers } from '@main/ipc/wishlist'
import { registerMonitoringHandlers } from '@main/ipc/monitoring'
import { registerNotificationHandlers } from '@main/ipc/notifications'
import { registerTaskQueueHandlers } from '@main/ipc/taskQueue'
import { registerLoggingHandlers } from '@main/ipc/logging'
import { registerAutoUpdateHandlers } from '@main/ipc/autoUpdate'
import { registerGeminiHandlers } from '@main/ipc/gemini'
import { registerDuplicateHandlers } from '@main/ipc/duplicates'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { getLoggingService } from '@main/services/LoggingService'
import { getGeminiService } from '@main/services/GeminiService'
import { getAutoUpdateService } from '@main/services/AutoUpdateService'
import { getWishlistCompletionService } from '@main/services/WishlistCompletionService'

// __dirname is provided by CommonJS/Node
declare const __dirname: string

// Crash handlers
process.on('uncaughtException', (error) => {
  getLoggingService().error('[index]', '[CRASH] Uncaught exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  getLoggingService().error('[index]', '[CRASH] Unhandled rejection at:', promise, 'reason:', reason)
})

const DIST = path.join(__dirname, '../../dist')
const VITE_PUBLIC = app.isPackaged ? DIST : path.join(__dirname, '../../src/renderer/public')

process.env.DIST = DIST
process.env.VITE_PUBLIC = VITE_PUBLIC

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    icon: path.join(VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      enableWebSQL: false,
    },
    titleBarStyle: 'default',
    frame: true,
    backgroundColor: '#14151a',
    show: false,
  })

  win.on('focus', () => {
    getLiveMonitoringService().forceCheckAllLazySources()
  })

  // Show window when React signals it's ready (via IPC)
  const fallbackTimer = setTimeout(() => win?.show(), 3000)
  ipcMain.once('app:ready', () => {
    clearTimeout(fallbackTimer)
    win?.show()
  })

  win.removeMenu()

  win.on('close', async (event) => {
    if (isQuitting) return
    const db = getDatabase()
    if (db.isInitialized && (await db.config.getSetting('minimize_to_tray')) === 'true') {
      event.preventDefault()
      win?.hide()
    }
  })

  // Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = !!VITE_DEV_SERVER_URL
    const csp = [
      "default-src 'self'",
      `style-src 'self' 'unsafe-inline'`,
      `script-src 'self'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
      "img-src 'self' https: http: local-artwork: data:",
      `connect-src 'self' https: http:${isDev ? ' ws:' : ''}`,
      "font-src 'self' data:",
    ]
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp.join('; ')] } })
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(DIST, 'index.html'))
  }

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'bottom' })
  }
}

function createTray() {
  const iconPath = path.join(VITE_PUBLIC, 'icon.png')
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('Totality')
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Totality', click: () => { win?.show(); win?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (win?.isVisible()) win.hide()
    else { win?.show(); win?.focus() }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    getDatabase().close()
    app.quit()
  }
})

app.on('before-quit', async (event) => {
  isQuitting = true
  event.preventDefault()
  
  getLiveMonitoringService().stop()
  getAutoUpdateService().cleanup()
  
  try {
    const { getFFprobeWorkerPool } = await import('./services/FFprobeWorkerPool')
    await getFFprobeWorkerPool().shutdown()
  } catch {}
  
  await getLoggingService().shutdown()
  getTaskQueueService().persistInterruptedTasks()
  getDatabase().close()
  app.exit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(async () => {
  try {
    getLoggingService().initialize()
    
    // Register essential app info early
    const version = app.getVersion()
    ipcMain.handle(IPC_CHANNELS.APP.GET_VERSION, () => version)

    // Explicit Database Initialization
    const dbPath = path.join(app.getPath('userData'), 'totality.db')
    await getDatabase().initialize(dbPath)

    const artworkBasePath = path.join(app.getPath('userData'), 'artwork')
    protocol.handle('local-artwork', (request) => {
      const url = new URL(request.url)
      if (url.hostname === 'file') {
        const filePath = url.searchParams.get('path')
        if (!filePath) return new Response('Not found', { status: 404 })
        const ext = path.extname(filePath).toLowerCase()
        if (!new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff']).has(ext)) return new Response('Forbidden', { status: 403 })
        if (filePath && fs.existsSync(filePath)) {
          if (filePath.startsWith('\\\\')) return net.fetch(`file:${filePath.replace(/\\/g, '/')}`)
          if (/^[A-Za-z]:/.test(filePath)) return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`)
          return net.fetch(`file://${filePath}`)
        }
        return new Response('Not found', { status: 404 })
      }
      const urlPath = url.pathname.replace(/^\/+/, '')
      const normalizedPath = path.normalize(urlPath)
      if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) return new Response('Forbidden', { status: 403 })
      const filePath = path.resolve(artworkBasePath, normalizedPath)
      if (fs.existsSync(filePath)) {
        if (process.platform === 'win32') return net.fetch(`file:///${filePath.replace(/\\/g, '/')}`)
        return net.fetch(`file://${filePath}`)
      }
      return new Response('Not found', { status: 404 })
    })

    getLoggingService().setDatabaseGetter(() => getDatabase())
    await getLoggingService().initializeFileLogging()

    await getSourceManager().initialize()
    await getGeminiService().initialize()
    await getTaskQueueService().loadPersistedHistory()

    // Register all IPC handlers
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
    registerGeminiHandlers()
    registerDuplicateHandlers()
    registerTranscodingHandlers()

    await getLiveMonitoringService().initialize()

    createWindow()
    createTray()

    const db = getDatabase()
    if ((await db.config.getSetting('start_minimized_to_tray')) === 'true' && (await db.config.getSetting('minimize_to_tray')) === 'true') {
      win?.hide()
    }

    getAutoUpdateService().initialize()

    if (win) {
      getLiveMonitoringService().setMainWindow(win)
      getTaskQueueService().setMainWindow(win)
      getLoggingService().setMainWindow(win)
      getAutoUpdateService().setMainWindow(win)
      getWishlistCompletionService().setMainWindow(win)
    }
  } catch (error) {
    getLoggingService().error('[index]', 'Failed to initialize app:', error)
    dialog.showErrorBox('Startup Error', `Totality failed to start:\n\n${error instanceof Error ? error.message : String(error)}`)
    app.quit()
  }
})
