import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaskQueueService, TaskDefinition } from '../../src/main/services/TaskQueueService'
import { BetterSQLiteService } from '../../src/main/database/BetterSQLiteService'

// Mock dependencies that involve network or complex logic
vi.mock('../../src/main/ipc/utils/safeSend', () => ({
  safeSend: vi.fn(),
}))

vi.mock('../../src/main/services/SourceManager', () => ({
  getSourceManager: vi.fn().mockReturnValue({
    getProvider: vi.fn().mockReturnValue({
      providerType: 'local',
      scanLibrary: vi.fn().mockResolvedValue({ itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, success: true, errors: [], durationMs: 0 }),
    }),
    getSources: vi.fn().mockReturnValue([]),
    scanLibrary: vi.fn().mockResolvedValue({ itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, success: true, errors: [], durationMs: 0 }),
  }),
}))

vi.mock('../../src/main/services/SeriesCompletenessService', () => ({
  getSeriesCompletenessService: vi.fn().mockReturnValue({
    analyzeLibraryCompleteness: vi.fn(),
    analyzeAllSeries: vi.fn().mockResolvedValue({ analyzed: 0, completed: true }),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/MovieCollectionService', () => ({
  getMovieCollectionService: vi.fn().mockReturnValue({
    analyzeCollections: vi.fn(),
    analyzeAllCollections: vi.fn().mockResolvedValue({ analyzed: 0, completed: true }),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/MusicBrainzService', () => ({
  getMusicBrainzService: vi.fn().mockReturnValue({
    analyzeArtistCompleteness: vi.fn(),
    analyzeAllMusic: vi.fn().mockResolvedValue({ artistsAnalyzed: 0, completed: true }),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/LiveMonitoringService', () => ({
  getLiveMonitoringService: vi.fn().mockReturnValue({
    pauseMonitoring: vi.fn(),
    resumeMonitoring: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isActiveAndEnabled: vi.fn().mockReturnValue(false),
  }),
}))

// Intercept getDatabase
let testDb: BetterSQLiteService

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => testDb),
}))

vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn().mockReturnValue({
    analyzeMusicAlbum: vi.fn(),
  })
}))

describe('TaskQueueService', () => {
  let service: TaskQueueService

  beforeEach(() => {
    testDb = new BetterSQLiteService(':memory:')
    testDb.initialize()
    
    vi.clearAllMocks()
    service = new TaskQueueService()

    // Add dummy source for test to pass scan test
    testDb.upsertMediaSource({
      source_id: 'src1',
      source_type: 'local',
      display_name: 'Local test source',
      connection_config: JSON.stringify({ path: '/tmp' }),
      is_enabled: true
    })

    // Add dummy source for music scan test
    testDb.upsertMediaSource({
      source_id: 'test-source',
      source_type: 'local',
      display_name: 'Local music test source',
      connection_config: JSON.stringify({ path: '/tmp' }),
      is_enabled: true
    })
  })

  afterEach(() => {
    testDb.close()
  })

  describe('queue management', () => {
    it('should add a task to the queue', () => {
      const definition: TaskDefinition = {
        type: 'library-scan',
        label: 'Scan All Libraries',
        sourceId: 'src1',
        libraryId: 'lib1',
      }

      const taskId = service.addTask(definition)

      expect(taskId).toBeDefined()
      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/)

      const state = service.getQueueState()
      expect(state.queue.length + (state.currentTask ? 1 : 0)).toBe(1)
    })

    it('should add multiple tasks to the queue', () => {
      service.addTask({ type: 'library-scan', label: 'Task 1', sourceId: 'src1', libraryId: 'lib1' })
      service.addTask({ type: 'source-scan', label: 'Task 2', sourceId: 'src1' })
      service.addTask({ type: 'series-completeness', label: 'Task 3', sourceId: 'src1', libraryId: 'lib1' })

      const state = service.getQueueState()
      const totalTasks = state.queue.length + (state.currentTask ? 1 : 0)
      expect(totalTasks).toBe(3)
    })

    it('should remove a queued task', () => {
      service.pauseQueue()
      const taskId = service.addTask({ type: 'library-scan', label: 'Test', sourceId: 'src1', libraryId: 'lib1' })

      const removed = service.removeTask(taskId)
      expect(removed).toBe(true)
      
      const state = service.getQueueState()
      expect(state.queue.length).toBe(0)
    })

    it('should return false when removing non-existent task', () => {
      const removed = service.removeTask('non-existent-id')
      expect(removed).toBe(false)
    })

    it('should generate unique task IDs', () => {
      const id1 = service.addTask({ type: 'library-scan', label: 'Task 1', sourceId: 'src1', libraryId: 'lib1' })
      const id2 = service.addTask({ type: 'library-scan', label: 'Task 2', sourceId: 'src1', libraryId: 'lib1' })

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
      const id = service.addTask({ type: 'library-scan', label: 'Scan', sourceId: 'src1', libraryId: 'lib1' })
      expect(id).toBeDefined()
    })

    it('should accept source-scan task with sourceId', () => {
      const id = service.addTask({
        type: 'source-scan',
        label: 'Scan Source',
        sourceId: 'test-source',
      })
      expect(id).toBeDefined()
    })

    it('should accept music-scan task', () => {
      const id = service.addTask({
        type: 'music-scan',
        label: 'Scan Music',
        sourceId: 'test-source',
        libraryId: 'test-library',
      })
      expect(id).toBeDefined()
    })

    it('should accept series-completeness task', () => {
      const id = service.addTask({
        type: 'series-completeness',
        label: 'Analyze Series',
        sourceId: 'src1',
        libraryId: 'lib1',
      })
      expect(id).toBeDefined()
    })

    it('should accept collection-completeness task', () => {
      const id = service.addTask({
        type: 'collection-completeness',
        label: 'Analyze Collections',
        sourceId: 'src1',
        libraryId: 'lib1',
      })
      expect(id).toBeDefined()
    })

    it('should accept music-completeness task', () => {
      const id = service.addTask({
        type: 'music-completeness',
        label: 'Analyze Music',
        sourceId: 'src1',
        libraryId: 'lib1',
      })
      expect(id).toBeDefined()
    })
  })
})
