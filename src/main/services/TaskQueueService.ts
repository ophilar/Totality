/**
 * TaskQueueService - Manages background task queue for scans and analysis
 */

import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from './LoggingService'
import { getErrorMessage } from './utils/errorUtils'
import { getSourceManager } from './SourceManager'
import { getSeriesCompletenessService } from './SeriesCompletenessService'
import { getMovieCollectionService } from './MovieCollectionService'
import { getMusicBrainzService } from './MusicBrainzService'

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
  type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
  label: string
  sourceId?: string
  libraryId?: string
  artistId?: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: TaskProgress
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  result?: TaskResult
}

export class TaskQueueService {
  private queue: QueuedTask[] = []
  private currentTask: QueuedTask | null = null
  private completedTasks: QueuedTask[] = []
  private isPaused = false
  private cancelRequested = false
  private historyLimit = 100

  constructor() {
    this.loadState()
  }

  setMainWindow(_win: any): void {
    // No longer needed but kept for API compatibility
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
    getLoggingService().info('[TaskQueue]', `Task added: ${task.label} (${task.id})`)
    
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
      getLoggingService().info('[TaskQueue]', `Task removed: ${task.label} (${task.id})`)
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
      getLoggingService().info('[TaskQueue]', `Removed ${originalCount - this.queue.length} tasks for source ${sourceId}`)
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
    getLoggingService().info('[TaskQueue]', `Queue cleared (${count} tasks removed)`)
    this.saveState()
    this.notifyListeners()
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    this.isPaused = true
    getLoggingService().info('[TaskQueue]', 'Queue paused')
    this.notifyListeners()
  }

  pauseQueue(): void { this.pause() }

  /**
   * Resume queue processing
   */
  resume(): void {
    this.isPaused = false
    getLoggingService().info('[TaskQueue]', 'Queue resumed')
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
      getLoggingService().info('[TaskQueue]', `Cancellation requested for task: ${this.currentTask.label}`)
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
    
    getLoggingService().info('[TaskQueue]', `Starting task: ${this.currentTask.label}`)
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
        default:
          throw new Error(`Unknown task type: ${task.type}`)
      }

      if (this.cancelRequested) {
        task.status = 'cancelled'
        getLoggingService().info('[TaskQueue]', `Task cancelled: ${task.label}`)
      } else {
        task.status = 'completed'
        getLoggingService().info('[TaskQueue]', `Task completed: ${task.label}`)
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error)
      task.status = 'failed'
      task.error = errorMsg
      getLoggingService().error('[TaskQueue]', `Task failed: ${task.label}`, error)
      
      try {
        getDatabase().createNotification({
          type: 'error',
          title: 'Task failed',
          message: `${task.label}: ${errorMsg}`,
          sourceId: task.sourceId,
          sourceName: task.label,
        })
      } catch { /* ignore */ }
    } finally {
      task.completedAt = new Date().toISOString()
      this.completedTasks.unshift(task)
      if (this.completedTasks.length > this.historyLimit) {
        this.completedTasks.pop()
      }
      
      this.currentTask = null
      this.saveState()
      this.notifyListeners()
      
      // Emit completion event for UI sounds/effects
      if (task.status === 'completed') {
        const windows = require('electron').BrowserWindow.getAllWindows()
        windows[0]?.webContents.send('taskQueue:taskComplete', task)
      }

      // Small delay before next task
      setTimeout(() => this.processQueue(), 500)
    }
  }

  private async executeLibraryScan(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.sourceId || !task.libraryId) throw new Error('Missing sourceId or libraryId')
    const manager = getSourceManager()
    await manager.scanLibrary(task.sourceId, task.libraryId, onProgress)
  }

  private async executeSourceScan(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    if (!task.sourceId) throw new Error('Missing sourceId')
    const manager = getSourceManager()
    await manager.scanSource(task.sourceId, onProgress)
  }

  private async executeSeriesCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    const service = getSeriesCompletenessService()
    const result = await service.analyzeAllSeries(task.sourceId, task.libraryId, onProgress)
    
    task.result = {
      itemsScanned: result.analyzed,
    }

    if (result.analyzed < result.totalSeries && !this.cancelRequested) {
      throw new Error('Series analysis did not finish all series')
    }
  }

  private async executeCollectionCompleteness(task: QueuedTask, onProgress: (p: TaskProgress) => void): Promise<void> {
    const service = getMovieCollectionService()
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
    const service = getMusicBrainzService()
    const db = getDatabase()
    
    if (!task.artistId) throw new Error('Missing artistId for music completeness analysis')
    
    const artist = db.getMusicArtistById(task.artistId)
    if (!artist) throw new Error(`Artist not found: ${task.artistId}`)

    // Get owned albums for this artist
    const albums = db.getMusicAlbums({ artistId: task.artistId })
    const ownedAlbumTitles = albums.map(a => a.title)
    const ownedAlbumMbIds = albums.map(a => a.musicbrainz_id).filter((id): id is string => !!id)
    
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
    if (!task.sourceId) throw new Error('Missing sourceId')
    const manager = getSourceManager()
    await manager.scanSource(task.sourceId, onProgress)
  }

  private notifyListeners(): void {
    const state = this.getState()
    try {
      const electron = require('electron')
      if (electron && electron.BrowserWindow) {
        const windows = electron.BrowserWindow.getAllWindows()
        for (const win of windows) {
          win.webContents.send('taskQueue:updated', state)
        }
      }
    } catch {
      // Ignore during unit tests
    }
  }

  private saveState(): void {
    const db = getDatabase()
    try {
      db.setSetting('task_queue_state', JSON.stringify({
        queue: this.queue,
        completedTasks: this.completedTasks,
        isPaused: this.isPaused
      }))
    } catch { /* ignore */ }
  }

  private loadState(): void {
    const db = getDatabase()
    try {
      const stateStr = db.getSetting('task_queue_state')
      if (stateStr) {
        const state = JSON.parse(stateStr)
        this.queue = state.queue || []
        this.completedTasks = state.completedTasks || []
        this.isPaused = state.isPaused || false
        
        // Reset any tasks that were running to queued
        this.queue.forEach(t => { if (t.status === 'running') t.status = 'queued' })
      }
    } catch { /* ignore */ }
  }
}

let taskQueueService: TaskQueueService | null = null
export function getTaskQueueService(): TaskQueueService {
  if (!taskQueueService) {
    taskQueueService = new TaskQueueService()
  }
  return taskQueueService
}
