/**
 * SourceManager Service
 *
 * Central service for managing media sources (Plex, Jellyfin, Emby, Kodi).
 * Handles source CRUD operations, provider lifecycle, and aggregated scanning.
 */

import { getDatabase } from '../database/getDatabase'
import { getLiveMonitoringService } from './LiveMonitoringService'
import { getTaskQueueService } from './TaskQueueService'
import { getLoggingService } from './LoggingService'
import { createProvider, getSupportedProviders } from '../providers/ProviderFactory'
import { PlexProvider } from '../providers/plex/PlexProvider'
import type {
  MediaProvider,
  ProviderType,
  SourceConfig,
  ConnectionTestResult,
  ScanResult,
  ProgressCallback,
  MediaLibrary,
} from '../providers/base/MediaProvider'
import type { MediaSource } from '../types/database'

// Progress callback that includes source information
export type AggregateProgressCallback = (
  sourceId: string,
  sourceName: string,
  progress: {
    current: number
    total: number
    phase: 'fetching' | 'processing' | 'analyzing' | 'saving'
    currentItem?: string
    percentage: number
  }
) => void

export class SourceManager {
  private providers: Map<string, MediaProvider> = new Map()
  private initPromise: Promise<void> | null = null
  private scanCancelled: boolean = false
  private isScanning: boolean = false
  private getLibrariesPromises: Map<string, Promise<MediaLibrary[]>> = new Map()

  constructor() {
    // Initialize will be called explicitly
  }

  /**
   * Check if a scan is currently in progress
   */
  isScanInProgress(): boolean {
    return this.isScanning
  }

  /**
   * Check if a manual scan is in progress
   * Used by LiveMonitoringService to pause during manual scans
   */
  isManualScanInProgress(): boolean {
    return this.isScanning
  }

  /**
   * Check if scan has been cancelled
   */
  isScanCancelled(): boolean {
    return this.scanCancelled
  }

  /**
   * Stop the current scan
   */
  stopScan(): void {
    if (this.isScanning) {
      getLoggingService().info('[SourceManager]', '[SourceManager] Stopping scan...')
      this.scanCancelled = true
    }
  }

  /**
   * Initialize the source manager - loads all sources from database
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.loadSources()
    }
    return this.initPromise
  }

  private async loadSources(): Promise<void> {
    const db = getDatabase()
    const sources = db.getMediaSources()
    const unavailableSources: Array<{ name: string; type: string }> = []

    // Load all providers in parallel with per-source timeout
    await Promise.allSettled(
      sources.map((source: MediaSource) => this.loadSingleSource(source, db, unavailableSources))
    )

    getLoggingService().info('[SourceManager]', `Initialized with ${this.providers.size} providers`)

    // Create notifications for unavailable sources (after startup)
    if (unavailableSources.length > 0) {
      const names = unavailableSources.map(s => s.name).join(', ')
      getLoggingService().warn('[SourceManager]', `Unavailable sources at startup: ${names}`)
      try {
        db.createNotification({
          type: 'error',
          title: 'Media source unavailable',
          message: unavailableSources.length === 1
            ? `"${unavailableSources[0].name}" could not be reached at startup. Please check the connection.`
            : `${unavailableSources.length} sources could not be reached at startup: ${names}. Please check their connections.`,
        })
      } catch (err) {
        getLoggingService().warn('[SourceManager]', '[SourceManager] Could not create notification for unavailable sources:', err)
      }
    }
  }

  private async loadSingleSource(
    source: MediaSource,
    db: ReturnType<typeof getDatabase>,
    unavailableSources: Array<{ name: string; type: string }>
  ): Promise<void> {
    try {
      const connectionConfig = JSON.parse(source.connection_config)
      const config: SourceConfig = {
        sourceId: source.source_id,
        sourceType: source.source_type,
        displayName: source.display_name,
        connectionConfig,
        isEnabled: source.is_enabled,
      }

      const provider = createProvider(source.source_type, config)
      this.providers.set(source.source_id, provider)

      // For Plex providers with saved serverId, restore server selection with timeout
      if (source.source_type === 'plex' && connectionConfig.serverId && connectionConfig.token) {
        const plexProvider = provider as PlexProvider
        try {
          const restored = await this.withTimeout(
            this.restorePlexServer(plexProvider, connectionConfig, source, db),
            5000,
            'Plex server restoration timed out'
          )
          if (!restored) {
            unavailableSources.push({ name: source.display_name, type: source.source_type })
          }
        } catch (err) {
          getLoggingService().warn('[SourceManager]', `Could not reach Plex server for ${source.display_name}:`, err)
          unavailableSources.push({ name: source.display_name, type: source.source_type })
        }
      }
    } catch (err) {
      getLoggingService().error('[SourceManager]', `Failed to load source ${source.source_id}:`, err)
      unavailableSources.push({ name: source.display_name, type: source.source_type })
    }
  }

  private async restorePlexServer(
    provider: PlexProvider,
    config: any,
    source: MediaSource,
    db: ReturnType<typeof getDatabase>
  ): Promise<boolean> {
    try {
      // Get all servers for this token
      const servers = await (provider as any).getServers()
      const server = servers.find((s: any) => s.id === config.serverId)

      if (server) {
        // Select the server
        await (provider as any).selectServer(server)
        getLoggingService().info('[SourceManager]', `Restored Plex server connection: ${server.name} (${source.display_name})`)

        // Update last connected time
        db.updateSourceConnectionTime(source.source_id)
        return true
      } else {
        getLoggingService().warn('[SourceManager]', `Could not find Plex server ${config.serverId} for ${source.display_name}`)
        return false
      }
    } catch (err) {
      throw err
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timeoutId: NodeJS.Timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), ms)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      // @ts-ignore - timeoutId is initialized
      clearTimeout(timeoutId)
    }
  }

  // ============================================================================
  // SOURCE OPERATIONS
  // ============================================================================

  /**
   * Add a new source
   */
  async addSource(type: ProviderType | SourceConfig, config?: Omit<SourceConfig, 'sourceId'>): Promise<MediaSource> {
    const resolvedType = typeof type === 'string' ? type : type.sourceType
    const resolvedConfig = typeof type === 'string' ? config! : type as Omit<SourceConfig, 'sourceId'>
    
    const sourceId = this.generateSourceId(resolvedType)
    const fullConfig: SourceConfig = { ...resolvedConfig, sourceId }

    const provider = createProvider(resolvedType, fullConfig)
    this.providers.set(sourceId, provider)

    const db = getDatabase()
    const sourceData = {
      source_id: sourceId,
      source_type: resolvedType,
      display_name: resolvedConfig.displayName,
      connection_config: JSON.stringify(resolvedConfig.connectionConfig),
      is_enabled: resolvedConfig.isEnabled !== undefined ? resolvedConfig.isEnabled : true,
    }
    db.upsertMediaSource(sourceData)

    getLoggingService().info('[SourceManager]', `Added source: ${resolvedConfig.displayName} (${sourceId})`)
    try {
      db.createNotification({
        type: 'info',
        title: 'Source added',
        message: `${resolvedConfig.displayName} (${resolvedType})`,
        sourceId,
        sourceName: resolvedConfig.displayName
      })
    } catch { /* ignore */ }

    // Start live monitoring if enabled
    const monitoring = getLiveMonitoringService()
    monitoring.addSource(sourceId, resolvedType, sourceData.connection_config)

    return db.getMediaSourceById(sourceId)!
  }

  /**
   * Update an existing source
   */
  async updateSource(sourceId: string, updates: Partial<SourceConfig>): Promise<void> {
    await this.initialize()

    const db = getDatabase()
    const source = db.getMediaSourceById(sourceId)

    if (!source) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    const currentConfig = JSON.parse(source.connection_config)
    const updatedConfig = updates.connectionConfig
      ? { ...currentConfig, ...updates.connectionConfig }
      : currentConfig

    db.upsertMediaSource({
      source_id: sourceId,
      source_type: source.source_type,
      display_name: updates.displayName || source.display_name,
      connection_config: JSON.stringify(updatedConfig),
      is_enabled: updates.isEnabled !== undefined ? updates.isEnabled : source.is_enabled,
      last_connected_at: source.last_connected_at,
      last_scan_at: source.last_scan_at,
    })

    // If connectivity config changed, reload provider
    if (updates.connectionConfig || updates.displayName) {
      const config: SourceConfig = {
        sourceId,
        sourceType: source.source_type,
        displayName: updates.displayName || source.display_name,
        connectionConfig: updatedConfig,
        isEnabled: updates.isEnabled !== undefined ? updates.isEnabled : source.is_enabled,
      }

      const provider = createProvider(source.source_type, config)
      this.providers.set(sourceId, provider)
    }

    // Update monitoring
    const monitoring = getLiveMonitoringService()
    if (updates.isEnabled === false) {
      await monitoring.removeSource(sourceId)
    } else {
      monitoring.addSource(sourceId, source.source_type, JSON.stringify(updatedConfig))
    }

    getLoggingService().info('[SourceManager]', `Updated source: ${sourceId}`)
  }

  /**
   * Remove a source
   */
  async removeSource(sourceId: string): Promise<void> {
    await this.initialize()

    const db = getDatabase()
    const source = db.getMediaSourceById(sourceId)
    const sourceName = source?.display_name || sourceId

    // Remove from database
    db.deleteMediaSource(sourceId)

    // Remove from provider map
    this.providers.delete(sourceId)

    // Clean up associated data
    this.deleteMediaItemsForSource(sourceId)

    // Remove from monitoring
    const monitoring = getLiveMonitoringService()
    await monitoring.removeSource(sourceId)

    // Remove from task queue
    getTaskQueueService().removeTasksForSource(sourceId)

    try {
      db.createNotification({
        type: 'info',
        title: 'Source removed',
        message: sourceName
      })
    } catch { /* ignore */ }
    getLoggingService().info('[SourceManager]', `Removed source: ${sourceId}`)
  }

  deleteMediaItemsForSource(sourceId: string): void {
    const db = getDatabase()
    db.deleteMediaItemsForSource(sourceId)
  }

  /**
   * Test connection to a source
   */
  async testConnection(type: ProviderType | string, config?: any): Promise<ConnectionTestResult> {
    let resolvedType: ProviderType
    let resolvedConfig: any

    if (config) {
      resolvedType = type as ProviderType
      resolvedConfig = config
    } else {
      // type is sourceId
      await this.initialize()
      const db = getDatabase()
      const source = db.getMediaSourceById(type as string)
      if (!source) return { success: false, error: `Source not found: ${type}` }
      resolvedType = source.source_type as ProviderType
      resolvedConfig = JSON.parse(source.connection_config)
    }

    const fullConfig: SourceConfig = {
      sourceId: 'test-temp',
      sourceType: resolvedType,
      displayName: 'Test',
      connectionConfig: resolvedConfig,
      isEnabled: true,
    }

    const provider = createProvider(resolvedType, fullConfig)
    return provider.testConnection()
  }

  /**
   * Get all enabled sources
   */
  async getEnabledSources(): Promise<MediaSource[]> {
    await this.initialize()
    const db = getDatabase()
    return db.getEnabledMediaSources()
  }

  async getSources(type?: string): Promise<MediaSource[]> {
    await this.initialize()
    const db = getDatabase()
    return db.getMediaSources(type)
  }

  async getSource(id: string): Promise<MediaSource | null> {
    await this.initialize()
    const db = getDatabase()
    return db.getMediaSourceById(id)
  }

  getProvider(id: string): MediaProvider | undefined {
    return this.providers.get(id)
  }

  async toggleSource(id: string, enabled: boolean): Promise<void> {
    await this.updateSource(id, { isEnabled: enabled })
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  /**
   * Scan a single library from a specific source
   */
  async scanLibrary(
    sourceId: string,
    libraryId: string,
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    // Special handling for Plex server selection
    if (provider.providerType === 'plex') {
      const plexProvider = provider as PlexProvider
      if (!plexProvider.hasSelectedServer()) {
        throw new Error('No Plex server selected. Please configure the source first.')
      }
    }

    // Set scanning state
    this.isScanning = true
    this.scanCancelled = false

    try {
      getLoggingService().info('[SourceManager]', `Starting scan for ${sourceId}:${libraryId}`)

      // Perform the scan
      const result = await provider.scanLibrary(libraryId, {
        onProgress: (progress) => {
          if (this.scanCancelled) {
            throw new Error('Scan cancelled by user')
          }
          if (onProgress) {
            onProgress(progress)
          }
        }
      })

      // Update library scan timestamp if successful
      if (result.success) {
        const db = getDatabase()
        // Get library name for history/display
        const libraries = await provider.getLibraries()
        const library = libraries.find(l => l.id === libraryId)

        if (library) {
          db.updateLibraryScanTime(
            sourceId,
            libraryId,
            library.name,
            library.type,
            result.itemsScanned
          )
        }
      }

      return result
    } catch (error) {
      getLoggingService().error('[SourceManager]', `Scan failed for ${sourceId}:${libraryId}:`, error)
      return {
        success: false,
        itemsScanned: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsRemoved: 0,
        errors: [(error as Error).message],
        durationMs: 0,
      }
    } finally {
      this.isScanning = false
      this.scanCancelled = false
    }
  }

  /**
   * Scan all enabled libraries across all enabled sources
   */
  async scanAllEnabled(
    onProgress?: AggregateProgressCallback
  ): Promise<Map<string, ScanResult>> {
    await this.initialize()

    // Set scanning state
    this.isScanning = true
    this.scanCancelled = false

    const results = new Map<string, ScanResult>()
    const enabledSources = await this.getEnabledSources()

    try {
      for (const source of enabledSources) {
        // Check for cancellation before each source
        if (this.scanCancelled) {
          getLoggingService().info('[SourceManager]', '[SourceManager] Scan cancelled by user')
          break
        }

        const provider = this.providers.get(source.source_id)
        if (!provider) {
          getLoggingService().warn('[SourceManager]', `Provider not found for source: ${source.source_id}`)
          continue
        }

        // Skip Plex sources without a server selected
        if (provider.providerType === 'plex') {
          const plexProvider = provider as PlexProvider
          if (!plexProvider.hasSelectedServer()) {
            getLoggingService().info('[SourceManager]', `Skipping Plex source ${source.source_id} - no server selected`)
            continue
          }
        }

        try {
          // Get libraries for this source
          const libraries = await provider.getLibraries()
          const db = getDatabase()

          for (const library of libraries) {
            // Check for cancellation before each library
            if (this.scanCancelled) {
              getLoggingService().info('[SourceManager]', '[SourceManager] Scan cancelled by user')
              break
            }

            // Music libraries are scanned separately via music:scanLibrary
            if (library.type === 'music') continue

            // Skip disabled libraries
            if (!db.isLibraryEnabled(source.source_id, library.id)) {
              getLoggingService().info('[SourceManager]', `Skipping disabled library: ${library.name}`)
              continue
            }

            getLoggingService().verbose('[SourceManager]', `Scanning library: ${library.name} (${library.type}) from ${source.display_name}`)

            const result = await provider.scanLibrary(library.id, {
              onProgress: (progress) => {
                // Check for cancellation during progress
                if (this.scanCancelled) {
                  throw new Error('Scan cancelled by user')
                }
                if (onProgress) {
                  onProgress(source.source_id, source.display_name, progress)
                }
              }
            })

            const durationSec = (result.durationMs / 1000).toFixed(1)
            getLoggingService().verbose('[SourceManager]',
              `Scan complete: "${source.display_name}/${library.name}" — ${result.itemsScanned} items (${result.itemsAdded} new, ${result.itemsUpdated} updated, ${result.itemsRemoved} removed) in ${durationSec}s`,
              result.errors.length > 0 ? `Errors:\n${result.errors.join('\n')}` : undefined)

            results.set(`${source.source_id}:${library.id}`, result)
          }
        } catch (error) {
          // If cancelled, just break out
          if (this.scanCancelled) {
            break
          }
          getLoggingService().error('[SourceManager]', `Failed to scan source ${source.source_id}:`, error)
          results.set(source.source_id, {
            success: false,
            itemsScanned: 0,
            itemsAdded: 0,
            itemsUpdated: 0,
            itemsRemoved: 0,
            errors: [(error as Error).message],
            durationMs: 0,
          })
        }
      }

      return results
    } finally {
      this.isScanning = false
      this.scanCancelled = false
    }
  }

  async scanAllSources(onProgress?: AggregateProgressCallback): Promise<Map<string, ScanResult>> {
    return this.scanAllEnabled(onProgress)
  }

  async scanAllIncremental(onProgress?: AggregateProgressCallback): Promise<Map<string, ScanResult>> {
    return this.scanAllEnabled(onProgress) // Simplified for now
  }

  /**
   * Scan all libraries belonging to a single source
   */
  async scanSource(
    sourceId: string,
    onProgress?: ProgressCallback
  ): Promise<ScanResult[]> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    const libraries = await provider.getLibraries()
    const results: ScanResult[] = []

    for (const library of libraries) {
      if (library.type === 'music') continue
      
      const result = await this.scanLibrary(sourceId, library.id, onProgress)
      results.push(result)
    }

    return results
  }

  async scanTargetedFiles(
    sourceId: string,
    libraryId: string,
    _filePaths: string[],
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    await this.initialize()
    const provider = this.providers.get(sourceId)
    if (!provider) throw new Error(`Source not found: ${sourceId}`)
    
    // Most providers don't support targeted scanning yet, fall back to incremental
    return this.scanLibraryIncremental(sourceId, libraryId, onProgress)
  }

  // ============================================================================
  // INCREMENTAL SCANNING
  // ============================================================================

  /**
   * Perform an incremental scan of a library (only items added/modified since last scan)
   * Falls back to full scan if no previous scan timestamp exists
   */
  async scanLibraryIncremental(
    sourceId: string,
    libraryId: string,
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    await this.initialize()

    const db = getDatabase()
    const lastScanTime = db.getLibraryScanTime(sourceId, libraryId)

    // If never scanned, do full scan
    if (!lastScanTime) {
      getLoggingService().info('[SourceManager]', `No previous scan for ${sourceId}:${libraryId}, doing full scan`)
      return this.scanLibrary(sourceId, libraryId, onProgress)
    }

    const sinceTimestamp = new Date(lastScanTime)
    getLoggingService().info('[SourceManager]', `Incremental scan for ${sourceId}:${libraryId} since ${sinceTimestamp.toISOString()}`)

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    // Get library info for updating scan timestamp
    const libraries = await provider.getLibraries()
    const library = libraries.find(l => l.id === libraryId)

    const result = await provider.scanLibrary(libraryId, {
      onProgress,
      sinceTimestamp,
    })

    // Update library scan timestamp if successful
    if (result.success && library) {
      db.updateLibraryScanTime(
        sourceId,
        libraryId,
        library.name,
        library.type,
        result.itemsScanned
      )
    }

    return result
  }

  // ============================================================================
  // LIBRARY MANAGEMENT
  // ============================================================================

  /**
   * Get libraries for a source
   * Libraries are enriched with scan timestamps from the database
   */
  async getLibraries(sourceId: string): Promise<MediaLibrary[]> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    // For Plex sources, check if a server is selected before trying to get libraries
    if (provider.providerType === 'plex') {
      const plexProvider = provider as PlexProvider
      if (!plexProvider.hasSelectedServer()) {
        getLoggingService().info('[SourceManager]', `Plex source ${sourceId} has no server selected, returning empty libraries`)
        return []
      }
    }

    // Deduplicate concurrent calls for the same source
    const existing = this.getLibrariesPromises.get(sourceId)
    if (existing) {
      return existing
    }

    const promise = this.fetchLibraries(sourceId, provider)
    this.getLibrariesPromises.set(sourceId, promise)
    try {
      return await promise
    } finally {
      this.getLibrariesPromises.delete(sourceId)
    }
  }

  private async fetchLibraries(sourceId: string, provider: MediaProvider): Promise<MediaLibrary[]> {
    getLoggingService().info('[SourceManager]', `Getting libraries for ${sourceId} (${provider.providerType})`)
    const libraries = await provider.getLibraries()

    // Enrich libraries with scan timestamps from database
    const db = getDatabase()
    const scanTimes = db.getLibraryScanTimes(sourceId)

    return libraries.map(lib => ({
      ...lib,
      scannedAt: scanTimes.get(lib.id)?.lastScanAt || lib.scannedAt,
      itemCount: scanTimes.get(lib.id)?.itemsScanned || lib.itemCount,
    }))
  }

  async plexStartAuth(): Promise<any> { return { success: false, error: 'Not implemented' } }
  async plexCompleteAuth(_id: string): Promise<any> { return { success: false, error: 'Not implemented' } }
  async plexAuthenticateAndDiscover(_token: string, _name: string): Promise<any> { return { success: false, error: 'Not implemented' } }
  async plexSelectServer(_sId: string, _server: any): Promise<any> { return { success: false, error: 'Not implemented' } }
  async plexGetServers(_sourceId: string): Promise<any[]> { return [] }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  /**
   * Get aggregated stats across all sources
   */
  async getAggregatedStats(): Promise<{
    totalSources: number
    enabledSources: number
    totalItems: number
    bySource: Array<{
      sourceId: string
      displayName: string
      sourceType: string
      itemCount: number
      lastScanAt?: string
    }>
  }> {
    await this.initialize()

    const db = getDatabase()
    return db.getAggregatedSourceStats()
  }

  // ============================================================================
  // UTILITY
  // ============================================================================

  private generateSourceId(type: ProviderType): string {
    return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get supported provider types
   */
  getSupportedProviders(): ProviderType[] {
    return getSupportedProviders()
  }

  /**
   * Reload a provider (e.g., after config change)
   */
  async reloadProvider(sourceId: string): Promise<void> {
    await this.initialize()

    const db = getDatabase()
    const source = db.getMediaSourceById(sourceId)

    if (!source) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    const config: SourceConfig = {
      sourceId: source.source_id,
      sourceType: source.source_type,
      displayName: source.display_name,
      connectionConfig: JSON.parse(source.connection_config),
      isEnabled: source.is_enabled,
    }

    const provider = createProvider(source.source_type, config)
    this.providers.set(sourceId, provider)

    getLoggingService().info('[SourceManager]', `Reloaded provider: ${sourceId}`)
  }
}

// Singleton instance
let sourceManagerInstance: SourceManager | null = null

export function getSourceManager(): SourceManager {
  if (!sourceManagerInstance) {
    sourceManagerInstance = new SourceManager()
  }
  return sourceManagerInstance
}
