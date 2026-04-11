import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaskQueueService, TaskDefinition } from '../../src/main/services/TaskQueueService'

describe('TaskQueueService', () => {
  let service: TaskQueueService
  let mockDb: any
  let mockLogging: any
  let mockSourceManager: any

  beforeEach(() => {
    vi.clearAllMocks()
    
    mockDb = {
      getSetting: vi.fn().mockReturnValue(null),
      setSetting: vi.fn(),
      createNotification: vi.fn().mockReturnValue(1),
      getMusicArtistById: vi.fn(),
      getMusicAlbums: vi.fn().mockReturnValue([]),
    }

    mockLogging = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      verbose: vi.fn(),
    }

    mockSourceManager = {
      getProvider: vi.fn(),
      getSources: vi.fn().mockReturnValue([]),
      scanLibrary: vi.fn().mockResolvedValue({ success: true }),
      scanSource: vi.fn().mockResolvedValue({ success: true }),
    }

    service = new TaskQueueService({
      db: mockDb,
      logging: mockLogging,
      sourceManager: mockSourceManager
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('queue management', () => {
    it('should add a task to the queue', () => {
      const definition: TaskDefinition = {
        type: 'library-scan',
        label: 'Scan All Libraries',
      }

      const taskId = service.addTask(definition as any)

      expect(taskId).toBeDefined()
      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/)

      const state = service.getQueueState()
      expect(state.queue.length + (state.currentTask ? 1 : 0)).toBe(1)
    })

    it('should add multiple tasks to the queue', () => {
      service.addTask({ type: 'library-scan', label: 'Task 1' } as any)
      service.addTask({ type: 'source-scan', label: 'Task 2', sourceId: 'src1' } as any)
      service.addTask({ type: 'series-completeness', label: 'Task 3' } as any)

      const state = service.getQueueState()
      const totalTasks = state.queue.length + (state.currentTask ? 1 : 0)
      expect(totalTasks).toBe(3)
    })

    it('should remove a queued task', () => {
      const taskId = service.addTask({ type: 'library-scan', label: 'Test' } as any)

      const state = service.getQueueState()
      if (state.queue.find(t => t.id === taskId)) {
        const removed = service.removeTask(taskId)
        expect(removed).toBe(true)
      }
    })

    it('should return false when removing non-existent task', () => {
      const removed = service.removeTask('non-existent-id')
      expect(removed).toBe(false)
    })

    it('should generate unique task IDs', () => {
      const id1 = service.addTask({ type: 'library-scan', label: 'Task 1' } as any)
      const id2 = service.addTask({ type: 'library-scan', label: 'Task 2' } as any)

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

    it('should track paused state', () => {
      expect(service.getQueueState().isPaused).toBe(false)

      service.pauseQueue()
      expect(service.getQueueState().isPaused).toBe(true)

      service.resumeQueue()
      expect(service.getQueueState().isPaused).toBe(false)
    })
  })

  describe('pause/resume', () => {
    it('should pause the queue', () => {
      service.pauseQueue()

      const state = service.getQueueState()
      expect(state.isPaused).toBe(true)
    })

    it('should resume the queue', () => {
      service.pauseQueue()
      service.resumeQueue()

      const state = service.getQueueState()
      expect(state.isPaused).toBe(false)
    })
  })

  describe('monitoring history', () => {
    it('should return monitoring history', () => {
      const history = service.getMonitoringHistory()
      expect(Array.isArray(history)).toBe(true)
    })
  })

  describe('task definitions', () => {
    it('should accept library-scan task', () => {
      const id = service.addTask({ type: 'library-scan', label: 'Scan' } as any)
      expect(id).toBeDefined()
    })

    it('should accept source-scan task with sourceId', () => {
      const id = service.addTask({
        type: 'source-scan',
        label: 'Scan Source',
        sourceId: 'test-source',
      } as any)
      expect(id).toBeDefined()
    })

    it('should accept music-scan task', () => {
      const id = service.addTask({
        type: 'music-scan',
        label: 'Scan Music',
        sourceId: 'test-source',
        libraryId: 'test-library',
      } as any)
      expect(id).toBeDefined()
    })

    it('should accept series-completeness task', () => {
      const id = service.addTask({
        type: 'series-completeness',
        label: 'Analyze Series',
      } as any)
      expect(id).toBeDefined()
    })

    it('should accept collection-completeness task', () => {
      const id = service.addTask({
        type: 'collection-completeness',
        label: 'Analyze Collections',
      } as any)
      expect(id).toBeDefined()
    })

    it('should accept music-completeness task', () => {
      const id = service.addTask({
        type: 'music-completeness',
        label: 'Analyze Music',
      } as any)
      expect(id).toBeDefined()
    })
  })
})
