/**
 * TaskQueueService - Manages background task queue for scans and analysis
 */

import { createHash, randomUUID } from 'crypto'
import { getDatabase } from '@main/database/BetterSQLiteService'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getStatsCacheService } from '@main/services/StatsCacheService'
import { getLoggingService, LoggingService } from '@main/services/LoggingService'
import { getErrorMessage, parseDatabaseError } from '@main/services/utils/errorUtils'
import { getSourceManager, SourceManager } from '@main/services/SourceManager'
import { getSeriesCompletenessService, SeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { getMovieCollectionService, MovieCollectionService } from '@main/services/MovieCollectionService'
import { getMusicBrainzService, MusicBrainzService } from '@main/services/MusicBrainzService'
import { getQualityAnalyzer, QualityAnalyzer, QualityAnalysisError } from '@main/services/QualityAnalyzer'
import { getTranscodingService, TranscodingService, TranscodeProgress } from '@main/services/TranscodingService'
import { safeSend } from '@main/ipc/utils/safeSend'
import { BrowserWindow } from 'electron'
import { 
  QueuedTask, 
  TaskType, 
  TaskStatus, 
  TaskProgress,
  AnalysisJobResult,
  AnalysisStageOutcome,
} from '@main/types/database'
import { NotificationType } from '@main/types/monitoring'
import type { AnalysisScope } from '@shared/analysisScope'
import { planAnalysisStages } from '@main/services/AnalysisTaskPlanner'
import { LibraryType } from '@main/types/database'
import type { ScanResult } from '@main/providers/base/MediaProvider'

interface CollectionProgress { current: number; total: number; percentage?: number; phase: string; currentItem?: string }

export interface TaskQueueDependencies {
  db?: BetterSQLiteService
  logging?: LoggingService
  sourceManager?: SourceManager
  seriesCompleteness?: SeriesCompletenessService
  movieCollection?: MovieCollectionService
  musicBrainz?: MusicBrainzService
  qualityAnalyzer?: QualityAnalyzer
  transcoding?: TranscodingService
}

export class TaskQueueService {
  private queue: QueuedTask[] = []
  private currentTask: QueuedTask | null = null
  private currentTaskAbortController: AbortController | null = null
  private completedTasks: QueuedTask[] = []
  private isPaused = false
  private cancelRequested = false
  private historyLimit = 100
  private stateWrite: Promise<void> = Promise.resolve()
  private submissionWrite: Promise<unknown> = Promise.resolve()

  private db: BetterSQLiteService
  private logging: LoggingService
  private sourceManager: SourceManager | null
  private seriesCompleteness: SeriesCompletenessService | null
  private movieCollection: MovieCollectionService | null
  private musicBrainz: MusicBrainzService | null
  private qualityAnalyzer: QualityAnalyzer | null
  private transcoding: TranscodingService | null
  private mainWindow: BrowserWindow | null = null

  constructor(deps: TaskQueueDependencies = {}) {
    this.db = deps.db || getDatabase()
    this.logging = deps.logging || getLoggingService()
    this.sourceManager = deps.sourceManager || null
    this.seriesCompleteness = deps.seriesCompleteness || null
    this.movieCollection = deps.movieCollection || null
    this.musicBrainz = deps.musicBrainz || null
    this.qualityAnalyzer = deps.qualityAnalyzer || null
    this.transcoding = deps.transcoding || null
  }

  private getSourceManager(): SourceManager {
    if (!this.sourceManager) this.sourceManager = getSourceManager()
    return this.sourceManager
  }

  private getSeriesCompleteness(): SeriesCompletenessService {
    if (!this.seriesCompleteness) this.seriesCompleteness = getSeriesCompletenessService()
    return this.seriesCompleteness
  }

  private getQualityAnalyzer(): QualityAnalyzer {
    if (!this.qualityAnalyzer) this.qualityAnalyzer = getQualityAnalyzer()
    return this.qualityAnalyzer
  }

  private getMovieCollection(): MovieCollectionService {
    if (!this.movieCollection) this.movieCollection = getMovieCollectionService()
    return this.movieCollection
  }

  private getMusicBrainz(): MusicBrainzService {
    if (!this.musicBrainz) this.musicBrainz = getMusicBrainzService()
    return this.musicBrainz
  }

  private getTranscoding(): TranscodingService {
    if (!this.transcoding) {
      this.transcoding = getTranscodingService()
    }
    return this.transcoding
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async loadPersistedHistory(): Promise<void> {
    await this.loadState()
  }

  async resumePersistedTasks(): Promise<void> {
    if (this.queue.length > 0 && !this.isPaused && !this.currentTask) {
      this.logging.info('[TaskQueue]', `Resuming queue with ${this.queue.length} persisted tasks`)
      await this.processQueue()
    }
  }

  private getTaskSignature(task: Pick<QueuedTask, 'type' | 'mediaItemId' | 'artistId' | 'albumId' | 'sourceId' | 'libraryId' | 'label' | 'analysisScope' | 'inputFingerprint'>): string {
    if (task.type === TaskType.Analysis && task.analysisScope) return `${task.type}:${JSON.stringify(task.analysisScope)}:${task.inputFingerprint ?? 'unversioned'}`
    if (task.mediaItemId !== undefined) return `${task.type}:media:${task.mediaItemId}`
    if (task.artistId !== undefined) return `${task.type}:artist:${task.artistId}`
    if (task.albumId !== undefined) return `${task.type}:album:${task.albumId}`
    if (task.sourceId !== undefined) return `${task.type}:source:${task.sourceId}:lib:${task.libraryId ?? 'all'}`
    return `${task.type}:label:${task.label}`
  }

  private createQueuedTask(definition: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>, createdAt = new Date().toISOString()): QueuedTask {
    return {
      ...definition,
      id: `task_${Date.now()}_${randomUUID()}`,
      status: TaskStatus.Queued,
      createdAt,
    }
  }

  /**
   * Add a new task to the queue
   */
  async addTask(definition: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>): Promise<string> {
    return this.serializeSubmission(async () => {
      const signature = this.getTaskSignature(definition)
      const existing = definition.type === TaskType.Analysis ? this.queue.find(t => this.getTaskSignature(t) === signature) ?? (this.currentTask?.type === TaskType.Analysis && this.currentTask.inputFingerprint === definition.inputFingerprint ? this.currentTask : undefined) : undefined
      if (existing) return existing.id
      if (this.queue.length >= 50) throw new Error('Task queue is at maximum capacity (50 tasks).')
      const task = this.createQueuedTask(definition)
      this.queue.push(task)
      try {
        await this.saveState(true)
      } catch (error) {
        this.queue = this.queue.filter(queued => queued.id !== task.id)
        throw error
      }
      this.notifyListeners()
      void this.processQueue()
      return task.id
    })
  }

  /**
   * Add multiple tasks to the queue at once
   */
  async addTasks(definitions: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>[]): Promise<string[]> {
    return this.serializeSubmission(async () => {
      const signatures = new Map<string, string>()
      for (const task of this.queue) if (task.type === TaskType.Analysis) signatures.set(this.getTaskSignature(task), task.id)
      if (this.currentTask?.type === TaskType.Analysis) signatures.set(this.getTaskSignature(this.currentTask), this.currentTask.id)
      const created: QueuedTask[] = []
      const ids = definitions.map(definition => {
        const signature = this.getTaskSignature(definition)
        const existingId = definition.type === TaskType.Analysis ? signatures.get(signature) : undefined
        if (existingId) return existingId
        const task = this.createQueuedTask(definition)
        created.push(task)
        signatures.set(signature, task.id)
        return task.id
      })
      if (this.queue.length + created.length > 50) throw new Error('Task queue is at maximum capacity (50 tasks).')
      if (created.length === 0) return ids
      this.queue.push(...created)
      try {
        await this.saveState(true)
      } catch (error) {
        const createdIds = new Set(created.map(task => task.id))
        this.queue = this.queue.filter(task => !createdIds.has(task.id))
        throw error
      }
      this.notifyListeners()
      void this.processQueue()
      return ids
    })
  }

  private serializeSubmission<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.submissionWrite.then(operation)
    this.submissionWrite = result.then(() => undefined, () => undefined)
    return result
  }

  async submitAnalysis(scope: AnalysisScope): Promise<string> {
    await this.validateAnalysisScope(scope)
    const inputFingerprint = await this.getAnalysisInputFingerprint(scope)
    const taskId = await this.addTask({ type: TaskType.Analysis, label: `Analyze ${scope.kind}`, analysisScope: scope, inputFingerprint })
    return taskId
  }

  private async getAnalysisInputFingerprint(scope: AnalysisScope): Promise<string> {
    let rows: Array<Record<string, unknown>>
    if (scope.kind === 'item') {
      const item = await this.db.media.getItemById(scope.mediaId)
      if (!item) throw new Error(`Media item ${scope.mediaId} was not found`)
      rows = [item as unknown as Record<string, unknown>]
    } else if (scope.kind === 'show') rows = await this.db.tvShows.getEpisodes(scope.title, scope.sourceId, scope.seriesIdentityKey, scope.libraryId) as unknown as Array<Record<string, unknown>>
    else if (scope.kind === 'album') {
      const album = await this.db.music.getAlbumById(scope.albumId)
      if (!album) throw new Error(`Album ${scope.albumId} was not found`)
      rows = [album as unknown as Record<string, unknown>, ...await this.db.music.getTracks({ albumId: scope.albumId, sourceId: album.source_id, libraryId: album.library_id }) as unknown as Array<Record<string, unknown>>]
    }
    else if (scope.kind === 'artist') {
      const artist = await this.db.music.getArtistById(scope.artistId)
      if (!artist) throw new Error(`Artist ${scope.artistId} was not found`)
      const albums = await this.db.music.getAlbums({ artistId: scope.artistId, sourceId: artist.source_id, libraryId: artist.library_id })
      const tracks = await Promise.all(albums.map(album => this.db.music.getTracks({ albumId: album.id, sourceId: artist.source_id, libraryId: artist.library_id })))
      rows = [artist as unknown as Record<string, unknown>, ...albums as unknown as Array<Record<string, unknown>>, ...tracks.flat() as unknown as Array<Record<string, unknown>>]
    } else if (scope.kind === 'collection') {
      const collection = (await this.getMovieCollection().getCollections()).find(row => row.id === scope.collectionId)
      if (!collection) throw new Error(`Collection ${scope.collectionId} was not found`)
      if (!collection.source_id || !collection.library_id) throw new Error(`Collection ${scope.collectionId} has no verified source and library ownership`)
      rows = [collection as unknown as Record<string, unknown>, ...await this.db.media.getMediaItemsForCollection(scope.collectionId) as unknown as Array<Record<string, unknown>>]
    } else {
      const sources = scope.kind === 'library' ? [await this.db.sources.getSourceById(scope.sourceId)].filter((source): source is NonNullable<typeof source> => !!source) : await this.db.sources.getEnabledSources()
      const libraryRows = await Promise.all(sources.map(async source => ({ source, libraries: await this.db.sources.getSourceLibraries(source.source_id) })))
      const selected = libraryRows.flatMap(({ source, libraries }) => libraries.filter(library => library.isEnabled === 1 && (scope.kind !== 'library' || (source.source_id === scope.sourceId && library.libraryId === scope.libraryId))).map(library => ({ sourceId: source.source_id, libraryId: library.libraryId })))
      rows = await Promise.all(selected.map(async library => {
        const [items, albums] = await Promise.all([
          this.db.media.getItems({ sourceId: library.sourceId, libraryId: library.libraryId }),
          this.db.music.getAlbums({ sourceId: library.sourceId, libraryId: library.libraryId }),
        ])
        const tracks = await Promise.all(albums.map(album => this.db.music.getTracks({ albumId: album.id, sourceId: library.sourceId, libraryId: library.libraryId })))
        return { ...library, items, albums, tracks: tracks.flat() }
      }))
      if (!rows.length) throw new Error('No enabled library exists in the requested scope')
    }
    const input = JSON.stringify(rows.map(row => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))))
    return createHash('sha256').update(input).digest('hex')
  }

  private async validateAnalysisScope(scope: AnalysisScope): Promise<void> {
    if (scope.kind === 'item' && !await this.db.media.getItemById(scope.mediaId)) throw new Error(`Media item ${scope.mediaId} was not found`)
    if (scope.kind === 'show') {
      const source = await this.db.sources.getSourceById(scope.sourceId)
      if (!source) throw new Error(`Show source ${scope.sourceId} was not found`)
      const libraries = await this.db.sources.getSourceLibraries(scope.sourceId)
      if (!libraries.some(library => library.libraryId === scope.libraryId && library.isEnabled === 1)) throw new Error(`Show library ${scope.libraryId} is not enabled for source ${scope.sourceId}`)
      if ((await this.db.tvShows.getEpisodes(scope.title, scope.sourceId, scope.seriesIdentityKey, scope.libraryId)).length === 0) throw new Error('Requested show identity owns no episodes in the selected library')
    }
    if (scope.kind === 'collection') {
      const collection = (await this.getMovieCollection().getCollections()).find(row => row.id === scope.collectionId)
      if (!collection) throw new Error(`Collection ${scope.collectionId} was not found`)
      const { source_id: sourceId, library_id: libraryId } = collection
      if (!sourceId || !libraryId) throw new Error(`Collection ${scope.collectionId} has no verified source and library ownership`)
      const source = await this.db.sources.getSourceById(sourceId)
      const libraries = await this.db.sources.getSourceLibraries(sourceId)
      if (!source?.is_enabled || !libraries.some(library => library.libraryId === libraryId && library.isEnabled === 1)) throw new Error(`Collection ${scope.collectionId} does not belong to an enabled library`)
    }
    if (scope.kind === 'album' || scope.kind === 'artist') {
      const owned = scope.kind === 'album' ? await this.db.music.getAlbumById(scope.albumId) : await this.db.music.getArtistById(scope.artistId)
      if (!owned) throw new Error(`${scope.kind === 'album' ? 'Album' : 'Artist'} ${scope.kind === 'album' ? scope.albumId : scope.artistId} was not found`)
      const source = await this.db.sources.getSourceById(owned.source_id)
      const libraries = await this.db.sources.getSourceLibraries(owned.source_id)
      if (!source?.is_enabled || !libraries.some(library => library.libraryId === owned.library_id && library.isEnabled === 1)) throw new Error(`${scope.kind} does not belong to an enabled library`)
    }
    if (scope.kind === 'library') {
      const source = await this.db.sources.getSourceById(scope.sourceId)
      if (!source || !source.is_enabled) throw new Error(`Source ${scope.sourceId} is not enabled`)
      const libraries = await this.db.sources.getSourceLibraries(scope.sourceId)
      if (!libraries.some(library => library.libraryId === scope.libraryId && library.isEnabled === 1)) throw new Error(`Library ${scope.libraryId} is not enabled for source ${scope.sourceId}`)
    }
    if (scope.kind === 'all-libraries') {
      const sources = await this.db.sources.getEnabledSources()
      const enabled = await Promise.all(sources.map(source => this.db.sources.getSourceLibraries(source.source_id)))
      if (!enabled.some(libraries => libraries.some(library => library.isEnabled === 1))) throw new Error('No enabled libraries are available for analysis')
    }
  }

  /**
   * Remove a task from the queue
   */
  async removeTask(taskId: string): Promise<boolean> {
    if (this.currentTask && this.currentTask.id === taskId) {
      await this.cancelCurrent()
      this.notifyListeners()
      return true
    }
    const index = this.queue.findIndex(t => t.id === taskId)
    if (index !== -1) {
      const task = this.queue.splice(index, 1)[0]
      task.status = TaskStatus.Cancelled
      task.completedAt = new Date().toISOString()
      this.completedTasks.unshift(task)
      if (this.completedTasks.length > this.historyLimit) this.completedTasks.pop()
      if (task.type === TaskType.Transcode) await this.getTranscoding().discardTaskSamples(task)
      this.logging.info('[TaskQueue]', `Task removed: ${task.label} (${task.id})`)
      try {
        await this.saveState(true)
      } catch (error) {
        this.queue.splice(index, 0, task)
        this.completedTasks = this.completedTasks.filter(completed => completed.id !== task.id)
        throw error
      }
      this.notifyListeners()
      return true
    }
    return false
  }

  async removeTasksForSource(sourceId: string): Promise<void> {
    const originalCount = this.queue.length
    this.queue = this.queue.filter(t => t.sourceId !== sourceId)
    const cancelledCurrent = this.currentTask?.sourceId === sourceId
    if (cancelledCurrent) {
      await this.cancelCurrent()
    }
    if (this.queue.length !== originalCount || cancelledCurrent) {
      this.logging.info('[TaskQueue]', `Removed ${originalCount - this.queue.length} tasks for source ${sourceId}`)
      await this.saveState()
      this.notifyListeners()
    }
  }

  /**
   * Reorder tasks in the queue
   */
  async reorderQueue(taskIds: string[]): Promise<void> {
    const newQueue: QueuedTask[] = []
    for (const id of taskIds) {
      const task = this.queue.find(t => t.id === id)
      if (task) newQueue.push(task)
    }
    // Add any tasks that weren't in the ID list (safety)
    for (const task of this.queue) {
      if (!taskIds.includes(task.id)) newQueue.push(task)
    }
    this.queue = newQueue
    await this.saveState()
    this.notifyListeners()
  }

  /**
   * Clear the entire queue
   */
  async clearQueue(batchId?: string): Promise<void> {
    const count = this.queue.length
    const removed = this.queue.filter(task => !batchId || task.batchId === batchId)
    this.queue = this.queue.filter(task => batchId && task.batchId !== batchId)
    if (this.currentTask && (!batchId || this.currentTask.batchId === batchId)) await this.cancelCurrent()
    for (const task of removed) if (task.type === TaskType.Transcode) await this.getTranscoding().discardTaskSamples(task)
    for (const task of removed) if (task.type === TaskType.Transcode && task.batchId !== this.currentTask?.batchId) await this.getTranscoding().discardBatchSamples(task)
    if (!batchId) this.getTranscoding().abortAll()
    this.logging.info('[TaskQueue]', `Queue cleared (${count} tasks removed)`)
    await this.saveState()
    this.notifyListeners()
  }

  /**
   * Pause queue processing
   */
  async pause(): Promise<void> {
    this.isPaused = true
    this.logging.info('[TaskQueue]', 'Queue paused')
    await this.saveState()
    this.notifyListeners()
  }

  pauseQueue(): Promise<void> { return this.pause() }

  /**
   * Resume queue processing
   */
  async resume(): Promise<void> {
    this.isPaused = false
    this.logging.info('[TaskQueue]', 'Queue resumed')
    await this.saveState()
    this.notifyListeners()
    void this.processQueue()
  }

  resumeQueue(): Promise<void> { return this.resume() }

  /**
   * Cancel the currently running task
   */
  async cancelCurrent(): Promise<void> {
    if (this.currentTask) {
      this.cancelRequested = true
      this.currentTaskAbortController?.abort()
      this.currentTask.status = TaskStatus.Cancelling
      this.logging.info('[TaskQueue]', `Cancellation requested for task: ${this.currentTask.label}`)
      if (this.currentTask.type === TaskType.SeriesCompleteness || this.currentTask.type === TaskType.Analysis) {
        this.getSeriesCompleteness().cancel()
      }
      if (this.currentTask.type === TaskType.CollectionCompleteness || this.currentTask.type === TaskType.Analysis) this.getMovieCollection().cancel()
      if (this.currentTask.type === TaskType.MusicCompleteness || this.currentTask.type === TaskType.Analysis) this.getMusicBrainz().cancel()
      if (this.currentTask.type === TaskType.Transcode && this.currentTask.mediaItemId) {
        this.getTranscoding().cancelTranscode(this.currentTask.mediaItemId)
      }
      if (this.currentTask.type === TaskType.LibraryScan ||
        this.currentTask.type === TaskType.SourceScan ||
        this.currentTask.type === TaskType.MusicScan) {
        this.getSourceManager().stopScan()
      }
      await this.saveState()
    }
  }

  async cancelCurrentTask(batchId?: string): Promise<void> {
    if (batchId && this.currentTask?.batchId !== batchId) return
    await this.cancelCurrent()
    this.notifyListeners()
  }

  /**
   * Get the current state of the queue
   */
  getState() {
    return {
      currentTask: this.currentTask,
      queue: this.queue,
      completedTasks: this.completedTasks,
      isPaused: this.isPaused,
    }
  }

  getQueueState() { return this.getState() }

  getTasks(): QueuedTask[] {
    return [...this.queue, ...(this.currentTask ? [this.currentTask] : []), ...this.completedTasks]
  }

  getTaskHistory(): QueuedTask[] { return this.completedTasks }
  getMonitoringHistory(): unknown[] { return [] }
  async clearTaskHistory(): Promise<void> { this.completedTasks = []; await this.saveState(); this.notifyListeners() }
  clearMonitoringHistory(): void { }

  async persistInterruptedTasks(): Promise<void> {
    if (this.currentTask && this.currentTask.status === TaskStatus.Running) {
      this.currentTask.status = TaskStatus.Queued
      this.queue.unshift(this.currentTask)
      this.currentTask = null
    }
    await this.saveState()
  }

  // --- Internal Methods ---

  private async processQueue(): Promise<void> {
    if (this.currentTask) {
      this.logging.info('[TaskQueue]', 'processQueue: Task already running, skipping')
      return
    }
    if (this.isPaused) {
      this.logging.info('[TaskQueue]', 'processQueue: Queue is paused, skipping')
      return
    }
    if (this.queue.length === 0) {
      return
    }

    this.currentTask = this.queue.shift() || null
    if (!this.currentTask) return
    this.currentTaskAbortController = new AbortController()

    this.currentTask.status = TaskStatus.Running
    this.currentTask.startedAt = new Date().toISOString()
    this.cancelRequested = false
    
    this.logging.info('[TaskQueue]', `Starting task: ${this.currentTask.label} (${this.currentTask.id})`)
    await this.saveState()
    this.notifyListeners()

    const task = this.currentTask
    let lastProgressWriteStartedAt = 0
    const PROGRESS_THROTTLE_MS = 250 // Max 4 UI updates per second
    let progressWrite: Promise<void> | null = null
    let progressWritePending = false
    let forceProgressWrite = false
    let progressWriteTimer: ReturnType<typeof setTimeout> | null = null

    const startProgressWrite = (): void => {
      if (progressWrite) {
        progressWritePending = true
        return
      }

      progressWritePending = false
      forceProgressWrite = false
      lastProgressWriteStartedAt = Date.now()
      progressWrite = this.saveState()
        .then(() => this.notifyListeners())
        .finally(() => {
          progressWrite = null
          if (progressWritePending) scheduleProgressWrite(forceProgressWrite)
        })
    }

    const scheduleProgressWrite = (force: boolean): void => {
      progressWritePending = true
      forceProgressWrite ||= force
      if (progressWrite) return

      const delay = forceProgressWrite ? 0 : Math.max(0, PROGRESS_THROTTLE_MS - (Date.now() - lastProgressWriteStartedAt))
      if (progressWriteTimer) {
        if (delay > 0) return
        clearTimeout(progressWriteTimer)
      }
      progressWriteTimer = setTimeout(() => {
        progressWriteTimer = null
        startProgressWrite()
      }, delay)
    }

    const flushProgressWrite = async (): Promise<void> => {
      if (progressWriteTimer) {
        clearTimeout(progressWriteTimer)
        progressWriteTimer = null
      }
      progressWritePending = true
      forceProgressWrite = true
      while (progressWrite || progressWritePending) {
        if (!progressWrite) {
          if (progressWriteTimer) {
            clearTimeout(progressWriteTimer)
            progressWriteTimer = null
          }
          startProgressWrite()
        }
        await progressWrite
      }
    }

    const onProgress = (p: TaskProgress) => {
      task.progress = p
      const terminal = p.percentage === 100 || p.phase === 'complete' || p.phase === 'failed'
      scheduleProgressWrite(terminal)
    }

    try {
      switch (task.type) {
        case TaskType.LibraryScan:
        case TaskType.MusicScan:
          await this.executeLibraryScan(task, onProgress)
          break
        case TaskType.SourceScan:
          await this.executeSourceScan(task, onProgress)
          break
        case TaskType.SeriesCompleteness:
          await this.executeSeriesCompleteness(task, onProgress, undefined, true)
          break
        case TaskType.CollectionCompleteness:
          await this.executeCollectionCompleteness(task, onProgress)
          break
        case TaskType.MusicCompleteness:
          await this.executeMusicCompleteness(task, onProgress, true)
          break
        case TaskType.QualityAnalysis:
          await this.executeQualityAnalysis(task, onProgress)
          break
        case TaskType.Analysis:
          await this.executeAnalysis(task, onProgress)
          break
        case TaskType.Transcode:
          await this.executeTranscode(task, onProgress)
          break
        default:
          throw new Error(`Unknown task type: ${task.type}`)
      }

      if (this.cancelRequested || task.result?.status === 'cancelled') {
        task.status = TaskStatus.Cancelled
        this.logging.info('[TaskQueue]', `Task cancelled: ${task.label}`)
      } else if (task.result?.status === 'partial' || task.result?.status === 'deferred') {
        task.status = TaskStatus.Partial
        task.error ??= 'Analysis completed with required work deferred or failed'
      } else if (task.result?.status === 'failed' && task.type === TaskType.Analysis) {
        task.status = TaskStatus.Failed
        task.error = task.error || 'All required analysis stages failed'
      } else if (task.result?.status === 'blocked' && task.type === TaskType.Analysis) {
        task.status = TaskStatus.Blocked
        task.error = task.error || 'Analysis was blocked before useful work could complete'
      } else {
        task.status = TaskStatus.Completed
        this.logging.info('[TaskQueue]', `Task completed: ${task.label}`)
      }
    } catch (error) {
      if (this.cancelRequested) {
        task.status = TaskStatus.Cancelled
        task.result = { ...task.result, status: 'cancelled' }
        this.logging.info('[TaskQueue]', `Task cancelled: ${task.label}`)
      } else {
        const errorMsg = getErrorMessage(error)
        task.status = TaskStatus.Failed
        task.error = errorMsg
        if (error instanceof QualityAnalysisError) {
          task.result = {
            ...task.result,
            status: 'partial',
            itemsScanned: error.details.analyzedCount,
            totalCount: error.details.totalCount,
            failedCount: error.details.totalCount - error.details.analyzedCount,
            failedItemId: error.details.mediaItemId,
            failedItemIndex: error.details.itemIndex,
            failedStage: error.details.stage,
          }
        }
        this.logging.error('[TaskQueue]', `Task failed: ${task.label}`, error)

        try {
          await this.db.notifications.addNotification({
            type: NotificationType.Error,
            title: 'Task failed',
            message: `${task.label}: ${errorMsg}`,
            reference_id: task.sourceId,
          })
        } catch (e) {
          getLoggingService().error('[TaskQueueService]', 'Failed to dispatch notification:', e)
        }
      }
    } finally {
      await flushProgressWrite()
      if (task.type === TaskType.Analysis && task.result?.analysis && task.status !== TaskStatus.Cancelled && task.status !== TaskStatus.Failed) {
        const result = task.result.analysis
        const message = [
          `${result.completedCount} stages complete`,
          `${result.failedCount} failed`,
          `${result.deferredCount} deferred`,
          `${result.skippedCount} skipped`,
          ...(result.reconciliation ? [`Summary cleanup: ${result.reconciliation.merged} merged, ${result.reconciliation.removed} removed, ${result.reconciliation.preservedLocked} locked preserved, ${result.reconciliation.ambiguous} ambiguous`] : []),
          ...result.diagnostics.slice(0, 3).map(diagnostic => `${diagnostic.itemName}: ${diagnostic.message}`),
        ].join(' · ')
        try {
          await this.db.notifications.addNotification({
            type: task.status === TaskStatus.Completed ? NotificationType.ScanComplete : NotificationType.Info,
            title: `${task.label} · Analysis ${result.status}`,
            message,
            reference_id: task.sourceId,
          })
        } catch (error) {
          this.logging.error('[TaskQueue]', 'Could not persist analysis outcome notification', error)
        }
      }
      task.completedAt = new Date().toISOString()
      this.completedTasks.unshift(task)
      if (this.completedTasks.length > this.historyLimit) {
        this.completedTasks.pop()
      }
      
      const prevTask = task
      this.currentTask = null
      this.currentTaskAbortController = null
      if (prevTask.type === TaskType.Transcode && !this.queue.some(queued => queued.batchId === prevTask.batchId)) {
        await this.getTranscoding().discardBatchSamples(prevTask)
      }
      await this.saveState()
      this.notifyListeners()
      
      // Emit completion event for UI sounds/effects
      if ((prevTask.status === TaskStatus.Completed || prevTask.status === TaskStatus.Partial || prevTask.status === TaskStatus.Blocked || prevTask.status === TaskStatus.Failed || prevTask.status === TaskStatus.Cancelled) && this.mainWindow) {
        getStatsCacheService().invalidate()
        safeSend(this.mainWindow, 'library:updated', { type: 'media', sourceId: prevTask.sourceId })
        safeSend(this.mainWindow, 'taskQueue:taskComplete', prevTask)

        // Special case: Scan tasks should also emit scan:completed
        if (prevTask.type === TaskType.LibraryScan || prevTask.type === TaskType.SourceScan || prevTask.type === TaskType.MusicScan) {
          const res = prevTask.result
          if (res) {
            safeSend(this.mainWindow, 'scan:completed', {
              sourceId: prevTask.sourceId,
              libraryId: prevTask.libraryId,
              libraryName: prevTask.label.replace('Scan ', ''),
              itemsScanned: res.itemsScanned || 0,
              itemsAdded: res.itemsAdded || 0,
              itemsUpdated: res.itemsUpdated || 0,
              isFirstScan: false
            })
          }
        }
      }

      // Small delay before next task
      setTimeout(() => this.processQueue(), 500)
    }
  }

  private async executeLibraryScan(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.sourceId || !task.libraryId) throw new Error('Missing sourceId or libraryId')
    const manager = this.getSourceManager()
    const result = await manager.scanLibrary(task.sourceId, task.libraryId, onProgress)
    await this.recordScanResults(task, [result])
  }

  private async recordScanResults(task: QueuedTask, results: ScanResult[]): Promise<void> {
    const failures = results.flatMap(result => result.postScanAnalysis?.status === 'failed'
      ? [result.postScanAnalysis.error]
      : [])
    task.result = {
      itemsScanned: results.reduce((total, result) => total + result.itemsScanned, 0),
      itemsAdded: results.reduce((total, result) => total + result.itemsAdded, 0),
      itemsUpdated: results.reduce((total, result) => total + result.itemsUpdated, 0),
      itemsRemoved: results.reduce((total, result) => total + result.itemsRemoved, 0),
      status: failures.length ? 'partial' : 'completed',
      ...(results.some(result => result.postScanAnalysis) ? {
        postScanAnalysis: failures.length ? { status: 'failed', errors: failures } : { status: 'queued' },
      } : {}),
    }
    if (failures.length) {
      task.error = `Scan completed, but post-scan analysis could not be queued: ${failures.join('; ')}`
      try {
        await this.db.notifications.addNotification({
          type: NotificationType.Info,
          title: 'Scan completed; analysis not queued',
          message: task.error,
          reference_id: task.sourceId,
        })
      } catch (error) {
        this.logging.error('[TaskQueue]', 'Could not notify about post-scan analysis scheduling failure', error)
      }
    }
  }

  private async executeSourceScan(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.sourceId) throw new Error('Missing sourceId')
    const manager = this.getSourceManager()
    const results = await manager.scanSource(task.sourceId, onProgress)
    await this.recordScanResults(task, results)
  }

  private async executeSeriesCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void, existingBackupPath: string | undefined, notifyOutcome: boolean): Promise<void> {
    const service = this.getSeriesCompleteness()
    const outcome = await service.analyzeAllSeries(task.sourceId, task.libraryId, onProgress, task.seriesIdentityKey && task.seriesTitle ? { title: task.seriesTitle, seriesIdentityKey: task.seriesIdentityKey } : undefined, existingBackupPath, this.currentTaskAbortController?.signal)

    task.result = {
      itemsScanned: outcome.processedCount,
      totalSeries: outcome.totalCount,
      analyzedSeries: outcome.processedCount,
      failedSeries: outcome.diagnostics.map(d => d.message),
      status: outcome.status,
      diagnostics: outcome.diagnostics,
      outcome,
      ...(outcome.reconciliation ? {
        reconciliation: outcome.reconciliation,
        databaseBackupPath: outcome.databaseBackupPath,
      } : {}),
    }

    if (outcome.status === 'failed' && !this.cancelRequested) {
      const firstError = outcome.diagnostics[0]?.message
      if (!firstError) {
        throw new Error('Series analysis failed: diagnostic message missing')
      }
      throw new Error(`Series analysis failed: ${firstError}`)
    }
    if ((outcome.status === 'partial' || outcome.status === 'deferred') && !this.cancelRequested) {
      const summary = `Series analysis partially completed: ${outcome.processedCount}/${outcome.totalCount} analyzed; ${outcome.diagnostics.length} failed`
      this.logging.warn('[TaskQueue]', summary, { totalCount: outcome.totalCount, processedCount: outcome.processedCount, diagnostics: outcome.diagnostics })
      if (notifyOutcome) await this.db.notifications.addNotification({
        type: 'info',
        title: 'Series analysis partially completed',
        message: summary,
        reference_id: task.sourceId,
      })
    } else if (outcome.status === 'completed' && !this.cancelRequested) {
      if (notifyOutcome) await this.db.notifications.addNotification({
        type: 'scan_complete',
        title: 'Series analysis completed',
        message: `Series analysis completed: ${outcome.processedCount} analyzed`,
        reference_id: task.sourceId,
      })
    }
  }

  private async executeCollectionCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    const service = this.getMovieCollection()
    if (task.collectionId !== undefined) {
      if (!await this.db.config.getSetting('tmdb_api_key')) throw new Error('TMDB configuration is required for collection completeness analysis')
      const collection = (await service.getCollections(task.sourceId)).find(row => row.id === task.collectionId && row.library_id === task.libraryId)
      if (!collection) throw new Error(`Collection ${task.collectionId} no longer belongs to the requested library`)
      const result = await service.analyzeCollection(collection.collection_name, collection.source_id, collection.library_id, collection.tmdb_collection_id)
      if (!result) throw new Error(`Collection ${collection.collection_name} completeness was deferred because TMDB returned no result`)
      task.result = { ...task.result, status: 'completed', itemsScanned: 1, completedCount: 1, failedCount: 0, deferredCount: 0 }
      return
    }
    const result = await service.analyzeAllCollections(task.sourceId, task.libraryId, (prog: CollectionProgress) => {
      onProgress({
        current: prog.current,
        total: prog.total,
        percentage: prog.percentage || Math.round((prog.current / prog.total) * 100) || 0,
        phase: prog.phase,
        currentItem: prog.currentItem
      })
    }, this.currentTaskAbortController?.signal)
    if (result.skipped) throw new Error('TMDB configuration is required for collection completeness analysis')

    task.result = {
      itemsScanned: result.analyzed,
      totalCount: result.total,
      completeCount: result.complete,
      failedCount: result.errors.length,
      errors: result.errors,
      status: !result.completed ? 'cancelled' : result.errors.length ? 'partial' : 'completed',
    }
  }

  private async executeMusicCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void, notifyOutcome: boolean): Promise<void> {
    const service = this.getMusicBrainz()
    const db = this.db
    
    if (task.artistId === undefined && task.albumId === undefined) {
      const outcome = await service.analyzeAllMusic(
        (prog: TaskProgress) => {
          onProgress({
            current: prog.current,
            total: prog.total,
            percentage: Math.round(prog.percentage),
            phase: prog.phase || 'processing',
            currentItem: prog.currentItem
          })
        },
        task.sourceId,
        { libraryId: task.libraryId, artistId: task.artistId },
        this.currentTaskAbortController?.signal,
      )
      if (outcome.completedCount === undefined || outcome.failedCount === undefined) {
        throw new Error('Music analysis returned incomplete outcome counts')
      }
      const completedCount = outcome.completedCount
      const failedCount = outcome.failedCount
      const totalCount = completedCount + failedCount + outcome.deferredCount + outcome.skipped

      task.result = {
        itemsScanned: completedCount,
        status: outcome.status,
        deferred: outcome.deferredCount,
        errors: outcome.diagnostics.map(d => d.message),
        diagnostics: outcome.diagnostics,
        outcome,
      }

      if (outcome.status === 'failed' && !this.cancelRequested) {
        const firstError = outcome.diagnostics[0]?.message
        if (!firstError) {
          throw new Error('Music analysis failed: diagnostic message missing')
        }
        throw new Error(`Music analysis failed: ${firstError}`)
      }
      if ((outcome.status === 'partial' || outcome.status === 'deferred') && !this.cancelRequested) {
        const summary = `Music analysis ${outcome.status}: ${completedCount}/${totalCount} analyzed; ${outcome.deferredCount} deferred; ${outcome.diagnostics.length} issues`
        this.logging.warn('[TaskQueue]', summary, { totalCount, completedCount, deferredCount: outcome.deferredCount })
        if (notifyOutcome) await db.notifications.addNotification({
          type: 'info',
          title: `Music analysis ${outcome.status}`,
          message: summary,
          reference_id: task.sourceId,
        })
      } else if (outcome.status === 'completed' && !this.cancelRequested) {
        if (notifyOutcome) await db.notifications.addNotification({
          type: 'scan_complete',
          title: 'Music analysis completed',
          message: `Music analysis completed: ${completedCount} analyzed`,
          reference_id: task.sourceId,
        })
      }
        return
      }

    if (task.albumId !== undefined) {
      const album = await db.music.getAlbumById(task.albumId)
      if (!album) throw new Error(`Album not found: ${task.albumId}`)
      const tracks = await db.music.getTracks({ albumId: task.albumId, sourceId: album.source_id, libraryId: album.library_id })
      const result = await service.analyzeAlbumTrackCompleteness(task.albumId, album.artist_name, album.title, album.musicbrainz_release_group_id || album.musicbrainz_id || undefined, tracks.map(track => track.title))
      if (result) await db.music.upsertAlbumCompleteness(result)
      task.result = { itemsScanned: tracks.length, status: result ? 'completed' : 'deferred', deferred: result ? 0 : 1 }
      return
    }

    if (task.artistId === undefined) throw new Error('Music task requires an artist, album, or library scope')
    const artist = await db.music.getArtistById(task.artistId)
    if (!artist) throw new Error(`Artist not found: ${task.artistId}`)
    const albumOutcome = await service.analyzeAllMusic(prog => onProgress(prog), artist.source_id, { libraryId: artist.library_id, artistId: artist.id, skipRecentlyAnalyzed: false })
    if (albumOutcome.status !== 'completed') {
      task.result = { itemsScanned: albumOutcome.completedCount, status: albumOutcome.status, completedCount: albumOutcome.completedCount, failedCount: albumOutcome.failedCount, deferredCount: albumOutcome.deferredCount, diagnostics: albumOutcome.diagnostics, outcome: albumOutcome }
      if (albumOutcome.status !== 'cancelled') throw new Error(`Owned album completeness ${albumOutcome.status}`)
      return
    }
    const albums = await db.music.getAlbums({ artistId: task.artistId, sourceId: artist.source_id, libraryId: artist.library_id })
    const ownedAlbumTitles = albums.map(a => a.title)
    const ownedAlbumMbIds = albums.map(a => a.musicbrainz_id).filter((id): id is string => !!id)

    const result = await service.analyzeArtistCompleteness(
      artist.name,
      artist.musicbrainz_id || undefined,
      ownedAlbumTitles,
      ownedAlbumMbIds
    )

    if (this.cancelRequested) {
      task.result = { itemsScanned: 0, status: 'cancelled', completedCount: 0, failedCount: 0, deferredCount: albums.length, skippedCount: 0 }
      return
    }
    await db.music.upsertArtistCompleteness({ ...result, artist_name: artist.name, library_id: artist.library_id })
    task.result = { itemsScanned: result.total_albums, status: 'completed' }

    // Set progress to complete
    onProgress({
      current: 1,
      total: 1,
      percentage: 100,
      phase: 'complete',
      currentItem: artist.name
    })
  }

  private async executeQualityAnalysis(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (task.options && typeof task.options === 'object' && 'domain' in task.options && task.options.domain === 'music-quality') {
      const albums = await this.db.music.getAlbums({ sourceId: task.sourceId, libraryId: task.libraryId })
      const scores = await Promise.all(albums.map(async album => this.getQualityAnalyzer().analyzeMusicAlbum(album, await this.db.music.getTracks({ albumId: album.id, sourceId: task.sourceId, libraryId: task.libraryId }))))
      await this.db.music.upsertQualityScores(scores)
      onProgress({ current: albums.length, total: albums.length, percentage: 100, phase: 'complete' })
      return
    }
    await this.getQualityAnalyzer().analyzeAllMediaItems((current, total) => {
      if (this.mainWindow) safeSend(this.mainWindow, 'quality:analysisProgress', { current, total })
      onProgress({
        current,
        total,
        percentage: total > 0 ? Math.round((current / total) * 100) : 100,
        phase: current >= total ? 'complete' : 'analyzing',
      })
    }, () => this.cancelRequested, task.sourceId, task.libraryId, this.currentTaskAbortController?.signal)
  }

  async cancelTask(taskId: string): Promise<boolean> { return this.removeTask(taskId) }

  private async executeAnalysis(task: QueuedTask, onProgress: (progress: TaskProgress) => void): Promise<void> {
    const scope = task.analysisScope
    if (!scope) throw new Error('Analysis task is missing its persisted scope')
    await this.validateAnalysisScope(scope)
    const outcomes: AnalysisStageOutcome[] = []
    let persistenceFailure: Error | null = null
    let databaseBackupPath: string | undefined
    const reconciliation = { merged: 0, removed: 0, preservedLocked: 0, ambiguous: 0 }
    const stages: Array<{ name: string; execute: () => Promise<void> }> = []
    const quality = (sourceId?: string, libraryId?: string, series?: { title: string; seriesIdentityKey: string }, mediaItemId?: number, collectionId?: number) => stages.push({ name: 'quality', execute: async () => {
      if (mediaItemId !== undefined) {
        const item = await this.db.media.getItemById(mediaItemId)
        if (!item?.file_path) throw new Error(`Media item ${mediaItemId} has no local file path`)
        const source = item.source_id ? await this.db.sources.getSourceById(item.source_id) : null
        const stillOwned = await this.db.media.getItemById(mediaItemId)
        if (!source || !stillOwned || stillOwned.file_path !== item.file_path || stillOwned.source_id !== item.source_id || stillOwned.library_id !== item.library_id) throw new Error(`Media item ${mediaItemId} ownership changed before analysis`)
        const { qualityScore } = await this.getQualityAnalyzer().analyzeMediaItemFileEvidence(item, this.currentTaskAbortController?.signal)
        const stillOwnedAfterAnalysis = await this.db.media.getItemById(mediaItemId)
        if (!stillOwnedAfterAnalysis || stillOwnedAfterAnalysis.file_path !== item.file_path || stillOwnedAfterAnalysis.source_id !== item.source_id || stillOwnedAfterAnalysis.library_id !== item.library_id) throw new Error(`Media item ${mediaItemId} ownership changed during analysis`)
        await this.db.media.upsertQualityScore(qualityScore)
        task.result = { ...task.result, itemsScanned: 1 }
        return
      }
      if (collectionId !== undefined) {
        const collection = (await this.getMovieCollection().getCollections()).find(row => row.id === collectionId)
        if (!collection || collection.source_id !== sourceId || collection.library_id !== libraryId) throw new Error(`Collection ${collectionId} ownership changed before quality analysis`)
        const items = await this.db.media.getMediaItemsForCollection(collectionId)
        let analyzed = 0
        for (const item of items) {
          if (this.cancelRequested) throw new Error('Collection quality analysis was cancelled')
          if (!item.file_path) continue
          const { qualityScore } = await this.getQualityAnalyzer().analyzeMediaItemFileEvidence(item, this.currentTaskAbortController?.signal)
          const owner = await this.db.media.getItemById(item.id!)
          if (!owner || owner.source_id !== sourceId || owner.library_id !== libraryId || owner.file_path !== item.file_path) throw new Error(`Collection member ${item.id} ownership changed during analysis`)
          await this.db.media.upsertQualityScore(qualityScore)
          analyzed++
        }
        task.result = { ...task.result, itemsScanned: analyzed }
        return
      }
      const count = await this.getQualityAnalyzer().analyzeAllMediaItems(undefined, () => this.cancelRequested, sourceId, libraryId, this.currentTaskAbortController?.signal, series)
      if (this.cancelRequested) throw new Error('Quality analysis was cancelled')
      task.result = { ...task.result, itemsScanned: count }
    } })
    const series = (sourceId?: string, libraryId?: string, identity?: { title: string; seriesIdentityKey: string }) => stages.push({ name: 'series-completeness', execute: async () => {
      const seriesTask = { ...task, type: TaskType.SeriesCompleteness, sourceId, libraryId, ...(identity ? { seriesTitle: identity.title, seriesIdentityKey: identity.seriesIdentityKey } : {}) }
      await this.executeSeriesCompleteness(seriesTask, onProgress, databaseBackupPath, false)
      task.result = seriesTask.result
    } })
    const collections = (sourceId?: string, libraryId?: string) => stages.push({ name: 'collection-completeness', execute: async () => {
      await this.executeCollectionCompleteness({ ...task, type: TaskType.CollectionCompleteness, sourceId, libraryId }, onProgress)
      if (task.result?.status === 'cancelled') throw new Error('Collection completeness was cancelled')
    } })
    const music = (sourceId?: string, libraryId?: string, albumId?: number) => stages.push({ name: 'music-completeness', execute: async () => {
      await this.executeMusicCompleteness({ ...task, type: TaskType.MusicCompleteness, sourceId, libraryId, albumId }, onProgress, false)
    } })
    const artistCompleteness = (artistId: number) => stages.push({ name: 'artist-completeness', execute: async () => {
      const artist = await this.db.music.getArtistById(artistId)
      if (!artist) throw new Error(`Artist ${artistId} was not found`)
      const albums = await this.db.music.getAlbums({ artistId, sourceId: artist.source_id, libraryId: artist.library_id })
      const titles = albums.map(album => album.title)
      const mbids = albums.map(album => album.musicbrainz_release_group_id || album.musicbrainz_id).filter((id): id is string => !!id)
      const result = await this.getMusicBrainz().analyzeArtistCompleteness(artist.name, artist.musicbrainz_id || undefined, titles, mbids)
      if (this.cancelRequested) throw new Error('Artist discography analysis was cancelled')
      const verified = await this.db.music.getArtistById(artistId)
      if (!verified || verified.source_id !== artist.source_id || verified.library_id !== artist.library_id) throw new Error(`Artist ${artistId} ownership changed before completeness persistence`)
      await this.db.music.upsertArtistCompleteness({ ...result, artist_name: artist.name, artist_id: artist.id, source_id: artist.source_id, library_id: artist.library_id })
    } })
    const ownedAlbumCompleteness = (artistId: number) => stages.push({ name: 'owned-album-completeness', execute: async () => {
      const artist = await this.db.music.getArtistById(artistId)
      if (!artist) throw new Error(`Artist ${artistId} was not found`)
      const albums = await this.db.music.getAlbums({ artistId, sourceId: artist.source_id, libraryId: artist.library_id })
      for (const album of albums) {
        if (this.cancelRequested) throw new Error('Owned album completeness was cancelled')
        const owned = await this.db.music.getAlbumById(album.id!)
        if (!owned || owned.source_id !== artist.source_id || owned.library_id !== artist.library_id || owned.artist_id !== artistId) throw new Error(`Album ${album.id} ownership changed before completeness analysis`)
        const tracks = await this.db.music.getTracks({ albumId: album.id, sourceId: artist.source_id, libraryId: artist.library_id })
        const result = await this.getMusicBrainz().analyzeAlbumTrackCompleteness(album.id!, album.artist_name, album.title, album.musicbrainz_release_group_id || album.musicbrainz_id || undefined, tracks.map(track => track.title))
        if (this.cancelRequested) throw new Error('Owned album completeness was cancelled')
        if (result) await this.db.music.upsertAlbumCompleteness(result)
      }
    } })
    const musicQuality = (sourceId: string, libraryId: string, artistId?: number, albumId?: number) => stages.push({ name: 'music-quality', execute: async () => {
      if (this.cancelRequested) throw new Error('Music quality analysis cancelled')
      const albums = albumId === undefined ? await this.db.music.getAlbums({ sourceId, libraryId, artistId }) : [await this.db.music.getAlbumById(albumId)].filter((album): album is NonNullable<typeof album> => album !== null)
      const scores = []
      for (const album of albums) {
        if (this.cancelRequested) throw new Error('Music quality analysis cancelled')
        const tracks = await this.db.music.getTracks({ albumId: album.id, sourceId, libraryId })
        scores.push(await this.getQualityAnalyzer().analyzeMusicAlbum(album, tracks))
      }
      if (this.cancelRequested) throw new Error('Music quality analysis cancelled')
      await this.db.music.upsertQualityScores(scores)
    } })
    let ownedScope: { sourceId?: string; libraryId?: string; mediaItemId?: number; artistId?: number; albumId?: number; collectionId?: number; series?: { title: string; seriesIdentityKey: string } } = {}
    let libraryScopes: Array<{ sourceId: string; libraryId: string; libraryType: LibraryType }> = []
      if (scope.kind === 'item') {
      const item = await this.db.media.getItemById(scope.mediaId)
      if (!item) throw new Error(`Media item ${scope.mediaId} was not found`)
      ownedScope = { mediaItemId: scope.mediaId, sourceId: item.source_id, libraryId: item.library_id }
    } else if (scope.kind === 'show') {
      const episodes = await this.db.tvShows.getEpisodes(scope.title, scope.sourceId, scope.seriesIdentityKey, scope.libraryId)
      if (!episodes.length) throw new Error('Requested show identity owns no episodes in the selected library')
      ownedScope = { sourceId: scope.sourceId, libraryId: scope.libraryId, series: { title: scope.title, seriesIdentityKey: scope.seriesIdentityKey } }
    } else if (scope.kind === 'collection') {
      const collection = (await this.getMovieCollection().getCollections()).find(row => row.id === scope.collectionId)
      if (!collection) throw new Error(`Collection ${scope.collectionId} was not found`)
      ownedScope = { sourceId: collection.source_id, libraryId: collection.library_id, collectionId: collection.id }
    } else if (scope.kind === 'album') {
      const album = await this.db.music.getAlbumById(scope.albumId)
      if (!album) throw new Error(`Album ${scope.albumId} was not found`)
      ownedScope = { sourceId: album.source_id, libraryId: album.library_id, albumId: album.id }
    } else if (scope.kind === 'artist') {
      const artist = await this.db.music.getArtistById(scope.artistId)
      if (!artist) throw new Error(`Artist ${scope.artistId} was not found`)
      ownedScope = { sourceId: artist.source_id, libraryId: artist.library_id, artistId: artist.id }
    } else {
      const sources = scope.kind === 'library' ? [await this.db.sources.getSourceById(scope.sourceId)].filter((source): source is NonNullable<typeof source> => source !== null) : await this.db.sources.getEnabledSources()
      libraryScopes = (await Promise.all(sources.map(async source => ({ source, rows: await this.db.sources.getSourceLibraries(source.source_id) }))))
        .flatMap(({ source, rows }) => rows.filter(row => row.isEnabled === 1).map(row => ({ sourceId: source.source_id, libraryId: row.libraryId, libraryType: row.libraryType as LibraryType })))
        .filter(row => scope.kind !== 'library' || (row.sourceId === scope.sourceId && row.libraryId === scope.libraryId))
      if (!libraryScopes.length) throw new Error('No enabled library exists in the requested scope')
    }
    for (const definition of planAnalysisStages(scope, libraryScopes)) {
      const sourceId = definition.sourceId ?? ownedScope.sourceId
      const libraryId = definition.libraryId ?? ownedScope.libraryId
      switch (definition.name) {
        case 'quality': quality(sourceId, libraryId, definition.series ?? ownedScope.series, definition.mediaItemId ?? ownedScope.mediaItemId, definition.collectionId ?? ownedScope.collectionId); break
        case 'series-completeness': series(sourceId, libraryId, definition.series ?? ownedScope.series); break
        case 'collection-completeness':
          if (definition.collectionId !== undefined || ownedScope.collectionId !== undefined) stages.push({ name: definition.name, execute: () => this.executeCollectionCompleteness({ ...task, type: TaskType.CollectionCompleteness, sourceId, libraryId, collectionId: definition.collectionId ?? ownedScope.collectionId }, onProgress) })
          else collections(sourceId, libraryId)
          break
        case 'music-quality': musicQuality(sourceId!, libraryId!, definition.artistId ?? ownedScope.artistId, definition.albumId ?? ownedScope.albumId); break
        case 'music-completeness': music(sourceId, libraryId, definition.albumId ?? ownedScope.albumId); break
        case 'artist-completeness': artistCompleteness(definition.artistId ?? ownedScope.artistId!); break
        case 'owned-album-completeness': ownedAlbumCompleteness(definition.artistId ?? ownedScope.artistId!); break
      }
    }
    if (!stages.length) throw new Error('No applicable analysis stages exist for this scope')
    for (let index = 0; index < stages.length; index++) {
      if (this.cancelRequested) {
        for (const remaining of stages.slice(index)) outcomes.push({ stage: remaining.name, status: 'skipped', error: 'Cancelled before stage started' })
        break
      }
      const stage = stages[index]
      onProgress({ current: index, total: stages.length, percentage: Math.floor(index * 100 / stages.length), phase: stage.name })
      try {
        await stage.execute()
        const stageReconciliation = task.result?.reconciliation
        if (stageReconciliation && typeof stageReconciliation === 'object') {
          const counts = stageReconciliation as typeof reconciliation
          reconciliation.merged += counts.merged
          reconciliation.removed += counts.removed
          reconciliation.preservedLocked += counts.preservedLocked
          reconciliation.ambiguous += counts.ambiguous
          databaseBackupPath ??= task.result?.databaseBackupPath
        }
        const stageResultStatus = task.result?.status
        const diagnostics = task.result?.diagnostics
        outcomes.push({
          stage: stage.name,
          status: stageResultStatus === 'deferred' ? 'deferred' : stageResultStatus === 'partial' ? 'partial' : stageResultStatus === 'failed' ? 'failed' : 'completed',
          ...(stageResultStatus === 'deferred' ? { error: 'Provider returned no completeness result', code: 'PROVIDER_DEFERRED' } : {}),
          ...(diagnostics?.length ? { diagnostics } : {}),
        })
      } catch (error) {
        const message = getErrorMessage(error)
        if (parseDatabaseError(error).isDatabaseError) persistenceFailure = error instanceof Error ? error : new Error(message)
        const blocked = /required|not found|no local|not enabled|ownership changed|identity/i.test(message)
        const wasCancelled = this.cancelRequested && error instanceof Error && (error.name === 'AbortError' || /cancelled/i.test(message))
        outcomes.push({ stage: stage.name, status: wasCancelled ? 'skipped' : blocked ? 'blocked' : 'failed', error: message, code: wasCancelled ? 'CANCELLED' : blocked ? 'WORK_BLOCKED' : 'STAGE_FAILED', diagnostics: [{ itemType: scope.kind === 'show' ? 'series' : scope.kind === 'item' ? 'movie' : scope.kind === 'collection' ? 'collection' : scope.kind === 'album' ? 'album' : scope.kind === 'artist' ? 'artist' : 'library', itemId: scope.kind === 'item' ? scope.mediaId : scope.kind === 'artist' ? scope.artistId : scope.kind === 'album' ? scope.albumId : undefined, itemName: task.label, stage: stage.name, category: wasCancelled ? 'cancelled' : blocked ? 'identity' : 'unresolved', code: wasCancelled ? 'CANCELLED' : blocked ? 'WORK_BLOCKED' : 'STAGE_FAILED', message }] })
        if (!wasCancelled) this.logging.error('[TaskQueue]', `Analysis stage ${stage.name} failed`, error)
        if (persistenceFailure) break
      }
    }
    const failedCount = outcomes.filter(outcome => outcome.status === 'failed' || outcome.status === 'partial').length
    const blockedCount = outcomes.filter(outcome => outcome.status === 'blocked').length
    const deferredCount = outcomes.filter(outcome => outcome.status === 'deferred').length
    const completedCount = outcomes.filter(outcome => outcome.status === 'completed').length
    const skippedCount = outcomes.filter(outcome => outcome.status === 'skipped').length
    const hasPartialWork = outcomes.some(outcome => outcome.status === 'partial')
    const status = this.cancelRequested ? 'cancelled' : failedCount || blockedCount || deferredCount ? completedCount || hasPartialWork ? 'partial' : blockedCount ? 'blocked' : failedCount ? 'failed' : 'deferred' : 'completed'
    const diagnostics = outcomes.flatMap(outcome => outcome.diagnostics ?? [])
    const hasReconciliation = databaseBackupPath !== undefined
    const analysis: AnalysisJobResult = {
      scope,
      outcomes,
      status,
      completedCount,
      failedCount,
      deferredCount,
      skippedCount,
      diagnostics,
      ...(hasReconciliation ? { reconciliation, databaseBackupPath } : {}),
    }
    task.result = { ...task.result, status, completedCount, failedCount, deferredCount, skippedCount, diagnostics, outcomes, analysis, ...(hasReconciliation ? { reconciliation, databaseBackupPath } : {}) }
    if (persistenceFailure) throw persistenceFailure
    if (status === 'failed') throw new Error('All required analysis stages failed')
  }

  private async executeTranscode(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.mediaItemId) throw new Error('Missing mediaItemId for transcode task')
    const service = this.getTranscoding()
    
    onProgress({
      current: 0,
      total: 100,
      percentage: 0,
      phase: 'initializing',
      currentItem: task.label
    })

    const success = await service.transcode(
      task.mediaItemId,
      task.options || {},
      (p: TranscodeProgress) => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          safeSend(this.mainWindow, 'transcoding:progress', { mediaItemId: task.mediaItemId, ...p })
        }
        onProgress({
          current: Math.round(p.percent),
          total: 100,
          percentage: p.percent,
          phase: p.status,
          currentItem: task.label,
          fps: p.fps,
          speed: p.speed,
          eta: p.eta
        })
      }
    )
    if (success) {
      const job = await this.db.mediaRemuxJobs.getLatest(task.mediaItemId)
      if (job?.outputAnalysis) {
        const output = JSON.parse(job.outputAnalysis) as { encodedReductionBytes: number; retainedOriginalBytes: number; physicallyReclaimedBytes: number }
        task.result = { encodedReductionBytes: output.encodedReductionBytes, retainedOriginalBytes: output.retainedOriginalBytes, physicallyReclaimedBytes: output.physicallyReclaimedBytes }
      }
    } else if (!this.cancelRequested) throw new Error('Transcoding ended without producing a verified output')
  }

  private notifyListeners(): void {
    const state = this.getState()
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      safeSend(this.mainWindow, 'taskQueue:updated', state)
    }
  }

  private async saveState(propagateFailure = false): Promise<void> {
    const state = JSON.stringify({
      currentTask: this.currentTask,
      queue: this.queue,
      completedTasks: this.completedTasks,
      isPaused: this.isPaused
    })
    const write = this.stateWrite.then(() => this.db.config.setSetting('task_queue_state', state))
    this.stateWrite = write.then(() => undefined, error => {
      getLoggingService().warn('[TaskQueueService]', 'Failed to save state:', error)
    })
    if (propagateFailure) return write
    return this.stateWrite
  }

  private async loadState(): Promise<void> {
    try {
      const stateStr = await this.db.config.getSetting('task_queue_state')
      if (stateStr) {
        const state = JSON.parse(stateStr)
        this.queue = state.queue || []
        this.completedTasks = state.completedTasks || []
        this.isPaused = state.isPaused === true

        // A renderer reconnect must observe the persisted task immediately,
        // while an application restart must not leave a stale task blocking
        // queue processing. Requeue any task that was active at shutdown.
        if (state.currentTask) {
          if (state.currentTask.status === TaskStatus.Cancelled) {
            this.completedTasks.unshift(state.currentTask)
          } else {
            state.currentTask.status = TaskStatus.Queued
            this.queue.unshift(state.currentTask)
          }
        }
        this.currentTask = null
        
        this.logging.info('[TaskQueue]', `State loaded: ${this.queue.length} queued, ${this.completedTasks.length} completed, isPaused=${this.isPaused}`)
        
        // Reset any tasks that were running to queued
        this.queue.forEach(t => { if (t.status === TaskStatus.Running) t.status = TaskStatus.Queued })
      } else {
        this.logging.info('[TaskQueue]', 'No persisted state found')
      }
    } catch (e) {
      this.logging.warn('[TaskQueue]', 'Failed to load state:', e)
    }
  }
}

let taskQueueService: TaskQueueService | null = null
export function getTaskQueueService(): TaskQueueService {
  if (!taskQueueService) {
    taskQueueService = new TaskQueueService()
  }
  return taskQueueService
}

export function resetTaskQueueServiceForTesting(): void {
  taskQueueService = null
}
