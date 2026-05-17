/**
 * TaskQueueService - Manages background task queue for scans and analysis
 */

import { getDatabase } from '@main/database/BetterSQLiteService'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getLoggingService, LoggingService } from '@main/services/LoggingService'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { getSourceManager, SourceManager } from '@main/services/SourceManager'
import { getSeriesCompletenessService, SeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { getMovieCollectionService, MovieCollectionService } from '@main/services/MovieCollectionService'
import { getMusicBrainzService, MusicBrainzService } from '@main/services/MusicBrainzService'
import { getTranscodingService, TranscodingService } from '@main/services/TranscodingService'
import { safeSend } from '@main/ipc/utils/safeSend'
import { BrowserWindow } from 'electron'
import { 
  QueuedTask, 
  TaskType, 
  TaskStatus, 
  TaskProgress 
} from '@main/types/database'
import { NotificationType } from '@main/types/monitoring'

export interface TaskQueueDependencies {
  db?: BetterSQLiteService
  logging?: LoggingService
  sourceManager?: SourceManager
  seriesCompleteness?: SeriesCompletenessService
  movieCollection?: MovieCollectionService
  musicBrainz?: MusicBrainzService
  transcoding?: TranscodingService
}

export class TaskQueueService {
  private queue: QueuedTask[] = []
  private currentTask: QueuedTask | null = null
  private completedTasks: QueuedTask[] = []
  private isPaused = false
  private cancelRequested = false
  private historyLimit = 100

  private db: BetterSQLiteService
  private logging: LoggingService
  private sourceManager: SourceManager | null
  private seriesCompleteness: SeriesCompletenessService | null
  private movieCollection: MovieCollectionService | null
  private musicBrainz: MusicBrainzService | null
  private transcoding: TranscodingService | null
  private mainWindow: BrowserWindow | null = null

  constructor(deps: TaskQueueDependencies = {}) {
    this.db = deps.db || getDatabase()
    this.logging = deps.logging || getLoggingService()
    this.sourceManager = deps.sourceManager || null
    this.seriesCompleteness = deps.seriesCompleteness || null
    this.movieCollection = deps.movieCollection || null
    this.musicBrainz = deps.musicBrainz || null
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
    if (this.queue.length > 0 && !this.isPaused && !this.currentTask) {
      this.logging.info('[TaskQueue]', `Resuming queue with ${this.queue.length} persisted tasks`)
      this.processQueue()
    }
  }

  /**
   * Add a new task to the queue
   */
  async addTask(definition: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>): Promise<string> {
    const task: QueuedTask = {
      ...definition,
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: TaskStatus.Queued,
      createdAt: new Date().toISOString(),
    }

    this.queue.push(task)
    const msg = `Task added: ${task.label} (${task.id})`
    this.logging.info('[TaskQueue]', msg)
    
    await this.saveState()
    this.processQueue()
    this.notifyListeners()
    
    return task.id
  }

  /**
   * Add multiple tasks to the queue at once
   */
  async addTasks(definitions: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>[]): Promise<string[]> {
    const ids: string[] = []
    const now = new Date().toISOString()

    for (const definition of definitions) {
      const task: QueuedTask = {
        ...definition,
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${ids.length}`,
        status: TaskStatus.Queued,
        createdAt: now,
      }
      this.queue.push(task)
      ids.push(task.id)
    }

    this.logging.info('[TaskQueue]', `Added ${definitions.length} batch tasks`)
    
    await this.saveState()
    this.processQueue()
    this.notifyListeners()
    
    return ids
  }

  /**
   * Remove a task from the queue
   */
  async removeTask(taskId: string): Promise<boolean> {
    const index = this.queue.findIndex(t => t.id === taskId)
    if (index !== -1) {
      const task = this.queue.splice(index, 1)[0]
      this.logging.info('[TaskQueue]', `Task removed: ${task.label} (${task.id})`)
      await this.saveState()
      this.notifyListeners()
      return true
    }
    return false
  }

  async removeTasksForSource(sourceId: string): Promise<void> {
    const originalCount = this.queue.length
    this.queue = this.queue.filter(t => t.sourceId !== sourceId)
    if (this.queue.length !== originalCount) {
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
  async clearQueue(): Promise<void> {
    const count = this.queue.length
    this.queue = []
    this.logging.info('[TaskQueue]', `Queue cleared (${count} tasks removed)`)
    await this.saveState()
    this.notifyListeners()
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    this.isPaused = true
    this.logging.info('[TaskQueue]', 'Queue paused')
    this.notifyListeners()
  }

  pauseQueue(): void { this.pause() }

  /**
   * Resume queue processing
   */
  async resume(): Promise<void> {
    this.isPaused = false
    this.logging.info('[TaskQueue]', 'Queue resumed')
    await this.processQueue()
    this.notifyListeners()
  }

  resumeQueue(): void { this.resume() }

  /**
   * Cancel the currently running task
   */
  cancelCurrent(): void {
    if (this.currentTask) {
      this.cancelRequested = true
      this.logging.info('[TaskQueue]', `Cancellation requested for task: ${this.currentTask.label}`)
    }
  }

  cancelCurrentTask(): void { this.cancelCurrent() }

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

  getTaskHistory(): any[] { return this.completedTasks }
  getMonitoringHistory(): any[] { return [] }
  async clearTaskHistory(): Promise<void> { this.completedTasks = []; await this.saveState(); this.notifyListeners() }
  clearMonitoringHistory(): void { }

  async persistInterruptedTasks(): Promise<void> {
    if (this.currentTask && this.currentTask.status === TaskStatus.Running) {
      this.currentTask.status = TaskStatus.Queued
      this.queue.unshift(this.currentTask)
      this.currentTask = null
      await this.saveState()
    }
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

    this.currentTask.status = TaskStatus.Running
    this.currentTask.startedAt = new Date().toISOString()
    this.cancelRequested = false
    
    this.logging.info('[TaskQueue]', `Starting task: ${this.currentTask.label} (${this.currentTask.id})`)
    this.notifyListeners()

    const task = this.currentTask
    const onProgress = (p: TaskProgress) => {
      task.progress = p
      this.notifyListeners()
    }

    try {
      switch (task.type) {
        case TaskType.LibraryScan:
          await this.executeLibraryScan(task, onProgress)
          break
        case TaskType.SourceScan:
          await this.executeSourceScan(task, onProgress)
          break
        case TaskType.SeriesCompleteness:
          await this.executeSeriesCompleteness(task, onProgress)
          break
        case TaskType.CollectionCompleteness:
          await this.executeCollectionCompleteness(task, onProgress)
          break
        case TaskType.MusicCompleteness:
          await this.executeMusicCompleteness(task, onProgress)
          break
        case TaskType.MusicScan:
          await this.executeMusicScan(task, onProgress)
          break
        case TaskType.Transcode:
          await this.executeTranscode(task, onProgress)
          break
        default:
          throw new Error(`Unknown task type: ${task.type}`)
      }

      if (this.cancelRequested) {
        task.status = TaskStatus.Cancelled
        this.logging.info('[TaskQueue]', `Task cancelled: ${task.label}`)
      } else {
        task.status = TaskStatus.Completed
        this.logging.info('[TaskQueue]', `Task completed: ${task.label}`)
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error)
      task.status = TaskStatus.Failed
      task.error = errorMsg
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
    } finally {
      task.completedAt = new Date().toISOString()
      this.completedTasks.unshift(task)
      if (this.completedTasks.length > this.historyLimit) {
        this.completedTasks.pop()
      }
      
      const prevTask = task
      this.currentTask = null
      await this.saveState()
      this.notifyListeners()
      
      // Emit completion event for UI sounds/effects
      if (prevTask.status === TaskStatus.Completed && this.mainWindow) {
        safeSend(this.mainWindow, 'taskQueue:taskComplete', prevTask)

        // Special case: Scan tasks should also emit scan:completed
        if (prevTask.type === TaskType.LibraryScan || prevTask.type === TaskType.SourceScan || prevTask.type === TaskType.MusicScan) {
          const res = prevTask.result as any
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
    await manager.scanLibrary(task.sourceId, task.libraryId, onProgress)
  }

  private async executeSourceScan(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.sourceId) throw new Error('Missing sourceId')
    const manager = this.getSourceManager()
    await manager.scanSource(task.sourceId, onProgress)
  }

  private async executeSeriesCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    const service = this.getSeriesCompleteness()
    const result = await service.analyzeAllSeries(task.sourceId, task.libraryId, onProgress)
    
    task.result = {
      itemsScanned: result.analyzed,
    }

    if (result.analyzed < result.totalSeries && !this.cancelRequested) {
      throw new Error('Series analysis did not finish all series')
    }
  }

  private async executeCollectionCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    const service = this.getMovieCollection()
    const result = await service.analyzeAllCollections(task.sourceId, task.libraryId, (prog: any) => {
      onProgress({
        current: prog.current,
        total: prog.total,
        percentage: prog.percentage || Math.round((prog.current / prog.total) * 100) || 0,
        phase: prog.phase,
        currentItem: prog.currentItem
      })
    })

    task.result = {
      itemsScanned: result.analyzed,
    }
  }

  private async executeMusicCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    const service = this.getMusicBrainz()
    const db = this.db
    
    if (!task.artistId) throw new Error('Missing artistId for music completeness analysis')
    
    const artist = await db.music.getArtistById(task.artistId)
    if (!artist) throw new Error(`Artist not found: ${task.artistId}`)

    // Get owned albums for this artist
    const albums = await db.music.getAlbums({ artistId: task.artistId })
    const ownedAlbumTitles = albums.map((a: any) => a.title)
    const ownedAlbumMbIds = albums.map((a: any) => a.musicbrainz_id).filter((id: any): id is string => !!id)
    
    // @ts-ignore - analyzeArtistCompleteness might have different signature than expected from grep
    const result = await service.analyzeArtistCompleteness(
      artist.name,
      artist.musicbrainz_id || undefined,
      ownedAlbumTitles,
      ownedAlbumMbIds
    )
    
    task.result = {
      itemsScanned: (result as any).total_albums || 0,
    }
    
    // Set progress to complete
    onProgress({
      current: 1,
      total: 1,
      percentage: 100,
      phase: 'complete',
      currentItem: artist.name
    })
  }

  private async executeMusicScan(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.sourceId || !task.libraryId) throw new Error('Missing sourceId or libraryId')
    const manager = this.getSourceManager()
    await manager.scanLibrary(task.sourceId, task.libraryId, onProgress)
  }

  private async executeTranscode(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.mediaItemId) throw new Error('Missing mediaItemId for transcode task')
    const service = this.getTranscoding()
    
    await service.transcode(
      task.mediaItemId,
      task.options || {},
      (p: any) => {
        onProgress({
          current: Math.round(p.percent),
          total: 100,
          percentage: p.percent,
          phase: p.status,
          currentItem: task.label
        })
      }
    )
  }

  private notifyListeners(): void {
    const state = this.getState()
    if (this.mainWindow) {
      safeSend(this.mainWindow, 'taskQueue:updated', state)
    }
  }

  private async saveState(): Promise<void> {
    try {
      await this.db.config.setSetting('task_queue_state', JSON.stringify({
        queue: this.queue,
        completedTasks: this.completedTasks,
        isPaused: this.isPaused
      }))
    } catch (e) {
      getLoggingService().warn('[TaskQueueService]', 'Failed to save state:', e)
    }
  }

  private async loadState(): Promise<void> {
    try {
      const stateStr = await this.db.config.getSetting('task_queue_state')
      if (stateStr) {
        const state = JSON.parse(stateStr)
        this.queue = state.queue || []
        this.completedTasks = state.completedTasks || []
        this.isPaused = state.isPaused === true // Explicitly check for true
        
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
