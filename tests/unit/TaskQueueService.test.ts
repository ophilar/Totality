import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaskQueueService } from '@main/services/TaskQueueService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { getLoggingService } from '@main/services/LoggingService'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'
import type { LoggingService } from '@main/services/LoggingService'
import type { SourceManager } from '@main/services/SourceManager'
import { QueuedTask, TaskType } from '@main/types/database'
type TaskDefinition = Omit<QueuedTask, 'id' | 'status' | 'createdAt'>

describe('TaskQueueService', () => {
  let service: TaskQueueService
  let db: BetterSQLiteService
  let logging: LoggingService

  beforeEach(async () => {
    db = await setupTestDb()
    logging = getLoggingService()
    logging.setDatabaseGetter(() => db)
    
    // We still mock SourceManager for now as it involves complex provider setup,
    // but we use real DB and Logging.
    const mockSourceManager: Pick<SourceManager, 'scanLibrary' | 'scanSource'> = {
      scanLibrary: vi.fn().mockResolvedValue({ success: true }),
      scanSource: vi.fn().mockResolvedValue({ success: true }),
    }

    service = new TaskQueueService({
      db,
      logging,
      sourceManager: mockSourceManager
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('queue management', () => {
    it('should add a task to the queue', async () => {
      const definition = {
        type: TaskType.LibraryScan,
        label: 'Scan All Libraries',
        sourceId: 'src1',
        libraryId: 'lib1'
      }

      const taskId = await service.addTask(definition satisfies TaskDefinition)

      expect(taskId).toBeDefined()
      expect(taskId).toMatch(/^task_\d+_[a-z0-9-]+$/)

      const state = service.getQueueState()
      expect(state.queue.length + (state.currentTask ? 1 : 0)).toBe(1)
    })

    it('should add multiple tasks to the queue', async () => {
      service.pauseQueue()
      await service.addTask({ type: TaskType.LibraryScan, label: 'Task 1', sourceId: 's1', libraryId: 'l1' } satisfies TaskDefinition)
      await service.addTask({ type: TaskType.SourceScan, label: 'Task 2', sourceId: 'src1' } satisfies TaskDefinition)
      await service.addTask({ type: TaskType.SeriesCompleteness, label: 'Task 3', sourceId: 's1' } satisfies TaskDefinition)

      const state = service.getQueueState()
      const totalTasks = state.queue.length + (state.currentTask ? 1 : 0)
      expect(totalTasks).toBe(3)
    })

    it('should remove a queued task', async () => {
      // Pause to ensure task stays in queue and doesn't immediately start
      service.pauseQueue()
      const taskId = await service.addTask({ type: TaskType.LibraryScan, label: 'Test', sourceId: 's1', libraryId: 'l1' } satisfies TaskDefinition)

      const state = service.getQueueState()
      expect(state.queue.some(t => t.id === taskId)).toBe(true)
      
      const removed = await service.removeTask(taskId)
      expect(removed).toBe(true)
      expect(service.getQueueState().queue.length).toBe(0)
    })

    it('should return false when removing non-existent task', async () => {
      const removed = await service.removeTask('non-existent-id')
      expect(removed).toBe(false)
    })

    it('should generate unique task IDs', async () => {
      const id1 = await service.addTask({ type: TaskType.LibraryScan, label: 'Task 1', sourceId: 's1', libraryId: 'l1' } satisfies TaskDefinition)
      const id2 = await service.addTask({ type: TaskType.LibraryScan, label: 'Task 2', sourceId: 's1', libraryId: 'l1' } satisfies TaskDefinition)

      expect(id1).not.toBe(id2)
    })
  })

  describe('queue state', () => {
    it('should return queue state', () => {
      const state = service.getQueueState()

      expect(state).toHaveProperty('currentTask')
      expect(state).toHaveProperty('queue')
      expect(state).toHaveProperty('isPaused')
      expect(state).toHaveProperty('completedTasks')
      expect(Array.isArray(state.queue)).toBe(true)
      expect(Array.isArray(state.completedTasks)).toBe(true)
    })

    it('should track paused state', async () => {
      expect(service.getQueueState().isPaused).toBe(false)

      service.pauseQueue()
      expect(service.getQueueState().isPaused).toBe(true)

      await service.resumeQueue()
      expect(service.getQueueState().isPaused).toBe(false)
    })
  })

  describe('persistence', () => {
    it('should persist queue state to database', async () => {
      service.pauseQueue()
      await service.addTask({ type: TaskType.LibraryScan, label: 'Persist Test', sourceId: 's1', libraryId: 'l1' } satisfies TaskDefinition)
      
      const savedState = await db.config.getSetting('task_queue_state')
      expect(savedState).toBeDefined()
      const parsed = JSON.parse(savedState!)
      expect(parsed.queue.length).toBe(1)
      expect(parsed.isPaused).toBe(true)
    })
  })

  it('completes partial series analysis and records a warning notification', async () => {
    const seriesService = {
      analyzeAllSeries: vi.fn().mockResolvedValue({ totalSeries: 2, analyzed: 1, complete: 0, incomplete: 1, errors: ['"Show B": metadata unavailable'], completed: true }),
    }
    const partialService = new TaskQueueService({ db, logging, seriesCompleteness: seriesService as never })
    partialService.pauseQueue()
    await partialService.addTask({ type: TaskType.SeriesCompleteness, label: 'Analyze TV Series', sourceId: 's1' })
    await partialService.resumeQueue()
    await new Promise(resolve => setTimeout(resolve, 25))

    const completed = partialService.getQueueState().completedTasks[0]
    expect(completed.status, completed.error).toBe('completed')
    expect(completed.result).toMatchObject({ totalSeries: 2, analyzedSeries: 1, failedSeries: ['"Show B": metadata unavailable'] })
    const notifications = await db.notifications.getNotifications()
    expect(notifications[0]).toMatchObject({ type: 'info', title: 'Series analysis partially completed' })
  })
})



