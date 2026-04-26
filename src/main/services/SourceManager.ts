/**
 * SourceManager Service
 *
 * Central service for managing media sources (Plex, Jellyfin, Emby, Kodi).
 * Handles source CRUD operations, provider lifecycle, and aggregated scanning.
 */

import { getDatabase, type BetterSQLiteService } from '../database/getDatabase'
import { getLiveMonitoringService, type LiveMonitoringService } from './LiveMonitoringService'
import { getTaskQueueService, type TaskQueueService } from './TaskQueueService'
import { getLoggingService, type LoggingService } from './LoggingService'
import { createProvider, getSupportedProviders } from '../providers/ProviderFactory'
import { PlexProvider } from '../providers/plex/PlexProvider'
import { SourceScannerService, type AggregateProgressCallback } from './SourceScannerService'
import { SourceCrudService } from './SourceCrudService'
import { PlexAuthService } from './PlexAuthService'
import type {
  MediaProvider,
  ProviderType,
  LibraryType,
  SourceConfig,
  ConnectionTestResult,
  ScanResult,
  ProgressCallback,
  MediaLibrary,
} from '../providers/base/MediaProvider'
import type { MediaSource } from '../types/database'

export interface SourceManagerDependencies {
  db?: BetterSQLiteService
  liveMonitoring?: LiveMonitoringService
  taskQueue?: TaskQueueService
  logging?: LoggingService
}

export class SourceManager {
  private providers: Map<string, MediaProvider> = new Map()
  private initPromise: Promise<void> | null = null
  private getLibrariesPromises: Map<string, Promise<MediaLibrary[]>> = new Map()
  private scanner: SourceScannerService | null = null
  private crud: SourceCrudService | null = null
  private plexAuth: PlexAuthService | null = null

  private db: BetterSQLiteService
  private liveMonitoring: LiveMonitoringService | null
  private taskQueue: TaskQueueService | null
  private logging: LoggingService

  constructor(deps: SourceManagerDependencies = {}) {
    this.db = deps.db || getDatabase()
    this.liveMonitoring = deps.liveMonitoring || null
    this.taskQueue = deps.taskQueue || null
    this.logging = deps.logging || getLoggingService()
  }

  private getScanner(): SourceScannerService {
    if (!this.scanner) this.scanner = new SourceScannerService(this.db, this.providers, this.logging)
    return this.scanner
  }

  private getCrud(): SourceCrudService {
    if (!this.crud) this.crud = new SourceCrudService(this.db, this.providers, this.logging)
    return this.crud
  }

  private getPlexAuth(): PlexAuthService {
    if (!this.plexAuth) this.plexAuth = new PlexAuthService(this.providers, this.db)
    return this.plexAuth
  }

  private getLiveMonitoring(): LiveMonitoringService {
    if (!this.liveMonitoring) this.liveMonitoring = getLiveMonitoringService()
    return this.liveMonitoring
  }

  private getTaskQueue(): TaskQueueService {
    if (!this.taskQueue) this.taskQueue = getTaskQueueService()
    return this.taskQueue
  }

  /**
   * Initialize the source manager - loads all sources from database
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.loadSources()
    return this.initPromise
  }

  private async loadSources(): Promise<void> {
    const db = this.db
    const sources = db.sources.getSources()
    const unavailableSources: Array<{ name: string; type: string }> = []

    await Promise.allSettled(
      sources.map((source: MediaSource) => this.loadSingleSource(source, unavailableSources))
    )

    this.logging.info('[SourceManager]', `Initialized with ${this.providers.size} providers`)

    if (unavailableSources.length > 0) {
      const names = unavailableSources.map(s => s.name).join(', ')
      try {
        db.notifications.addNotification({
          type: 'error',
          title: 'Media source unavailable',
          message: unavailableSources.length === 1
            ? `"${unavailableSources[0].name}" could not be reached at startup.`
            : `${unavailableSources.length} sources could not be reached at startup: ${names}.`,
        })
      } catch { /* ignore */ }
    }
  }

  private async loadSingleSource(
    source: MediaSource,
    unavailableSources: Array<{ name: string; type: string }>
  ): Promise<void> {
    try {
      const connectionConfig = JSON.parse(source.connection_config)
      const config: SourceConfig = {
        sourceId: source.source_id,
        sourceType: source.source_type as ProviderType,
        displayName: source.display_name,
        connectionConfig,
        isEnabled: !!source.is_enabled,
      }

      const provider = createProvider(source.source_type as ProviderType, config)
      this.providers.set(source.source_id, provider)

      if (source.source_type === 'plex' && connectionConfig.serverId && connectionConfig.token) {
        const plexProvider = provider as PlexProvider
        try {
          const success = await Promise.race([
            plexProvider.selectServer(connectionConfig.serverId as string),
            new Promise<boolean>((_, r) => setTimeout(() => r(new Error('Timeout')), 5000))
          ])
          if (!success) unavailableSources.push({ name: source.display_name, type: source.source_type })
        } catch {
          unavailableSources.push({ name: source.display_name, type: source.source_type })
        }
      }
    } catch (error) {
      this.logging.error('[SourceManager]', `Failed to load provider ${source.source_id}:`, error)
    }
  }

  // Delegate Scanning to SourceScannerService
  isScanInProgress(): boolean { return this.getScanner().isScanInProgress() }
  isManualScanInProgress(): boolean { return this.getScanner().isScanInProgress() }
  stopScan(): void { this.getScanner().stopScan() }

  async scanLibrary(sourceId: string, libraryId: string, onProgress?: ProgressCallback): Promise<ScanResult> {
    const scanner = this.getScanner()
    scanner.activeScans++
    try {
      await this.initialize()
      // Subtract the immediate increment since scanner.scanLibrary will also increment
      scanner.activeScans-- 
      return await scanner.scanLibrary(sourceId, libraryId, onProgress)
    } catch (error) {
      scanner.activeScans--
      throw error
    }
  }

  async scanSource(sourceId: string, onProgress?: ProgressCallback): Promise<void> {
    await this.initialize()
    const provider = this.providers.get(sourceId)
    if (!provider) throw new Error(`Source not found: ${sourceId}`)
    const libraries = await provider.getLibraries()
    for (const library of libraries) {
      if (library.type === LibraryType.Music) continue
      if (!this.db.sources.isLibraryEnabled(sourceId, library.id)) continue
      await this.scanLibrary(sourceId, library.id, onProgress)
    }
  }

  async scanAllSources(onProgress?: AggregateProgressCallback): Promise<Map<string, ScanResult>> {
    const scanner = this.getScanner()
    scanner.activeScans++
    try {
      await this.initialize()
      scanner.activeScans--
      return await scanner.scanAllSources(onProgress)
    } catch (error) {
      scanner.activeScans--
      throw error
    }
  }

  async scanTargetedFiles(sourceId: string, libraryId: string, filePaths: string[], onProgress?: ProgressCallback): Promise<ScanResult> {
    await this.initialize()
    const provider = this.providers.get(sourceId)
    if (!provider) throw new Error(`Source not found: ${sourceId}`)
    return provider.scanLibrary(libraryId, { onProgress, targetFiles: filePaths })
  }

  async scanLibraryIncremental(sourceId: string, libraryId: string, onProgress?: ProgressCallback): Promise<ScanResult> {
    await this.initialize()
    const lastScanTime = this.db.sources.getLibraryScanTime(sourceId, libraryId)
    if (!lastScanTime) return this.scanLibrary(sourceId, libraryId, onProgress)
    const provider = this.providers.get(sourceId)
    if (!provider) throw new Error(`Source not found: ${sourceId}`)
    const result = await provider.scanLibrary(libraryId, { onProgress, sinceTimestamp: new Date(lastScanTime) })
    if (result.success) await this.db.sources.updateLibraryScanTime(sourceId, libraryId, result.itemsScanned)
    return result
  }

  async scanAllIncremental(onProgress?: AggregateProgressCallback): Promise<Map<string, ScanResult>> {
    await this.initialize()
    const enabledSources = this.db.sources.getEnabledSources()
    const results = new Map<string, ScanResult>()
    for (const source of enabledSources) {
      const provider = this.providers.get(source.source_id)
      if (!provider) continue
      try {
        const libraries = await provider.getLibraries()
        for (const library of libraries) {
          if (library.type === LibraryType.Music) continue
          if (!this.db.sources.isLibraryEnabled(source.source_id, library.id)) continue
          const lastScanTime = this.db.sources.getLibraryScanTime(source.source_id, library.id)
          const result = await provider.scanLibrary(library.id, { sinceTimestamp: lastScanTime ? new Date(lastScanTime) : undefined, onProgress: onProgress ? (p) => onProgress(source.source_id, source.display_name, p) : undefined })
          if (result.success) await this.db.sources.updateLibraryScanTime(source.source_id, library.id, result.itemsScanned)
          results.set(`${source.source_id}:${library.id}`, result)
        }
      } catch { /* ignore */ }
    }
    return results
  }

  // Delegate CRUD to SourceCrudService
  async addSource(config: SourceConfig): Promise<MediaSource> {
    await this.initialize()
    return this.getCrud().addSource(config)
  }

  async updateSource(sourceId: string, updates: Partial<SourceConfig>): Promise<void> {
    await this.initialize()
    return this.getCrud().updateSource(sourceId, updates)
  }

  async removeSource(sourceId: string): Promise<void> {
    await this.initialize()
    this.getLiveMonitoring().removeSource(sourceId)
    this.getTaskQueue().removeTasksForSource(sourceId)
    return this.getCrud().removeSource(sourceId)
  }

  async toggleSource(sourceId: string, enabled: boolean): Promise<void> {
    await this.initialize()
    const source = this.db.sources.getSourceById(sourceId)
    if (source) this.db.sources.upsertSource({ ...source, is_enabled: enabled })
  }

  // Delegate Plex Auth to PlexAuthService
  async plexStartAuth() { return this.getPlexAuth().startAuth() }
  async plexCompleteAuth(pinId: number) { return this.getPlexAuth().completeAuth(pinId) }
  async plexAuthenticateAndDiscover(token: string, displayName: string) { return this.getPlexAuth().authenticateAndDiscover(token, displayName) }
  async plexSelectServer(sourceId: string, serverId: string) { return this.getPlexAuth().selectServer(sourceId, serverId) }
  async plexGetServers(sourceId: string) {
    const p = this.getPlexProvider(sourceId)
    if (!p) throw new Error('Not found')
    return p.discoverServers()
  }

  // Rest of SourceManager logic
  async getSources(type?: ProviderType) { await this.initialize(); return this.db.sources.getSources(type) }
  async getSource(sourceId: string) { await this.initialize(); return this.db.sources.getSourceById(sourceId) }
  async getEnabledSources() { await this.initialize(); return this.db.sources.getEnabledSources() }
  getProvider(sourceId: string) { return this.providers.get(sourceId) }
  getPlexProvider(sourceId: string) {
    const p = this.providers.get(sourceId)
    return p?.providerType === 'plex' ? p as PlexProvider : undefined
  }

  async testConnection(sourceId: string): Promise<ConnectionTestResult> {
    await this.initialize()
    const provider = this.providers.get(sourceId)
    if (!provider) return { success: false, error: 'Not found' }
    if (provider.providerType === 'plex' && !(provider as PlexProvider).hasSelectedServer()) return { success: false, error: 'No server selected' }
    
    // Auth check for JF/Emby
    if (provider.providerType === 'jellyfin' || provider.providerType === 'emby') {
      const source = this.db.sources.getSourceById(sourceId)
      if (source) {
        const config = JSON.parse(source.connection_config)
        if (config.username && config.password && !config.accessToken) {
          const res = await provider.authenticate({ serverUrl: config.serverUrl, username: config.username, password: config.password })
          if (res.success) {
            const updated = { ...config, accessToken: res.token, userId: res.userId, password: undefined }
            this.db.sources.upsertSource({ ...source, connection_config: JSON.stringify(updated) })
            this.providers.set(sourceId, createProvider(source.source_type as ProviderType, { sourceId, sourceType: source.source_type as ProviderType, displayName: source.display_name, connectionConfig: updated, isEnabled: !!source.is_enabled }))
          }
        }
      }
    }

    const res = await this.providers.get(sourceId)!.testConnection()
    if (res.success) this.db.sources.updateSourceConnectionTime(sourceId)
    return res
  }

  async getLibraries(sourceId: string): Promise<MediaLibrary[]> {
    await this.initialize()
    const provider = this.providers.get(sourceId)
    if (!provider) throw new Error('Not found')
    if (provider.providerType === 'plex' && !(provider as PlexProvider).hasSelectedServer()) return []
    
    const existing = this.getLibrariesPromises.get(sourceId)
    if (existing) return existing
    
    const promise = (async () => {
      const libs = await provider.getLibraries()
      const scanTimes = this.db.sources.getLibraryScanTimes(sourceId)
      return libs.map(l => ({ ...l, scannedAt: scanTimes.get(l.id)?.lastScanAt || l.scannedAt, itemCount: scanTimes.get(l.id)?.itemsScanned || l.itemCount }))
    })()
    
    this.getLibrariesPromises.set(sourceId, promise)
    try { return await promise } finally { this.getLibrariesPromises.delete(sourceId) }
  }

  async triggerPostScanAnalysis(sourceId?: string, libraryId?: string): Promise<void> {
    const sources = sourceId ? [this.db.sources.getSourceById(sourceId)].filter(Boolean) : this.db.sources.getEnabledSources()
    const { getWishlistCompletionService } = await import('./WishlistCompletionService')
    for (const source of sources) {
      if (!source) continue
      const libs = await this.getLibraries(source.source_id)
      for (const lib of (libraryId ? libs.filter(l => l.id === libraryId) : libs)) {
        if (!this.db.sources.isLibraryEnabled(source.source_id, lib.id)) continue
        if (this.db.config.getSetting('tmdb_api_key')) {
          if (lib.type === LibraryType.Show || lib.type === LibraryType.Mixed) this.getTaskQueue().addTask({ type: 'series-completeness', label: `Series: ${lib.name}`, sourceId: source.source_id, libraryId: lib.id })
          if (lib.type === LibraryType.Movie || lib.type === LibraryType.Mixed) this.getTaskQueue().addTask({ type: 'collection-completeness', label: `Collection: ${lib.name}`, sourceId: source.source_id, libraryId: lib.id })
        }
      }
    }
    getWishlistCompletionService().checkAndComplete().catch(() => {})
  }

  async getAggregatedStats() { await this.initialize(); return this.db.stats.getAggregatedSourceStats() }
  getSupportedProviders() { return getSupportedProviders() }
  async reloadProvider(sourceId: string) {
    await this.initialize()
    const s = this.db.sources.getSourceById(sourceId)
    if (!s) throw new Error('Not found')
    this.providers.set(sourceId, createProvider(s.source_type as ProviderType, { sourceId: s.source_id, sourceType: s.source_type as ProviderType, displayName: s.display_name, connectionConfig: JSON.parse(s.connection_config), isEnabled: !!s.is_enabled }))
  }
}

let sourceManagerInstance: SourceManager | null = null
export function getSourceManager(): SourceManager {
  if (!sourceManagerInstance) sourceManagerInstance = new SourceManager()
  return sourceManagerInstance
}
