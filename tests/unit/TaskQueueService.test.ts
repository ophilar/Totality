import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaskQueueService } from '@main/services/TaskQueueService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { getLoggingService } from '@main/services/LoggingService'
import { QueuedTask, TaskType } from '@main/types/database'

describe('TaskQueueService', () => {
  let service: TaskQueueService
  let db: any
  let logging: any

  beforeEach(async () => {
    db = await setupTestDb()
    logging = getLoggingService()
    logging.setDatabaseGetter(() => db)
    
    // We still mock SourceManager for now as it involves complex provider setup,
    // but we use real DB and Logging.
    const mockSourceManager = {
      scanLibrary: vi.fn().mockResolvedValue({ success: true }),
      scanSource: vi.fn().mockResolvedValue({ success: true }),
    }

    service = new TaskQueueService({
      db,
      logging,
      sourceManager: mockSourceManager as any
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

      const taskId = await service.addTask(definition as any)

      expect(taskId).toBeDefined()
      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/)

      const state = service.getQueueState()
      expect(state.queue.length + (state.currentTask ? 1 : 0)).toBe(1)
    })

    it('should add multiple tasks to the queue', async () => {
      service.pauseQueue()
      await service.addTask({ type: TaskType.LibraryScan, label: 'Task 1', sourceId: 's1', libraryId: 'l1' } as any)
      await service.addTask({ type: TaskType.SourceScan, label: 'Task 2', sourceId: 'src1' } as any)
      await service.addTask({ type: TaskType.SeriesCompleteness, label: 'Task 3', sourceId: 's1' } as any)

      const state = service.getQueueState()
      const totalTasks = state.queue.length + (state.currentTask ? 1 : 0)
      expect(totalTasks).toBe(3)
    })

    it('should remove a queued task', async () => {
      // Pause to ensure task stays in queue and doesn't immediately start
      service.pauseQueue()
      const taskId = await service.addTask({ type: TaskType.LibraryScan, label: 'Test', sourceId: 's1', libraryId: 'l1' } as any)

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
      const id1 = await service.addTask({ type: TaskType.LibraryScan, label: 'Task 1', sourceId: 's1', libraryId: 'l1' } as any)
      const id2 = await service.addTask({ type: TaskType.LibraryScan, label: 'Task 2', sourceId: 's1', libraryId: 'l1' } as any)

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
      await service.addTask({ type: TaskType.LibraryScan, label: 'Persist Test', sourceId: 's1', libraryId: 'l1' } as any)
      
      const savedState = await db.config.getSetting('task_queue_state')
      expect(savedState).toBeDefined()
      const parsed = JSON.parse(savedState!)
      expect(parsed.queue.length).toBe(1)
      expect(parsed.isPaused).toBe(true)
    })
  })
})



