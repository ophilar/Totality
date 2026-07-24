/**
 * LiveMonitoringService - Background service for detecting media library changes
 */

import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getSourceManager } from '@main/services/SourceManager'
import { getLoggingService } from '@main/services/LoggingService'
import { safeSend } from '@main/ipc/utils/safeSend'
import {
  MonitoringConfig,
  DEFAULT_MONITORING_CONFIG,
  SourceChangeEvent,
  ChangedItem,
  ChangeType,
} from '@main/types/monitoring'
import { ProviderType } from '@main/types/database'

const MEDIA_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m2ts',
  '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.alac', '.aiff', '.opus',
])

const execAsync = promisify(exec)
let networkDriveLetters: Set<string> = new Set()

async function detectWindowsNetworkDrivesAsync(): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const { stdout } = await execAsync('powershell.exe -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 4} | Select-Object -ExpandProperty DeviceID"', {
      timeout: 2000,
      windowsHide: true,
    })
    const detected = new Set<string>()
    for (const line of stdout.split('\n')) {
      const drive = line.trim().replace(':', '')
      if (drive.length === 1) detected.add(drive.toUpperCase())
    }
    networkDriveLetters = detected
  } catch {}
}

function isNetworkPath(filePath: string): boolean {
  if (filePath.startsWith('\\\\')) return true
  if (process.platform === 'win32') {
    const driveLetter = filePath.match(/^([A-Za-z]):/)?.[1]?.toUpperCase()
    if (driveLetter && networkDriveLetters.has(driveLetter)) return true
  }
  return filePath.startsWith('/mnt/') || filePath.startsWith('/Volumes/') || filePath.includes('/smb/') || filePath.includes('/nfs/')
}

export class LiveMonitoringService {
  private config: MonitoringConfig = { ...DEFAULT_MONITORING_CONFIG }
  private isActive = false
  private isPausedByTaskQueue = false
  private mainWindow: BrowserWindow | null = null

  private pollingTimers: Map<string, NodeJS.Timeout> = new Map()
  private lastCheckTimes: Map<string, Date> = new Map()
  private fileWatchers: Map<string, fs.FSWatcher> = new Map()
  private fileChangeDebounce: Map<string, NodeJS.Timeout> = new Map()
  private pendingFileChanges: Map<string, Set<string>> = new Map()

  private static readonly MIN_POLL_INTERVAL_MS = 30000
  private static readonly FILE_CHANGE_DEBOUNCE_MS = 2000
  private static readonly STARTUP_DELAY_MS = 5000
  private static readonly FIRST_POLL_DELAY_MS = 5000
  private static readonly MAX_REASONABLE_CHANGES = 50
  private static readonly POLL_TIMEOUT_MS = 120000

  async initialize(): Promise<void> {
    await detectWindowsNetworkDrivesAsync()
    const db = getDatabase()

    this.config.enabled = (await db.config.getSetting('monitoring_enabled')) === 'true'
    this.config.startOnLaunch = (await db.config.getSetting('monitoring_start_on_launch')) !== 'false'
    this.config.pauseDuringManualScan = (await db.config.getSetting('monitoring_pause_during_scan')) !== 'false'

    const providerTypes: ProviderType[] = [ProviderType.Plex, ProviderType.Jellyfin, ProviderType.Emby, ProviderType.Kodi, ProviderType.KodiLocal, ProviderType.KodiMySQL, ProviderType.Local]
    for (const provider of providerTypes) {
      const interval = await db.config.getSetting(`monitoring_interval_${provider}`)
      if (interval) {
        const parsed = parseInt(interval, 10)
        if (!Number.isNaN(parsed)) {
          this.config.pollingIntervals[provider] = Math.max(parsed, LiveMonitoringService.MIN_POLL_INTERVAL_MS)
        }
      }
    }

    if (this.config.enabled && this.config.startOnLaunch) {
      setTimeout(() => this.start(), LiveMonitoringService.STARTUP_DELAY_MS)
    }
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  getConfig(): MonitoringConfig {
    return { ...this.config }
  }

  async setConfig(config: Partial<MonitoringConfig>): Promise<void> {
    const wasActive = this.isActive
    const wasEnabled = this.config.enabled
    this.config = { ...this.config, ...config }

    const db = getDatabase()
    if (config.enabled !== undefined) await db.config.setSetting('monitoring_enabled', config.enabled.toString())
    if (config.startOnLaunch !== undefined) await db.config.setSetting('monitoring_start_on_launch', config.startOnLaunch.toString())
    if (config.pauseDuringManualScan !== undefined) await db.config.setSetting('monitoring_pause_during_scan', config.pauseDuringManualScan.toString())
    
    if (config.pollingIntervals) {
      for (const [provider, interval] of Object.entries(config.pollingIntervals)) {
        await db.config.setSetting(`monitoring_interval_${provider}`, interval.toString())
      }
    }

    if (wasEnabled && !this.config.enabled && wasActive) {
      this.stop()
    } else if (!wasEnabled && this.config.enabled) {
      await this.start()
    } else if (wasActive && config.pollingIntervals) {
      this.stop()
      await this.start()
    }
  }

  isMonitoringActive(): boolean {
    return this.isActive
  }

  async start(): Promise<void> {
    if (this.isActive || !this.config.enabled) return

    getLoggingService().info('[LiveMonitoringService]', 'Starting...')
    this.isActive = true

    const db = getDatabase()
    const sources = await db.sources.getEnabledSources()

    for (const source of sources) {
      await this.startMonitoringSource(source.source_id, source.source_type as ProviderType, source.connection_config)
    }

    this.sendStatusUpdate()
  }

  stop(): void {
    if (!this.isActive) return
    getLoggingService().info('[LiveMonitoringService]', 'Stopping...')

    for (const timer of this.pollingTimers.values()) clearTimeout(timer)
    this.pollingTimers.clear()

    for (const watcher of this.fileWatchers.values()) {
      try { watcher.close() } catch (err) {}
    }
    this.fileWatchers.clear()

    for (const timer of this.fileChangeDebounce.values()) clearTimeout(timer)
    this.fileChangeDebounce.clear()
    this.pendingFileChanges.clear()
    this.lastCheckTimes.clear()

    this.isActive = false
    this.sendStatusUpdate()
  }

  pause(): void {
    if (!this.isActive) return
    getLoggingService().info('[LiveMonitoringService]', 'Pausing for scan')
    this.emitDebugEvent('info', 'Monitoring paused for scan')

    for (const timer of this.pollingTimers.values()) clearTimeout(timer)
    this.pollingTimers.clear()
    for (const timer of this.fileChangeDebounce.values()) clearTimeout(timer)
    this.fileChangeDebounce.clear()
    this.pendingFileChanges.clear()

    this.isPausedByTaskQueue = true
    this.isActive = false
    this.sendStatusUpdate()
  }

  async resume(): Promise<void> {
    if (!this.isPausedByTaskQueue) return
    getLoggingService().info('[LiveMonitoringService]', 'Resuming after scan')
    this.emitDebugEvent('info', 'Monitoring resumed after scan')
    this.pendingFileChanges.clear()
    this.isPausedByTaskQueue = false
    await this.start()
  }

  isActiveAndEnabled(): boolean {
    return this.isActive && this.config.enabled
  }

  private async startMonitoringSource(sourceId: string, sourceType: ProviderType, connectionConfig: string): Promise<void> {
    const isLocalSource = sourceType === ProviderType.Local || sourceType === ProviderType.KodiLocal
    if (isLocalSource) {
      await this.startFileWatcher(sourceId, sourceType, connectionConfig)
    } else {
      this.startPolling(sourceId, sourceType)
    }
  }

  private async startFileWatcher(sourceId: string, sourceType: ProviderType, connectionConfig: string): Promise<void> {
    try {
      const config = JSON.parse(connectionConfig)
      const watchPath = sourceType === ProviderType.Local ? config.folderPath : config.databasePath
      if (!watchPath) return

      const db = getDatabase()
      const source = await db.sources.getSourceById(sourceId)
      const sourceName = source?.display_name || sourceId
      const usePolling = isNetworkPath(watchPath)

      getLoggingService().info('[LiveMonitoring]', `Watching ${sourceName} (usePolling: ${usePolling})`)
      this.emitDebugEvent('info', `Starting watcher: ${sourceName}`)

      const watcher = fs.watch(watchPath, { recursive: true }, (_eventType, filename) => {
        if (!filename || /(^|[/\\])\./.test(filename)) return
        const fullPath = path.join(watchPath, filename)
        getLoggingService().debug('[LiveMonitoring]', `File event: ${filename} for ${sourceName}`)
        if (this.isMediaFile(fullPath)) {
          const action = fs.existsSync(fullPath) ? 'change' : 'unlink'
          this.handleFileChange(sourceId, action, fullPath)
        }
      })

      watcher.on('error', (error) => {
        getLoggingService().error('[LiveMonitoring]', `Watcher error ${sourceName}:`, error)
        this.handleWatcherError(sourceId, sourceType, watchPath)
      })

      this.fileWatchers.set(sourceId, watcher)
    } catch (error) {
      getLoggingService().error('[LiveMonitoring]', `Failed watcher for ${sourceId}:`, error)
    }
  }

  private isMediaFile(filePath: string): boolean {
    return MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase())
  }

  private handleWatcherError(sourceId: string, sourceType: ProviderType, _watchPath: string): void {
    const watcher = this.fileWatchers.get(sourceId)
    if (watcher) {
      this.fileWatchers.delete(sourceId)
      try { watcher.close() } catch {}
    }
    const debounceTimer = this.fileChangeDebounce.get(sourceId)
    if (debounceTimer) clearTimeout(debounceTimer)
    this.fileChangeDebounce.delete(sourceId)
    this.pendingFileChanges.delete(sourceId)
    this.startPolling(sourceId, sourceType)
  }

  private async handleFileChange(sourceId: string, event: 'add' | 'change' | 'unlink', filePath: string): Promise<void> {
    try {
      if (this.shouldPause()) return

      const db = getDatabase()
      const source = await db.sources.getSourceById(sourceId)
      const sourceName = source?.display_name || sourceId

      getLoggingService().info('[LiveMonitoring]', `File ${event}: ${path.basename(filePath)}`)
      this.emitDebugEvent(event === 'unlink' ? 'removed' : 'info', `[${sourceName}] File ${event}: ${path.basename(filePath)}`)

      if (!this.pendingFileChanges.has(sourceId)) this.pendingFileChanges.set(sourceId, new Set())
      this.pendingFileChanges.get(sourceId)!.add(filePath)

      if (this.fileChangeDebounce.has(sourceId)) clearTimeout(this.fileChangeDebounce.get(sourceId)!)
      this.fileChangeDebounce.set(sourceId, setTimeout(() => {
        this.processFileChanges(sourceId).catch((err) => {
          getLoggingService().error('[LiveMonitoring]', `Error in processFileChanges for ${sourceId}:`, err)
        })
      }, LiveMonitoringService.FILE_CHANGE_DEBOUNCE_MS))
    } catch (error) {
      getLoggingService().error('[LiveMonitoring]', `Error in handleFileChange for ${sourceId}:`, error)
    }
  }

  private async processFileChanges(sourceId: string): Promise<void> {
    const changes = this.pendingFileChanges.get(sourceId)
    if (!changes || changes.size === 0) return

    const changedFiles = Array.from(changes)
    this.pendingFileChanges.delete(sourceId)
    this.fileChangeDebounce.delete(sourceId)

    if (this.shouldPause() || changedFiles.length > LiveMonitoringService.MAX_REASONABLE_CHANGES) return

    try {
      await this.checkSourceWithTargetedFiles(sourceId, changedFiles)
    } catch (error) {
      getLoggingService().error('[LiveMonitoring]', `Error processing file changes for ${sourceId}:`, error)
    }
  }

  private async checkSourceWithTargetedFiles(sourceId: string, filePaths: string[]): Promise<SourceChangeEvent[]> {
    const sourceManager = getSourceManager()
    const db = getDatabase()

    const source = await db.sources.getSourceById(sourceId)
    if (!source) return []

    const libraries = await db.sources.getSourceLibraries(sourceId)
    const enabledLibraries = libraries.filter((lib: any) => lib.isEnabled)
    const events: SourceChangeEvent[] = []

    for (const library of enabledLibraries) {
      try {
        const result = await sourceManager.scanTargetedFiles(sourceId, library.libraryId, filePaths, () => {})
        if (result.success && (result.itemsAdded > 0 || result.itemsUpdated > 0 || result.itemsRemoved > 0)) {
          const changedItems: ChangedItem[] = []
          if (result.itemsAdded > 0 || result.itemsUpdated > 0) {
            const isMusic = library.libraryId.split(':')[0] === 'music'
            const existingFiles = filePaths.filter(fp => fs.existsSync(fp))

            if (isMusic) {
              const albumIds = new Set<number>()
              const tracks = []
              for (const fp of existingFiles) {
                const t = await db.music.getTrackByPath(fp)
                if (t) { tracks.push(t); if (t.album_id) albumIds.add(t.album_id) }
              }
              const albumMap = new Map()
              if (albumIds.size > 0) {
                const albums = await db.music.getAlbumsByIds(Array.from(albumIds))
                for (const a of albums) albumMap.set(a.id, a)
              }
              for (const t of tracks) {
                const a = t.album_id ? albumMap.get(t.album_id) : undefined
                changedItems.push({ id: t.id!.toString(), title: t.title, type: 'track', artistName: t.artist_name, posterUrl: a?.thumb_url })
              }
            } else {
              for (const fp of existingFiles) {
                const it = await db.media.getItemByPath(fp)
                if (it) changedItems.push({ id: it.id!.toString(), title: it.title, type: it.type as any, year: it.year || undefined, posterUrl: it.poster_url || undefined, seriesTitle: it.series_title || undefined })
              }
            }
          }

          let changeType = ChangeType.Added
          if (result.itemsRemoved > 0 && result.itemsAdded === 0 && result.itemsUpdated === 0) changeType = ChangeType.Removed
          else if (result.itemsAdded > 0 && result.itemsUpdated > 0) changeType = ChangeType.Mixed
          else if (result.itemsUpdated > 0) changeType = ChangeType.Updated

          events.push({ sourceId, sourceName: source.display_name, sourceType: source.source_type as any, libraryId: library.libraryId, libraryName: library.libraryName, changeType, itemCount: result.itemsAdded + result.itemsUpdated + result.itemsRemoved, items: changedItems, detectedAt: new Date().toISOString() })
          
          await db.notifications.createNotification({ type: 'info', title: 'Library updated', message: `${source.display_name}: Updated`, reference_id: sourceId })
          this.sendToRenderer('library:updated', { sourceId })
        }
      } catch (error) {
        getLoggingService().error('[LiveMonitoring]', `Targeted scan error ${library.libraryId}:`, error)
      }
    }

    this.sendToRenderer('monitoring:sourceChecked', { sourceId, hasChanges: events.length > 0 })
    return events
  }

  private startPolling(sourceId: string, sourceType: ProviderType): void {
    this.pollingTimers.set(sourceId, setTimeout(() => this.pollSource(sourceId, sourceType), LiveMonitoringService.FIRST_POLL_DELAY_MS))
  }

  private async pollSource(sourceId: string, sourceType: ProviderType): Promise<void> {
    try {
      if (this.shouldPause() || !this.isActive) {
        this.scheduleNextPoll(sourceId, sourceType)
        return
      }

      const db = getDatabase()
      const source = await db.sources.getSourceById(sourceId)
      if (!source) return

      this.emitDebugEvent('poll', `Polling: ${source.display_name}`)
      this.lastCheckTimes.set(sourceId, new Date())

      await Promise.race([
        this.checkSource(sourceId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), LiveMonitoringService.POLL_TIMEOUT_MS))
      ])
    } catch (error) {
      getLoggingService().error('[LiveMonitoring]', `Poll error ${sourceId}:`, error)
    } finally {
      if (this.isActive) this.scheduleNextPoll(sourceId, sourceType)
    }
  }

  private scheduleNextPoll(sourceId: string, sourceType: ProviderType): void {
    if (!this.isActive) return
    if (this.pollingTimers.has(sourceId)) clearTimeout(this.pollingTimers.get(sourceId)!)
    const interval = this.config.pollingIntervals[sourceType] || DEFAULT_MONITORING_CONFIG.pollingIntervals[sourceType]
    this.pollingTimers.set(sourceId, setTimeout(() => this.pollSource(sourceId, sourceType), interval))
  }

  private async checkSource(sourceId: string): Promise<SourceChangeEvent[]> {
    const sourceManager = getSourceManager()
    const db = getDatabase()

    const source = await db.sources.getSourceById(sourceId)
    if (!source) return []

    const libraries = await db.sources.getSourceLibraries(sourceId)
    const enabledLibraries = libraries.filter((lib: any) => lib.isEnabled)
    const events: SourceChangeEvent[] = []

    for (const library of enabledLibraries) {
      try {
        const result = await sourceManager.scanLibraryIncremental(sourceId, library.libraryId, () => {})
        if (result.success && (result.itemsAdded > 0 || result.itemsUpdated > 0)) {
          const recentItems = await db.media.getItems({ sourceId, libraryId: library.libraryId, sortBy: 'updated_at', sortOrder: 'desc', limit: result.itemsAdded + result.itemsUpdated })
          const changedItems: ChangedItem[] = recentItems.map((it: any) => ({ id: it.id!.toString(), title: it.title, type: it.type as any, year: it.year || undefined, posterUrl: it.poster_url || undefined, seriesTitle: it.series_title || undefined }))

          let changeType = ChangeType.Added
          if (result.itemsAdded > 0 && result.itemsUpdated > 0) changeType = ChangeType.Mixed
          else if (result.itemsUpdated > 0) changeType = ChangeType.Updated

          events.push({ sourceId, sourceName: source.display_name, sourceType: source.source_type as any, libraryId: library.libraryId, libraryName: library.libraryName, changeType, itemCount: result.itemsAdded + result.itemsUpdated, items: changedItems, detectedAt: new Date().toISOString() })
          this.sendToRenderer('library:updated', {})
        }
        if (result.success && result.itemsRemoved > 0) {
          events.push({ sourceId, sourceName: source.display_name, sourceType: source.source_type as any, libraryId: library.libraryId, libraryName: library.libraryName, changeType: ChangeType.Removed, itemCount: result.itemsRemoved, items: [], detectedAt: new Date().toISOString() })
        }
      } catch (error) {
        getLoggingService().error('[LiveMonitoring]', `Check error ${library.libraryId}:`, error)
      }
    }

    if (events.length > 0) {
      await db.notifications.createNotification({ type: 'info', title: 'Library updated', message: `${source.display_name}: Changes detected`, reference_id: sourceId })
    }

    this.sendToRenderer('monitoring:sourceChecked', { sourceId, hasChanges: events.length > 0 })
    return events
  }

  private shouldPause(): boolean {
    if (!this.config.pauseDuringManualScan) return false
    return getSourceManager().isManualScanInProgress()
  }

  notifyLibraryUpdated(sourceId?: string): void {
    this.sendToRenderer('library:updated', { sourceId })
  }

  private sendStatusUpdate(): void {
    this.sendToRenderer('monitoring:statusChanged', {
      isActive: this.isActive,
      lastCheck: this.lastCheckTimes.size > 0 ? Array.from(this.lastCheckTimes.values()).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() : undefined,
    })
    this.sendToRenderer('monitoring:status', { isActive: this.isActive })
  }

  public sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow) safeSend(this.mainWindow, channel, data)
  }

  private emitDebugEvent(type: 'poll' | 'added' | 'removed' | 'error' | 'info', message: string): void {
    this.sendToRenderer('monitoring:event', { type, message })
  }

  getStatus(): { isActive: boolean } {
    return { isActive: this.isActive }
  }

  async forceCheckAllLazySources(): Promise<void> {
    if (!this.isActive || this.shouldPause()) return
    const db = getDatabase()
    const sources = await db.sources.getEnabledSources()
    for (const source of sources) {
      const isRemote = source.source_type !== ProviderType.Local && source.source_type !== ProviderType.KodiLocal
      if (isRemote) {
        const lastCheck = this.lastCheckTimes.get(source.source_id)
        const now = new Date()
        if (!lastCheck || (now.getTime() - lastCheck.getTime() > 30000)) {
          this.checkSource(source.source_id).catch(() => {})
          this.lastCheckTimes.set(source.source_id, now)
        }
      }
    }
  }

  async forceCheck(sourceId: string): Promise<SourceChangeEvent[]> {
    if (this.shouldPause()) return []
    return this.checkSource(sourceId)
  }

  async addSource(sourceId: string, sourceType: ProviderType, connectionConfig: string): Promise<void> {
    if (!this.isActive) return
    await this.startMonitoringSource(sourceId, sourceType, connectionConfig)
  }

  removeSource(sourceId: string): void {
    const timer = this.pollingTimers.get(sourceId)
    if (timer) clearTimeout(timer)
    this.pollingTimers.delete(sourceId)
    const watcher = this.fileWatchers.get(sourceId)
    if (watcher) { this.fileWatchers.delete(sourceId); try { watcher.close() } catch {} }
    const debounce = this.fileChangeDebounce.get(sourceId)
    if (debounce) clearTimeout(debounce)
    this.fileChangeDebounce.delete(sourceId)
    this.pendingFileChanges.delete(sourceId)
    this.lastCheckTimes.delete(sourceId)
  }
}

let liveMonitoringService: LiveMonitoringService | null = null
export function getLiveMonitoringService(): LiveMonitoringService {
  if (!liveMonitoringService) liveMonitoringService = new LiveMonitoringService()
  return liveMonitoringService
}

export function resetLiveMonitoringServiceForTesting(): void {
  if (liveMonitoringService) liveMonitoringService.stop()
  liveMonitoringService = null
}
