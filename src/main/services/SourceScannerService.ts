import { LibraryType, ProviderType } from '@main/types/database'
import { type BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import { LoggingService, getLoggingService } from '@main/services/LoggingService'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import type {
  MediaProvider,
  ScanResult,
  ProgressCallback,
  ScanProgress,
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
    for (const provider of this.providers.values()) {
      if (typeof (provider as MediaProvider & { cancelScan?: () => void }).cancelScan === 'function') {
        (provider as MediaProvider & { cancelScan: () => void }).cancelScan()
      }
      if (typeof (provider as MediaProvider & { cancelMusicScan?: () => void }).cancelMusicScan === 'function') {
        (provider as MediaProvider & { cancelMusicScan: () => void }).cancelMusicScan()
      }
    }
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
      let lastLoggedPhase: ScanProgress['phase'] | undefined
      let lastLoggedProgressBucket = -1
      const wrappedProgress: ProgressCallback = (progress) => {
        if (this.scanCancelled) {
          this.logging.info('[SourceScannerService]', 'Progress callback: Scan cancelled flag detected')
          throw new Error('Scan cancelled by user')
        }
        const progressBucket = Math.floor(progress.percentage / 10) * 10
        if (progress.phase !== lastLoggedPhase || progressBucket > lastLoggedProgressBucket) {
          this.logging.debug(
            '[SourceScannerService]',
            `Scan progress: provider=${provider.providerType}, sourceId=${sourceId}, libraryId=${libraryId}, phase=${progress.phase}, current=${progress.current}/${progress.total}, percentage=${progress.percentage}`
          )
          lastLoggedPhase = progress.phase
          lastLoggedProgressBucket = progressBucket
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
      const wasCancelled = this.scanCancelled
      this.logging.info(
        '[SourceScannerService]',
        `Scan finished: provider=${provider.providerType}, sourceId=${sourceId}, libraryId=${libraryId}, success=${result.success}, cancelled=${wasCancelled || result.cancelled === true}, scanned=${result.itemsScanned}, added=${result.itemsAdded}, updated=${result.itemsUpdated}, removed=${result.itemsRemoved}, durationMs=${result.durationMs}, errors=${result.errors.length}`
      )
      if (result.errors.length > 0) {
        this.logging.warn('[SourceScannerService]', `Scan errors for sourceId=${sourceId}, libraryId=${libraryId}:`, result.errors)
      }

      // Check if cancelled after the provider finishes
      if (wasCancelled) return this.getCancellerResult(result)

      if (result.success && !this.scanCancelled && result.cancelled !== true && library) {
        await this.db.sources.updateLibraryScanTime(sourceId, libraryId, result.itemsScanned)
        result.postScanAnalysis = await this.startPostScanTasks(sourceId, libraryId)
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

        let currentLibraryId: string | undefined
        try {
          const libraries = await provider.getLibraries()
          const enabledLibraries = await this.db.sources.getEnabledLibraries(source.source_id)
          let lastLoggedPhase: string | undefined
          let lastLoggedProgressBucket = -1
          for (const library of libraries) {
            if (this.scanCancelled) break
            if (library.type === LibraryType.Music) continue
            if (!enabledLibraries.has(library.id)) continue

            currentLibraryId = library.id
            lastLoggedPhase = undefined
            lastLoggedProgressBucket = -1
            this.logging.info('[SourceScannerService]', `Starting scan: provider=${provider.providerType}, sourceId=${source.source_id}, libraryId=${library.id}`)
            const result = await provider.scanLibrary(library.id, {
              onProgress: (progress) => {
                if (this.scanCancelled) throw new Error('Scan cancelled by user')
                const progressBucket = Math.floor(progress.percentage / 10) * 10
                if (progress.phase !== lastLoggedPhase || progressBucket > lastLoggedProgressBucket) {
                  this.logging.debug(
                    '[SourceScannerService]',
                    `Scan progress: provider=${provider.providerType}, sourceId=${source.source_id}, libraryId=${library.id}, phase=${progress.phase}, current=${progress.current}/${progress.total}, percentage=${progress.percentage}`
                  )
                  lastLoggedPhase = progress.phase
                  lastLoggedProgressBucket = progressBucket
                }
                if (onProgress) onProgress(source.source_id, source.display_name, progress)
              }
            })
            this.logging.info(
              '[SourceScannerService]',
              `Scan finished: provider=${provider.providerType}, sourceId=${source.source_id}, libraryId=${library.id}, success=${result.success}, cancelled=${result.cancelled === true}, scanned=${result.itemsScanned}, added=${result.itemsAdded}, updated=${result.itemsUpdated}, removed=${result.itemsRemoved}, durationMs=${result.durationMs}, errors=${result.errors.length}`
            )
            if (result.errors.length > 0) {
              this.logging.warn('[SourceScannerService]', `Scan errors for sourceId=${source.source_id}, libraryId=${library.id}:`, result.errors)
            }
            if (result.success && !this.scanCancelled && result.cancelled !== true) {
              await this.db.sources.updateLibraryScanTime(source.source_id, library.id, result.itemsScanned)
              result.postScanAnalysis = await this.startPostScanTasks(source.source_id, library.id)
            }
            results.set(`${source.source_id}:${library.id}`, result)
          }
        } catch (error) {
          if (this.scanCancelled) break
          const errorMsg = error instanceof Error ? error.message : String(error)
          this.logging.error(
            '[SourceScannerService]',
            `Failed to scan source ${source.source_id}${currentLibraryId === undefined ? '' : `, library ${currentLibraryId}`}:`,
            error
          )
          results.set(`${source.source_id}:*`, {
            success: false,
            itemsScanned: 0,
            itemsAdded: 0,
            itemsUpdated: 0,
            itemsRemoved: 0,
            errors: [errorMsg],
            durationMs: 0,
          })
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

  private async startPostScanTasks(sourceId: string, libraryId: string): Promise<NonNullable<ScanResult['postScanAnalysis']>> {
    try {
      const { getSourceManager } = await import('./SourceManager')
      await getSourceManager().triggerPostScanAnalysis(sourceId, libraryId)
      return { status: 'queued' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logging.warn('[SourceScannerService]', `Scan completed, but post-scan analysis could not be queued for source ${sourceId}, library ${libraryId}: ${message}`)
      return { status: 'failed', error: message }
    }
  }
}
