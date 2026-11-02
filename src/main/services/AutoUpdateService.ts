/**
 * AutoUpdateService - Handles automatic application updates via electron-updater
 *
 * Uses GitHub Releases as the update source. Checks for updates on a schedule
 * and emits state changes to the renderer process.
 */

import { app, BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { safeSend } from '@main/ipc/utils/safeSend'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { CancellationToken } from 'builder-util-runtime'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  version?: string
  releaseNotes?: string
  downloadProgress?: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }
  error?: string
  lastChecked?: string
}

const CHECK_DELAY_MS = 30_000       // 30 seconds after startup
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000 // 4 hours

export class AutoUpdateService {
  private mainWindow: BrowserWindow | null = null
  private state: UpdateState = { status: 'idle' }
  private checkTimer: NodeJS.Timeout | null = null
  private firstCheckTimer: NodeJS.Timeout | null = null
  private checkPromise: Promise<void> | null = null
  private initialized = false
  private downloadProgressListener: ((progress: ProgressInfo) => void) | null = null

  initialize(): void {
    if (this.initialized) return

    this.initialized = true

    if (!app.isPackaged) {
      getLoggingService().info('[AutoUpdate]', 'Dev mode — checking works, download/install disabled')
    }

    // Configure autoUpdater
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = null // We handle logging ourselves

    // Wire up events
    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.setState({
        status: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : undefined,
      })
    })

    autoUpdater.on('update-not-available', (_info: UpdateInfo) => {
      this.setState({
        status: 'not-available',
        lastChecked: new Date().toISOString(),
      })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.downloadProgressListener?.(progress)
      this.setState({
        status: 'downloading',
        downloadProgress: {
          percent: progress.percent,
          bytesPerSecond: progress.bytesPerSecond,
          transferred: progress.transferred,
          total: progress.total,
        },
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.setState({
        status: 'downloaded',
        version: info.version,
        lastChecked: new Date().toISOString(),
      })
    })

    autoUpdater.on('update-cancelled', (info: UpdateInfo) => {
      this.setState({ status: 'available', version: info.version, downloadProgress: undefined })
    })

    autoUpdater.on('error', (err: Error) => {
      getLoggingService().error('[AutoUpdateService]', '[AutoUpdate] Error:', err.message)
      this.setState({
        status: 'error',
        error: err.message,
      })
    })

    // Schedule first check
    this.firstCheckTimer = setTimeout(() => {
      void this.autoCheckIfEnabled().catch(error => this.reportCheckError(error))
    }, CHECK_DELAY_MS)

    // Schedule recurring checks
    this.checkTimer = setInterval(() => {
      void this.autoCheckIfEnabled().catch(error => this.reportCheckError(error))
    }, CHECK_INTERVAL_MS)

    getLoggingService().info('[AutoUpdateService]', '[AutoUpdate] Initialized')
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  /**
   * Check for updates (manual trigger from UI)
   */
  async checkForUpdates(): Promise<void> {
    if (this.checkPromise) return this.checkPromise
    this.checkPromise = autoUpdater.checkForUpdates()
      .then(() => undefined)
      .catch(err => this.reportCheckError(err))
      .finally(() => { this.checkPromise = null })
    return this.checkPromise
  }

  /**
   * Download the available update
   */
  async downloadUpdate(signal: AbortSignal, onProgress?: (progress: ProgressInfo) => void): Promise<void> {
    if (!app.isPackaged) throw new Error('Update downloads are available only in the packaged application.')

    try {
      signal.throwIfAborted()
      this.downloadProgressListener = onProgress ?? null
      const cancellationToken = new CancellationToken()
      const cancelDownload = () => cancellationToken.cancel()
      signal.addEventListener('abort', cancelDownload, { once: true })
      try {
        await autoUpdater.downloadUpdate(cancellationToken)
      } finally {
        signal.removeEventListener('abort', cancelDownload)
        cancellationToken.dispose()
        this.downloadProgressListener = null
      }
    } catch (err: unknown) {
      if (signal.aborted) throw err
      const msg = err instanceof Error ? err.message : 'Unknown error'
      getLoggingService().error('[AutoUpdateService]', '[AutoUpdate] Download failed:', msg)
      this.setState({ status: 'error', error: msg })
      throw err
    }
  }

  /**
   * Quit and install the downloaded update
   */
  async installUpdate(): Promise<void> {
    if (!app.isPackaged) return

    // Save database before quitting
    try {
      const db = getDatabase()
      await db.close()
    } catch (err) {
      getLoggingService().error('[AutoUpdateService]', '[AutoUpdate] Failed to close database before update:', err)
    }

    // isSilent=false shows install progress, isForceRunAfter=true relaunches app
    autoUpdater.quitAndInstall(false, true)
  }

  cleanup(): void {
    if (this.firstCheckTimer) {
      clearTimeout(this.firstCheckTimer)
      this.firstCheckTimer = null
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
  }

  private async autoCheckIfEnabled(): Promise<void> {
    // Read setting from database
    const db = getDatabase()
    const setting = await db.config.getSetting('auto_update_enabled')
    if (setting === 'false') return

    await this.checkForUpdates()
  }

  private reportCheckError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err)
    getLoggingService().error('[AutoUpdateService]', '[AutoUpdate] Check failed:', msg)
    this.setState({ status: 'error', error: msg })
  }

  private setState(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial }
    this.emitState()
  }

  private emitState(): void {
    safeSend(this.mainWindow, 'autoUpdate:stateChanged', this.state)
  }
}

// Singleton
let instance: AutoUpdateService | null = null

export function getAutoUpdateService(): AutoUpdateService {
  if (!instance) {
    instance = new AutoUpdateService()
  }
  return instance
}
