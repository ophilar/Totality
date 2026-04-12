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
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import { createProvider, getSupportedProviders } from '../providers/ProviderFactory'
import { PlexProvider } from '../providers/plex/PlexProvider'
import type {
  MediaProvider,
  ProviderType,
  SourceConfig,
  ConnectionTestResult,
  ScanResult,
  ProgressCallback,
  ServerInstance,
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

export interface SourceManagerDependencies {
  db?: any
  liveMonitoring?: any
  taskQueue?: any
  logging?: any
}

export class SourceManager {
  private providers: Map<string, MediaProvider> = new Map()
  private initPromise: Promise<void> | null = null
  private scanCancelled: boolean = false
  private isScanning: boolean = false
  private getLibrariesPromises: Map<string, Promise<MediaLibrary[]>> = new Map()
  
  private db: any
  private liveMonitoring: any
  private taskQueue: any
  private logging: any

  constructor(deps: SourceManagerDependencies = {}) {
    this.db = deps.db || getDatabase()
    this.liveMonitoring = deps.liveMonitoring || null // Lazy load if not provided
    this.taskQueue = deps.taskQueue || null // Lazy load if not provided
    this.logging = deps.logging || getLoggingService()
  }

  private getLiveMonitoring(): any {
    if (!this.liveMonitoring) {
      this.liveMonitoring = getLiveMonitoringService()
    }
    return this.liveMonitoring
  }

  private getTaskQueue(): any {
    if (!this.taskQueue) {
      this.taskQueue = getTaskQueueService()
    }
    return this.taskQueue
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
      this.logging.info('[SourceManager]', '[SourceManager] Stopping scan...')
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
    const db = this.db
    const sources = db.sourceRepo.getMediaSources()
    const unavailableSources: Array<{ name: string; type: string }> = []

    // Load all providers in parallel with per-source timeout
    await Promise.allSettled(
      sources.map((source: MediaSource) => this.loadSingleSource(source, db, unavailableSources))
    )

    this.logging.info('[SourceManager]', `Initialized with ${this.providers.size} providers`)

    // Create notifications for unavailable sources (after startup)
    if (unavailableSources.length > 0) {
      const names = unavailableSources.map(s => s.name).join(', ')
      this.logging.warn('[SourceManager]', `Unavailable sources at startup: ${names}`)
      try {
        db.notificationRepo.createNotification({
          type: 'error',
          title: 'Media source unavailable',
          message: unavailableSources.length === 1
            ? `"${unavailableSources[0].name}" could not be reached at startup. Please check the connection.`
            : `${unavailableSources.length} sources could not be reached at startup: ${names}. Please check their connections.`,
        })
      } catch (err) {
        this.logging.warn('[SourceManager]', '[SourceManager] Could not create notification for unavailable sources:', err)
      }
    }
  }

  private async loadSingleSource(
    source: MediaSource,
    db: any,
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
            `Plex server "${source.display_name}" connection timed out`
          )
          if (!restored) {
            unavailableSources.push({ name: source.display_name, type: source.source_type })
          }
        } catch (error) {
          this.logging.warn('[SourceManager]', `Could not restore server for ${source.display_name}:`, error)
          unavailableSources.push({ name: source.display_name, type: source.source_type })
        }
      }

      this.logging.info('[SourceManager]', `Loaded provider: ${source.display_name} (${source.source_type})`)
    } catch (error) {
      this.logging.error('[SourceManager]', `Failed to load provider ${source.source_id}:`, error)
    }
  }

  private async restorePlexServer(
    plexProvider: PlexProvider,
    connectionConfig: Record<string, unknown>,
    source: MediaSource,
    db: any
  ): Promise<boolean> {
    // Set token first (should be set in constructor, but ensure it's set)
    if (!await plexProvider.isAuthenticated()) {
      plexProvider.setAuthToken(connectionConfig.token as string)
    }
    // Restore server selection
    const success = await plexProvider.selectServer(connectionConfig.serverId as string)
    if (success) {
      const server = plexProvider.getSelectedServer()
      // Update display name to actual server name if it differs
      if (server && server.name && server.name !== source.display_name) {
        await db.sourceRepo.upsertMediaSource({
          ...source,
          display_name: server.name,
        })
        this.logging.info('[SourceManager]', `Restored server selection: ${server.name}`)
      } else {
        this.logging.info('[SourceManager]', `Restored server selection for ${source.display_name}`)
      }

      return true
    } else {
      this.logging.warn('[SourceManager]', `Failed to restore server selection for ${source.display_name}`)
      return false
    }
  }

  /**
   * Run a promise with a timeout. Rejects if the promise doesn't resolve within the given ms.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_resolve, reject) =>
        setTimeout(() => reject(new Error(timeoutMessage)), ms)
      ),
    ])
  }

  // ============================================================================
  // SOURCE CRUD
  // ============================================================================

  /**
   * Add a new media source
   */
  async addSource(config: SourceConfig): Promise<MediaSource> {
    await this.initialize()

    const db = this.db
    const sourceId = config.sourceId || this.generateSourceId(config.sourceType)

    // Create the provider instance
    const provider = createProvider(config.sourceType, {
      ...config,
      sourceId,
    })

    // Store in database
    const sourceRecord: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'> = {
      source_id: sourceId,
      source_type: config.sourceType,
      display_name: config.displayName,
      connection_config: JSON.stringify(config.connectionConfig),
      is_enabled: config.isEnabled !== false,
    }

    await db.sourceRepo.upsertMediaSource(sourceRecord as any)

    // Add to active providers
    this.providers.set(sourceId, provider)

    // Return the full source record
    const source = db.sourceRepo.getMediaSourceById(sourceId)
    if (!source) {
      throw new Error('Failed to retrieve created source')
    }

    this.logging.info('[SourceManager]', `Added source: ${config.displayName} (${sourceId})`)
    return source
  }

  /**
   * Update an existing media source
   */
  async updateSource(sourceId: string, updates: Partial<SourceConfig>): Promise<void> {
    await this.initialize()

    const db = this.db
    const existing = db.sourceRepo.getMediaSourceById(sourceId)

    if (!existing) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    const updatedSource: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'> = {
      source_id: sourceId,
      source_type: updates.sourceType || existing.source_type,
      display_name: updates.displayName || existing.display_name,
      connection_config: updates.connectionConfig
        ? JSON.stringify(updates.connectionConfig)
        : existing.connection_config,
      is_enabled: updates.isEnabled !== undefined ? updates.isEnabled : existing.is_enabled,
    }

    await db.sourceRepo.upsertMediaSource(updatedSource)

    // If connection config changed, recreate provider
    if (updates.connectionConfig) {
      const config: SourceConfig = {
        sourceId,
        sourceType: updatedSource.source_type,
        displayName: updatedSource.display_name,
        connectionConfig: updates.connectionConfig,
        isEnabled: updatedSource.is_enabled,
      }
      const provider = createProvider(updatedSource.source_type, config)
      this.providers.set(sourceId, provider)
    }

    this.logging.info('[SourceManager]', `Updated source: ${sourceId}`)
  }

  /**
   * Remove a media source and all its data
   */
  async removeSource(sourceId: string): Promise<void> {
    await this.initialize()

    const db = this.db

    // 1. Stop live monitoring for this source
    this.getLiveMonitoring().removeSource(sourceId)

    // 2. Cancel and remove any queued tasks for this source
    this.getTaskQueue().removeTasksForSource(sourceId)

    // 3. Remove from providers map
    this.providers.delete(sourceId)

    // 4. Remove from database (includes notifications cleanup)
    await db.sourceRepo.deleteMediaSource(sourceId)

    // 5. Clean up cached artwork files
    await this.cleanupArtworkCache(sourceId)

    this.logging.info('[SourceManager]', `Removed source: ${sourceId}`)
  }

  /**
   * Clean up cached artwork files for a deleted source
   */
  private async cleanupArtworkCache(sourceId: string): Promise<void> {
    const artworkPath = path.join(app.getPath('userData'), 'artwork', sourceId)
    try {
      await fs.rm(artworkPath, { recursive: true, force: true })
      this.logging.info('[SourceManager]', `Cleaned up artwork cache for ${sourceId}`)
    } catch (error) {
      // Ignore if folder doesn't exist or other errors
      this.logging.info('[SourceManager]', `No artwork cache to clean up for ${sourceId}`)
    }
  }

  /**
   * Get all configured sources
   */
  async getSources(type?: ProviderType): Promise<MediaSource[]> {
    await this.initialize()

    const db = this.db
    return db.sourceRepo.getMediaSources(type) as any
  }

  /**
   * Get a specific source by ID
   */
  async getSource(sourceId: string): Promise<MediaSource | null> {
    await this.initialize()

    const db = this.db
    return db.sourceRepo.getMediaSourceById(sourceId)
  }

  /**
   * Get enabled sources only
   */
  async getEnabledSources(): Promise<MediaSource[]> {
    await this.initialize()

    const db = this.db
    return db.sourceRepo.getEnabledMediaSources()
  }

  /**
   * Toggle source enabled status
   */
  async toggleSource(sourceId: string, enabled: boolean): Promise<void> {
    await this.initialize()

    const db = this.db
    const source = db.sourceRepo.getMediaSourceById(sourceId)
    if (source) {
      db.sourceRepo.upsertMediaSource({ ...source, is_enabled: enabled })
    }
  }

  // ============================================================================
  // PROVIDER MANAGEMENT
  // ============================================================================

  /**
   * Get a provider instance by source ID
   */
  getProvider(sourceId: string): MediaProvider | undefined {
    return this.providers.get(sourceId)
  }

  /**
   * Get Plex provider (typed version)
   */
  getPlexProvider(sourceId: string): PlexProvider | undefined {
    const provider = this.providers.get(sourceId)
    if (provider?.providerType === 'plex') {
      return provider as PlexProvider
    }
    return undefined
  }

  /**
   * Test connection for a source
   */
  async testConnection(sourceId: string): Promise<ConnectionTestResult> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      return { success: false, error: `Source not found: ${sourceId}` }
    }

    // For Plex sources, check if a server is selected before testing connection
    if (provider.providerType === 'plex') {
      const plexProvider = provider as PlexProvider
      if (!plexProvider.hasSelectedServer()) {
        return { success: false, error: 'No server selected - please complete setup' }
      }
    }

    const db = this.db

    // For Jellyfin/Emby: authenticate with credentials if no access token
    if (provider.providerType === 'jellyfin' || provider.providerType === 'emby') {
      const authResult = await this.authenticateJellyfinEmbyIfNeeded(sourceId, provider, db)
      if (authResult) return authResult // Returns error result if auth failed
    }

    // Run the actual connection test
    const currentProvider = this.providers.get(sourceId) || provider
    const startTime = Date.now()
    const result = await currentProvider.testConnection()
    const elapsed = Date.now() - startTime

    if (result.success) {
      await db.sourceRepo.updateSourceConnectionTime(sourceId)
      this.logging.verbose('[SourceManager]', `Connection test passed for ${currentProvider.providerType} source in ${elapsed}ms`, result.serverVersion ? `Server version: ${result.serverVersion}` : undefined)
    } else {
      this.logging.verbose('[SourceManager]', `Connection test failed for ${currentProvider.providerType} source in ${elapsed}ms`, result.error || undefined)
    }

    return result
  }

  /**
   * Authenticate Jellyfin/Emby with username/password if no access token exists.
   * Returns a ConnectionTestResult on failure, or null if auth succeeded or wasn't needed.
   */
  private async authenticateJellyfinEmbyIfNeeded(
    sourceId: string,
    provider: MediaProvider,
    db: any,
  ): Promise<ConnectionTestResult | null> {
    const source = db.sourceRepo.getMediaSourceById(sourceId)
    if (!source) return null

    try {
      const config = JSON.parse(source.connection_config)
      if (!config.username || !config.password || config.accessToken) return null

      this.logging.info('[SourceManager]', `Authenticating ${provider.providerType} with username/password`)

      const authResult = await provider.authenticate({
        serverUrl: config.serverUrl,
        username: config.username,
        password: config.password,
      })

      if (!authResult.success || !authResult.token) {
        return { success: false, error: authResult.error || 'Authentication failed' }
      }

      // Save token and remove password from stored config
      const updatedConfig = {
        ...config,
        accessToken: authResult.token,
        userId: authResult.userId,
        password: undefined,
      }

      await db.sourceRepo.upsertMediaSource({
        source_id: sourceId,
        source_type: source.source_type,
        display_name: source.display_name,
        connection_config: JSON.stringify(updatedConfig),
        is_enabled: source.is_enabled,
      } as any)

      // Recreate provider with new credentials
      const newProvider = createProvider(source.source_type, {
        sourceId,
        sourceType: source.source_type as ProviderType,
        displayName: source.display_name,
        connectionConfig: updatedConfig,
        isEnabled: source.is_enabled,
      })
      this.providers.set(sourceId, newProvider)

      this.logging.info('[SourceManager]', `${provider.providerType} authenticated and credentials saved`)
      return null // Auth succeeded
    } catch (err: unknown) {
      this.logging.error('[SourceManager]', `Error during ${provider.providerType} authentication:`, err)
      return { success: false, error: err instanceof Error ? err.message : 'Authentication error' }
    }
  }

  // ============================================================================
  // PLEX-SPECIFIC AUTHENTICATION
  // ============================================================================

  /**
   * Start Plex OAuth flow
   */
  async plexStartAuth(): Promise<{ pinId: number; code: string; authUrl: string }> {
    // Create a temporary provider for auth
    const tempProvider = new PlexProvider({
      sourceId: 'temp-auth',
      sourceType: 'plex',
      displayName: 'Temp Auth',
      connectionConfig: {},
    })

    const pin = await tempProvider.requestAuthPin()
    const authUrl = tempProvider.getAuthUrl(pin.id, pin.code)

    return {
      pinId: pin.id,
      code: pin.code,
      authUrl,
    }
  }

  /**
   * Complete Plex OAuth flow
   */
  async plexCompleteAuth(pinId: number): Promise<string | null> {
    const tempProvider = new PlexProvider({
      sourceId: 'temp-auth',
      sourceType: 'plex',
      displayName: 'Temp Auth',
      connectionConfig: {},
    })

    return tempProvider.checkAuthPin(pinId)
  }

  /**
   * Authenticate with Plex token and get servers
   */
  async plexAuthenticateAndDiscover(
    token: string,
    displayName: string
  ): Promise<{ source: MediaSource; servers: ServerInstance[] }> {
    // Create provider with token
    const config: SourceConfig = {
      sourceType: 'plex',
      displayName,
      connectionConfig: { token },
    }

    const provider = new PlexProvider(config) as PlexProvider
    const authResult = await provider.authenticate({ token })

    if (!authResult.success) {
      throw new Error(authResult.error || 'Authentication failed')
    }

    // Discover servers
    const servers = await provider.discoverServers()

    // Add the source
    const source = await this.addSource({
      ...config,
      sourceId: provider.sourceId,
      connectionConfig: { token },
    })

    // Update provider in map
    this.providers.set(source.source_id, provider)

    return { source, servers }
  }

  /**
   * Select a Plex server for a source
   */
  async plexSelectServer(
    sourceId: string,
    serverId: string
  ): Promise<{ success: boolean; libraries?: MediaLibrary[] }> {
    const provider = this.getPlexProvider(sourceId)
    if (!provider) {
      throw new Error(`Plex source not found: ${sourceId}`)
    }

    const success = await provider.selectServer(serverId)
    if (!success) {
      return { success: false }
    }

    // Update connection config and display name with selected server
    const server = provider.getSelectedServer()
    if (server) {
      const db = this.db
      const source = db.sourceRepo.getMediaSourceById(sourceId)
      if (source) {
        const config = JSON.parse(source.connection_config)
        config.serverId = server.machineIdentifier
        config.serverUrl = server.uri

        await db.sourceRepo.upsertMediaSource({
          ...source,
          display_name: server.name || source.display_name, // Use actual server name
          connection_config: JSON.stringify(config),
        })
      }
    }

    // Get libraries
    const libraries = await provider.getLibraries()

    return { success: true, libraries }
  }

  /**
   * Get Plex servers for a source
   */
  async plexGetServers(sourceId: string): Promise<ServerInstance[]> {
    const provider = this.getPlexProvider(sourceId)
    if (!provider) {
      throw new Error(`Plex source not found: ${sourceId}`)
    }

    if (!provider.discoverServers) {
      throw new Error('Provider does not support server discovery')
    }

    return provider.discoverServers()
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  /**
   * Scan a library for a specific source
   * Updates the library scan timestamp after successful scan
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

    // Set scanning state
    this.isScanning = true
    this.scanCancelled = false

    try {
      // Get library info for timestamp recording
      const libraries = await provider.getLibraries()
      const library = libraries.find(lib => lib.id === libraryId)

      // Wrap progress callback to check for cancellation
      const wrappedProgress: ProgressCallback | undefined = onProgress ? (progress) => {
        if (this.scanCancelled) {
          throw new Error('Scan cancelled by user')
        }
        onProgress(progress)
      } : undefined

      this.logging.info('[SourceManager]', `Starting scan: provider=${provider.providerType}, sourceId=${sourceId}, libraryId=${libraryId}`)
      const result = await provider.scanLibrary(libraryId, { onProgress: wrappedProgress })
      this.logging.info('[SourceManager]', `Scan result: itemsScanned=${result.itemsScanned}, itemsAdded=${result.itemsAdded}, itemsUpdated=${result.itemsUpdated}, itemsRemoved=${result.itemsRemoved}, success=${result.success}, errors=${result.errors.length}`)

      // Verbose scan summary
      const durationSec = (result.durationMs / 1000).toFixed(1)
      this.logging.verbose('[SourceManager]',
        `Scan complete: ${library?.name || libraryId} — ${result.itemsScanned} items (${result.itemsAdded} new, ${result.itemsUpdated} updated, ${result.itemsRemoved} removed) in ${durationSec}s`,
        result.errors.length > 0 ? `Errors: ${result.errors.join('; ')}` : undefined)

      // Check if cancelled
      if (this.scanCancelled) {
        return {
          success: false,
          itemsScanned: result.itemsScanned,
          itemsAdded: result.itemsAdded,
          itemsUpdated: result.itemsUpdated,
          itemsRemoved: 0,
          errors: ['Scan cancelled by user'],
          durationMs: result.durationMs,
        }
      }

      // Update library scan timestamp if successful
      if (result.success && library) {
        const db = this.db
        await db.sourceRepo.updateLibraryScanTime(
          sourceId,
          libraryId,
          result.itemsScanned
        )
        this.logging.info('[SourceManager]', `Updated scan timestamp for library ${library.name}`)

        // Start post-scan background tasks
        try {
          const { getWishlistCompletionService } = await import('./WishlistCompletionService')
          const tq = this.getTaskQueue()

          // 1. Completeness Checks
          if (library.type === 'tv' || library.type === 'mixed') {
            tq.addTask({
              type: 'series-completeness',
              label: `Post-scan Series Analysis: ${library.name}`,
              sourceId,
              libraryId
            })
          }
          if (library.type === 'movie' || library.type === 'mixed') {
            tq.addTask({
              type: 'collection-completeness',
              label: `Post-scan Collection Analysis: ${library.name}`,
              sourceId,
              libraryId
            })
          }

          // 2. Wishlist check (decoupled from task queue)
          getWishlistCompletionService().checkAndComplete().catch(err => {
            this.logging.error('[SourceManager]', 'Post-scan wishlist check failed:', err)
          })
        } catch (err) {
          this.logging.error('[SourceManager]', 'Failed to start post-scan background tasks:', err)
        }
      }

      return result
    } finally {
      this.isScanning = false
      this.scanCancelled = false

      // Notify renderer that library data has changed
      try {
        this.getLiveMonitoring().notifyLibraryUpdated()
      } catch (err) {
        this.logging.error('[SourceManager]', 'Failed to notify library update:', err)
      }
    }
  }

  /**
   * Scan all libraries for a specific source
   */
  async scanSource(sourceId: string, onProgress?: ProgressCallback): Promise<void> {
    await this.initialize()
    const provider = this.providers.get(sourceId)
    if (!provider) throw new Error(`Source not found: ${sourceId}`)

    const libraries = await provider.getLibraries()
    for (const library of libraries) {
      if (this.scanCancelled) break

      // Music libraries are scanned separately via music service
      if (library.type === 'music') continue

      // Skip disabled libraries
      const db = this.db
      if (!db.sourceRepo.isLibraryEnabled(sourceId, library.id)) continue

      await this.scanLibrary(sourceId, library.id, onProgress)
    }
  }

  /**
   * Scan all libraries across all enabled sources
   */
  async scanAllSources(onProgress?: AggregateProgressCallback): Promise<Map<string, ScanResult>> {
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
          this.logging.info('[SourceManager]', '[SourceManager] Scan cancelled by user')
          break
        }

        const provider = this.providers.get(source.source_id)
        if (!provider) {
          this.logging.warn('[SourceManager]', `Provider not found for source: ${source.source_id}`)
          continue
        }

        // Skip Plex sources without a server selected
        if (provider.providerType === 'plex') {
          const plexProvider = provider as PlexProvider
          if (!plexProvider.hasSelectedServer()) {
            this.logging.info('[SourceManager]', `Skipping Plex source ${source.source_id} - no server selected`)
            continue
          }
        }

        try {
          // Get libraries for this source
          const libraries = await provider.getLibraries()
          const db = this.db

          for (const library of libraries) {
            // Check for cancellation before each library
            if (this.scanCancelled) {
              this.logging.info('[SourceManager]', '[SourceManager] Scan cancelled by user')
              break
            }

            // Music libraries are scanned separately via music:scanLibrary
            if (library.type === 'music') continue

            // Skip disabled libraries
            if (!db.sourceRepo.isLibraryEnabled(source.source_id, library.id)) {
              this.logging.info('[SourceManager]', `Skipping disabled library: ${library.name}`)
              continue
            }

            this.logging.verbose('[SourceManager]', `Scanning library: ${library.name} (${library.type}) from ${source.display_name}`)

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
            this.logging.verbose('[SourceManager]',
              `Scan complete: "${source.display_name}/${library.name}" — ${result.itemsScanned} items (${result.itemsAdded} new, ${result.itemsUpdated} updated, ${result.itemsRemoved} removed) in ${durationSec}s`,
              result.errors.length > 0 ? `Errors:\n${result.errors.join('\n')}` : undefined)

            results.set(`${source.source_id}:${library.id}`, result)

            // Update library scan timestamp if successful
            if (result.success) {
              await db.sourceRepo.updateLibraryScanTime(
                source.source_id,
                library.id,
                result.itemsScanned
              )

              // Start post-scan background tasks
              try {
                const { getWishlistCompletionService } = await import('./WishlistCompletionService')
                const tq = this.getTaskQueue()

                // 1. Completeness Checks
                if (library.type === 'tv' || library.type === 'mixed') {
                  tq.addTask({
                    type: 'series-completeness',
                    label: `Post-scan Series Analysis: ${library.name}`,
                    sourceId: source.source_id,
                    libraryId: library.id
                  })
                }
                if (library.type === 'movie' || library.type === 'mixed') {
                  tq.addTask({
                    type: 'collection-completeness',
                    label: `Post-scan Collection Analysis: ${library.name}`,
                    sourceId: source.source_id,
                    libraryId: library.id
                  })
                }

                // 2. Wishlist check (decoupled from task queue)
                getWishlistCompletionService().checkAndComplete().catch(err => {
                  this.logging.error('[SourceManager]', 'Post-scan wishlist check failed:', err)
                })
              } catch (err) {
                this.logging.error('[SourceManager]', 'Failed to start post-scan background tasks:', err)
              }
            }
          }
        } catch (error) {
          // If cancelled, just break out
          if (this.scanCancelled) {
            break
          }
          this.logging.error('[SourceManager]', `Failed to scan source ${source.source_id}:`, error)
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

      // Notify renderer that library data has changed
      try {
        this.getLiveMonitoring().notifyLibraryUpdated()
      } catch (err) {
        this.logging.error('[SourceManager]', 'Failed to notify library update:', err)
      }
    }
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

    const db = this.db
    const lastScanTime = db.sourceRepo.getLibraryScanTime(sourceId, libraryId)

    // If never scanned, do full scan
    if (!lastScanTime) {
      this.logging.info('[SourceManager]', `No previous scan for ${sourceId}:${libraryId}, doing full scan`)
      return this.scanLibrary(sourceId, libraryId, onProgress)
    }

    const sinceTimestamp = new Date(lastScanTime)
    this.logging.info('[SourceManager]', `Incremental scan for ${sourceId}:${libraryId} since ${sinceTimestamp.toISOString()}`)

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
      await db.sourceRepo.updateLibraryScanTime(
        sourceId,
        libraryId,
        result.itemsScanned
      )
    }

    return result
  }

  /**
   * Scan specific files (for live monitoring when file changes detected)
   * Much faster than full or incremental scan
   */
  async scanTargetedFiles(
    sourceId: string,
    libraryId: string,
    filePaths: string[],
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    await this.initialize()

    const provider = this.providers.get(sourceId)
    if (!provider) {
      throw new Error(`Source not found: ${sourceId}`)
    }

    this.logging.info('[SourceManager]', `Targeted scan of ${filePaths.length} files for ${sourceId}:${libraryId}`)

    const result = await provider.scanLibrary(libraryId, {
      onProgress,
      targetFiles: filePaths,
    })

    return result
  }

  /**
   * Perform incremental scan of all libraries across all enabled sources
   * This is intended for quick refresh on app startup
   */
  async scanAllIncremental(
    onProgress?: AggregateProgressCallback
  ): Promise<Map<string, ScanResult>> {
    await this.initialize()

    const db = this.db
    const enabledSources = db.sourceRepo.getEnabledMediaSources()
    const results = new Map<string, ScanResult>()

    this.logging.info('[SourceManager]', `Starting incremental scan of ${enabledSources.length} sources`)

    for (const source of enabledSources) {
      const provider = this.providers.get(source.source_id)
      if (!provider) continue

      try {
        const libraries = await provider.getLibraries()

        for (const library of libraries) {
          // Skip music libraries
          if (library.type === 'music') continue

          // Skip disabled libraries
          if (!db.sourceRepo.isLibraryEnabled(source.source_id, library.id)) {
            this.logging.info('[SourceManager]', `Skipping disabled library: ${source.display_name}/${library.name}`)
            continue
          }

          const lastScanTime = db.sourceRepo.getLibraryScanTime(source.source_id, library.id)
          const sinceTimestamp = lastScanTime ? new Date(lastScanTime) : undefined

          if (sinceTimestamp) {
            this.logging.info('[SourceManager]', `Incremental scan: ${source.display_name}/${library.name} since ${sinceTimestamp.toISOString()}`)
          } else {
            this.logging.info('[SourceManager]', `Full scan (no previous): ${source.display_name}/${library.name}`)
          }

          const result = await provider.scanLibrary(library.id, {
            sinceTimestamp,
            onProgress: onProgress ? (progress) => {
              onProgress(source.source_id, source.display_name, progress)
            } : undefined,
          })

          // Update library scan timestamp if successful
          if (result.success) {
            await db.sourceRepo.updateLibraryScanTime(
              source.source_id,
              library.id,
              result.itemsScanned
            )
          }

          results.set(`${source.source_id}:${library.id}`, result)
        }
      } catch (error) {
        this.logging.error('[SourceManager]', `Incremental scan failed for ${source.source_id}:`, error)
      }
    }

    this.logging.info('[SourceManager]', `Incremental scan complete: ${results.size} libraries processed`)
    return results
  }

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
        this.logging.info('[SourceManager]', `Plex source ${sourceId} has no server selected, returning empty libraries`)
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
    this.logging.info('[SourceManager]', `Getting libraries for ${sourceId} (${provider.providerType})`)
    const libraries = await provider.getLibraries()

    // Enrich libraries with scan timestamps from database
    const db = this.db
    const scanTimes = db.sourceRepo.getLibraryScanTimes(sourceId)

    return libraries.map(lib => ({
      ...lib,
      scannedAt: scanTimes.get(lib.id)?.lastScanAt || lib.scannedAt,
      itemCount: scanTimes.get(lib.id)?.itemsScanned || lib.itemCount,
    }))
  }

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

    const db = this.db
    return db.statsRepo.getAggregatedSourceStats()
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

    const db = this.db
    const source = db.sourceRepo.getMediaSourceById(sourceId)

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

    this.logging.info('[SourceManager]', `Reloaded provider: ${sourceId}`)
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
