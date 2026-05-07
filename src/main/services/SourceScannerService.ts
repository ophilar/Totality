import { LibraryType, TaskType, ProviderType } from '@main/types/database'
import { type BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { LoggingService, getLoggingService } from '@main/services/LoggingService'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import type {
  MediaProvider,
  ScanResult,
  ProgressCallback,
  MediaLibrary,
} from '@main/providers/base/MediaProvider'

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

export class SourceScannerService {
  public activeScans: number = 0
  public scanCancelled: boolean = false

  constructor(
    private db: BetterSQLiteService,
    private providers: Map<string, MediaProvider>,
    private logging: LoggingService = getLoggingService()
  ) {}

  isScanInProgress(): boolean {
    return this.activeScans > 0
  }

  stopScan(): void {
    this.scanCancelled = true
    this.logging.info('[SourceScannerService]', 'Scan cancellation requested')
  }

  async scanLibrary(
    sourceId: string,
    libraryId: string,
    onProgress?: ProgressCallback
  ): Promise<ScanResult> {
    this.activeScans++
    try {
      const provider = this.providers.get(sourceId)
      if (!provider) throw new Error(`Source not found: ${sourceId}`)

      const libraries = await provider.getLibraries()
      const library = libraries.find(lib => lib.id === libraryId)

      let lastNotifyTime = 0
      const wrappedProgress: ProgressCallback = (progress) => {
        if (this.scanCancelled) {
          this.logging.info('[SourceScannerService]', 'Progress callback: Scan cancelled flag detected')
          throw new Error('Scan cancelled by user')
        }
        if (progress.phase === 'processing' && progress.current > 0) {
          const now = Date.now()
          if (lastNotifyTime === 0 || now - lastNotifyTime > 5000) {
            getLiveMonitoringService().sendToRenderer('library:updated', { type: 'media' })
            lastNotifyTime = now
          }
        }
        if (onProgress) onProgress(progress)
      }

      this.logging.info('[SourceScannerService]', `Starting scan: provider=${provider.providerType}, sourceId=${sourceId}, libraryId=${libraryId}`)
      const result = await provider.scanLibrary(libraryId, { onProgress: wrappedProgress })

      // Check if cancelled after the provider finishes
      const wasCancelled = this.scanCancelled
      if (wasCancelled) return this.getCancellerResult(result)

      if (result.success && library) {
        // BOLT: Analyze music quality if it was a music scan
        if (library.type === LibraryType.Music) {
          try {
            const { getQualityAnalyzer } = await import('./QualityAnalyzer')
            const analyzer = getQualityAnalyzer()
            const albums = await this.db.music.getMusicAlbums({ sourceId })
            const albumIds = albums.map((a: any) => a.id).filter((id: any) => id != null)
            const tracksByAlbum = await this.db.music.getMusicTracksByAlbumIds(albumIds)

            const BATCH_SIZE = 50
            for (let i = 0; i < albums.length; i += BATCH_SIZE) {
              const batch = albums.slice(i, i + BATCH_SIZE)
              await this.db.beginBatch()
              try {
                for (const album of batch) {
                  const tracks = tracksByAlbum.get(album.id!) || []
                  const qualityScore = analyzer.analyzeMusicAlbum(album, tracks)
                  await this.db.music.upsertQualityScore(qualityScore)
                }
              } finally {
                await this.db.endBatch()
              }
              // Yield to allow other IPCs
              await new Promise(r => setTimeout(r, 0))
            }
            this.logging.info('[SourceScannerService]', `Analyzed quality for ${albums.length} music albums`)
          } catch (err) {
            this.logging.error('[SourceScannerService]', 'Failed to analyze music quality after scan:', err)
          }
        }

        await this.db.sources.updateLibraryScanTime(sourceId, libraryId, result.itemsScanned)
        await this.startPostScanTasks(sourceId, libraryId, library)
      }

      return result
    } finally {
      this.activeScans--
      if (this.activeScans === 0) {
        this.scanCancelled = false
      }
      getLiveMonitoringService().notifyLibraryUpdated(sourceId)
    }
  }

  async scanAllSources(onProgress?: AggregateProgressCallback): Promise<Map<string, ScanResult>> {
    this.activeScans++
    try {
      const results = new Map<string, ScanResult>()
      const enabledSources = await this.db.sources.getEnabledSources()

      for (const source of enabledSources) {
        if (this.scanCancelled) break
        const provider = this.providers.get(source.source_id)
        if (!provider) continue

        if (provider.providerType === ProviderType.Plex && !(provider as PlexProvider).hasSelectedServer()) continue

        try {
          const libraries = await provider.getLibraries()
          for (const library of libraries) {
            if (this.scanCancelled) break
            if (library.type === LibraryType.Music) continue
            if (!(await this.db.sources.isLibraryEnabled(source.source_id, library.id))) continue

            const result = await provider.scanLibrary(library.id, {
              onProgress: (progress) => {
                if (this.scanCancelled) throw new Error('Scan cancelled by user')
                if (onProgress) onProgress(source.source_id, source.display_name, progress)
              }
            })
            results.set(`${source.source_id}:${library.id}`, result)
            if (result.success) {
              await this.db.sources.updateLibraryScanTime(source.source_id, library.id, result.itemsScanned)
              await this.startPostScanTasks(source.source_id, library.id, library)
            }
          }
        } catch (error) {
          if (this.scanCancelled) break
          this.logging.error('[SourceScannerService]', `Failed to scan source ${source.source_id}:`, error)
        }
      }
      return results
    } finally {
      this.activeScans--
      if (this.activeScans === 0) this.scanCancelled = false
      getLiveMonitoringService().notifyLibraryUpdated()
    }
  }

  private getCancellerResult(result: ScanResult): ScanResult {
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

  private async startPostScanTasks(sourceId: string, libraryId: string, library: MediaLibrary) {
    try {
      const { getWishlistCompletionService } = await import('./WishlistCompletionService')
      const tq = getTaskQueueService()
      const hasTmdbKey = await this.db.config.getSetting('tmdb_api_key')
      
      if (library.type === LibraryType.Show || library.type === LibraryType.Mixed) {
        tq.addTask({ type: TaskType.SeriesCompleteness, label: `Post-scan Series Analysis: ${library.name}`, sourceId, libraryId })
      }
      
      if (hasTmdbKey) {
        if (library.type === LibraryType.Movie || library.type === LibraryType.Mixed) {
          tq.addTask({ type: TaskType.CollectionCompleteness, label: `Post-scan Collection Analysis: ${library.name}`, sourceId, libraryId })
        }
      }
      getWishlistCompletionService().checkAndComplete().catch(err => {
        this.logging.error('[SourceScannerService]', 'Post-scan wishlist check failed:', err)
      })
    } catch (err) {
      this.logging.error('[SourceScannerService]', 'Failed to start post-scan background tasks:', err)
    }
  }
}
