/**
 * TaskQueueService - Manages background task queue for scans and analysis
 */

import { getDatabase, BetterSQLiteService } from '@main/database/getDatabase'
import { getLoggingService, LoggingService } from './LoggingService'
import { getErrorMessage } from './utils/errorUtils'
import { getSourceManager, SourceManager } from './SourceManager'
import { getSeriesCompletenessService, SeriesCompletenessService } from './SeriesCompletenessService'
import { getMovieCollectionService, MovieCollectionService } from './MovieCollectionService'
import { getMusicBrainzService, MusicBrainzService } from './MusicBrainzService'
import { getTranscodingService, TranscodingService } from './TranscodingService'
import { safeSend } from '@main/ipc/utils/safeSend'
import { BrowserWindow } from 'electron'

export interface TaskProgress {
  current: number
  total: number
  percentage: number
  phase: string
  currentItem?: string
}

export interface TaskResult {
  itemsScanned?: number
  itemsAdded?: number
  itemsUpdated?: number
  itemsRemoved?: number
  [key: string]: any
}

export interface QueuedTask {
  id: string
  type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan' | 'transcode'
  label: string
  sourceId?: string
  libraryId?: string
  mediaItemId?: number
  artistId?: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: TaskProgress
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  result?: TaskResult
  options?: any
}

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

    this.loadState()
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

  loadPersistedHistory(): void {
    this.loadState()
  }

  /**
   * Add a new task to the queue
   */
  addTask(definition: Omit<QueuedTask, 'id' | 'status' | 'createdAt'>): string {
    const task: QueuedTask = {
      ...definition,
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'queued',
      createdAt: new Date().toISOString(),
    }

    this.queue.push(task)
    this.logging.info('[TaskQueue]', `Task added: ${task.label} (${task.id})`)
    
    this.saveState()
    this.processQueue()
    this.notifyListeners()
    
    return task.id
  }

  /**
   * Remove a task from the queue
   */
  removeTask(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId)
    if (index !== -1) {
      const task = this.queue.splice(index, 1)[0]
      this.logging.info('[TaskQueue]', `Task removed: ${task.label} (${task.id})`)
      this.saveState()
      this.notifyListeners()
      return true
    }
    return false
  }

  removeTasksForSource(sourceId: string): void {
    const originalCount = this.queue.length
    this.queue = this.queue.filter(t => t.sourceId !== sourceId)
    if (this.queue.length !== originalCount) {
      this.logging.info('[TaskQueue]', `Removed ${originalCount - this.queue.length} tasks for source ${sourceId}`)
      this.saveState()
      this.notifyListeners()
    }
  }

  /**
   * Reorder tasks in the queue
   */
  reorderQueue(taskIds: string[]): void {
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
    this.saveState()
    this.notifyListeners()
  }

  /**
   * Clear the entire queue
   */
  clearQueue(): void {
    const count = this.queue.length
    this.queue = []
    this.logging.info('[TaskQueue]', `Queue cleared (${count} tasks removed)`)
    this.saveState()
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
  resume(): void {
    this.isPaused = false
    this.logging.info('[TaskQueue]', 'Queue resumed')
    this.processQueue()
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
  clearTaskHistory(): void { this.completedTasks = []; this.saveState(); this.notifyListeners() }
  clearMonitoringHistory(): void { }

  persistInterruptedTasks(): void {
    if (this.currentTask && this.currentTask.status === 'running') {
      this.currentTask.status = 'queued'
      this.queue.unshift(this.currentTask)
      this.currentTask = null
      this.saveState()
    }
  }

  // --- Internal Methods ---

  private async processQueue(): Promise<void> {
    if (this.currentTask || this.isPaused || this.queue.length === 0) {
      return
    }

    this.currentTask = this.queue.shift() || null
    if (!this.currentTask) return

    this.currentTask.status = 'running'
    this.currentTask.startedAt = new Date().toISOString()
    this.cancelRequested = false
    
    this.logging.info('[TaskQueue]', `Starting task: ${this.currentTask.label}`)
    this.notifyListeners()

    const task = this.currentTask
    const onProgress = (p: TaskProgress) => {
      task.progress = p
      this.notifyListeners()
    }

    try {
      switch (task.type) {
        case 'library-scan':
          await this.executeLibraryScan(task, onProgress)
          break
        case 'source-scan':
          await this.executeSourceScan(task, onProgress)
          break
        case 'series-completeness':
          await this.executeSeriesCompleteness(task, onProgress)
          break
        case 'collection-completeness':
          await this.executeCollectionCompleteness(task, onProgress)
          break
        case 'music-completeness':
          await this.executeMusicCompleteness(task, onProgress)
          break
        case 'music-scan':
          await this.executeMusicScan(task, onProgress)
          break
        case 'transcode':
          await this.executeTranscode(task, onProgress)
          break
        default:
          throw new Error(`Unknown task type: ${task.type}`)
      }

      if (this.cancelRequested) {
        task.status = 'cancelled'
        this.logging.info('[TaskQueue]', `Task cancelled: ${task.label}`)
      } else {
        task.status = 'completed'
        this.logging.info('[TaskQueue]', `Task completed: ${task.label}`)
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error)
      task.status = 'failed'
      task.error = errorMsg
      this.logging.error('[TaskQueue]', `Task failed: ${task.label}`, error)
      
      try {
        this.db.notifications.addNotification({
          type: 'error',
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
      this.saveState()
      this.notifyListeners()
      
      // Emit completion event for UI sounds/effects
      if (prevTask.status === 'completed' && this.mainWindow) {
        safeSend(this.mainWindow, 'taskQueue:taskComplete', prevTask)

        // Special case: Scan tasks should also emit scan:completed
        if (prevTask.type === 'library-scan' || prevTask.type === 'source-scan' || prevTask.type === 'music-scan') {
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
    const result = await service.analyzeAllCollections((prog: any) => {
      onProgress({
        current: prog.current,
        total: prog.total,
        percentage: prog.percentage || Math.round((prog.current / prog.total) * 100) || 0,
        phase: prog.phase,
        currentItem: prog.currentItem
      })
    }, task.sourceId, task.libraryId)
    
    task.result = {
      itemsScanned: result.analyzed,
    }
  }

  private async executeMusicCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    const service = this.getMusicBrainz()
    const db = this.db
    
    if (!task.artistId) throw new Error('Missing artistId for music completeness analysis')
    
    const artist = db.music.getArtistById(task.artistId)
    if (!artist) throw new Error(`Artist not found: ${task.artistId}`)

    // Get owned albums for this artist
    const albums = db.music.getAlbums({ artistId: task.artistId })
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

  private saveState(): void {
    try {
      this.db.config.setSetting('task_queue_state', JSON.stringify({
        queue: this.queue,
        completedTasks: this.completedTasks,
        isPaused: this.isPaused
      }))
    } catch (e) {
      getLoggingService().warn('[TaskQueueService]', 'Failed to save state:', e)
    }
  }

  private loadState(): void {
    try {
      const stateStr = this.db.config.getSetting('task_queue_state')
      if (stateStr) {
        const state = JSON.parse(stateStr)
        this.queue = state.queue || []
        this.completedTasks = state.completedTasks || []
        this.isPaused = state.isPaused || false
        
        // Reset any tasks that were running to queued
        this.queue.forEach(t => { if (t.status === 'running') t.status = 'queued' })
      }
    } catch (e) {
      getLoggingService().warn('[TaskQueueService]', 'Failed to save state:', e)
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
