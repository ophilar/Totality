import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../helpers/testDatabase'
import { getDatabase } from '../../src/main/database/getDatabase'
import { getSourceManager } from '../../src/main/services/SourceManager'

// Mock dependencies
vi.mock('../../src/main/ipc/utils/safeSend', () => ({
  safeSend: vi.fn(),
}))

vi.mock('../../src/main/services/SourceManager', () => ({
  getSourceManager: vi.fn().mockReturnValue({
    getProvider: vi.fn(),
    getSources: vi.fn().mockReturnValue([]),
  }),
}))

vi.mock('../../src/main/services/SeriesCompletenessService', () => ({
  getSeriesCompletenessService: vi.fn().mockReturnValue({
    analyzeLibraryCompleteness: vi.fn(),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/MovieCollectionService', () => ({
  getMovieCollectionService: vi.fn().mockReturnValue({
    analyzeCollections: vi.fn(),
    cancel: vi.fn(),
  }),
}))

vi.mock('../../src/main/services/MusicBrainzService', () => ({
  getMusicBrainzService: vi.fn().mockReturnValue({
    analyzeArtistCompleteness: vi.fn(),
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

// Import after mocks
import { TaskQueueService, TaskDefinition } from '../../src/main/services/TaskQueueService'

describe('TaskQueueService', () => {
  let service: TaskQueueService
  let database: TestDatabase

  beforeEach(async () => {
    database = await createTestDatabase()
    ;(getDatabase() as unknown as { db: TestDatabase }).db = database
    ;(getDatabase() as unknown as { runMigrations(): void }).runMigrations()
    service = new TaskQueueService()
    service.pauseQueue()
  })

  afterEach(() => {
    database.close()
    vi.clearAllMocks()
  })

  describe('queue management', () => {
    it('should add a task to the queue', () => {
      const definition: TaskDefinition = {
        type: 'library-scan',
        label: 'Scan All Libraries',
      }

      const taskId = service.addTask(definition)

      expect(taskId).toBeDefined()
      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/)

      const state = service.getQueueState()
      expect(state.queue.length + (state.currentTask ? 1 : 0)).toBe(1)
    })

    it('should add multiple tasks to the queue', () => {
      service.addTask({ type: 'library-scan', label: 'Task 1' })
      service.addTask({ type: 'source-scan', label: 'Task 2', sourceId: 'src1' })
      service.addTask({ type: 'series-completeness', label: 'Task 3' })

      const state = service.getQueueState()
      // First task might be running, rest in queue
      const totalTasks = state.queue.length + (state.currentTask ? 1 : 0)
      expect(totalTasks).toBe(3)
    })

    it('should remove a queued task', () => {
      const taskId = service.addTask({ type: 'library-scan', label: 'Test' })

      // If task is already running, removeTask returns false for running tasks
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
      const id1 = service.addTask({ type: 'library-scan', label: 'Task 1', sourceId: 'src1' })
      const id2 = service.addTask({ type: 'library-scan', label: 'Task 2', sourceId: 'src2' })

      expect(id1).not.toBe(id2)
    })

    it('should deduplicate tasks with same type+source+library', () => {
      const id1 = service.addTask({ type: 'library-scan', label: 'Task 1', sourceId: 'src1' })
      const id2 = service.addTask({ type: 'library-scan', label: 'Task 1 dup', sourceId: 'src1' })

      expect(id1).toBe(id2)
    })

    it('deduplicates preflight requests by optimization scope rather than request id', () => {
      const request = { sourceId: 'plex', libraryId: 'shows', seriesIdentityKey: 'show:42', seasonNumber: 2 }
      const first = service.addTask({
        type: 'optimization-preflight',
        label: 'Preflight Show · Season 2',
        options: { requestId: 'first', request },
      })
      const duplicate = service.addTask({
        type: 'optimization-preflight',
        label: 'Preflight Show · Season 2',
        options: { requestId: 'second', request: { ...request } },
      })
      const otherSeason = service.addTask({
        type: 'optimization-preflight',
        label: 'Preflight Show · Season 3',
        options: { requestId: 'third', request: { ...request, seasonNumber: 3 } },
      })

      expect(duplicate).toBe(first)
      expect(otherSeason).not.toBe(first)
    })
  })

  it('fails a library scan when the provider returns an unsuccessful result without errors', async () => {
    const sourceManager = getSourceManager() as unknown as { scanLibrary: ReturnType<typeof vi.fn> }
    const originalScanLibrary = sourceManager.scanLibrary
    sourceManager.scanLibrary = vi.fn().mockResolvedValue({
      success: false,
      itemsScanned: 2,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 10,
    })

    const taskId = service.addTask({ type: 'library-scan', label: 'Scan bad library', sourceId: 'src', libraryId: 'movies' })
    const completion = service.waitForTask(taskId)
    service.resumeQueue()
    const task = await completion

    expect(task.status).toBe('failed')
    expect(task.error).toContain('did not complete successfully')
    expect(task.result?.itemsScanned).toBe(2)
    expect(task.result?.failedCount).toBe(0)
    sourceManager.scanLibrary = originalScanLibrary
  })

  it('fails a source scan when an enabled library fails', async () => {
    const libraries = vi.spyOn(getDatabase(), 'getSourceLibraries').mockReturnValue([{
      libraryId: 'movies',
      libraryName: 'Movies',
      libraryType: 'movie',
      isEnabled: 1,
      lastScanAt: null,
      itemsScanned: 0,
    }] as never)
    const sourceManager = getSourceManager() as unknown as { scanLibrary: ReturnType<typeof vi.fn> }
    const originalScanLibrary = sourceManager.scanLibrary
    sourceManager.scanLibrary = vi.fn().mockResolvedValue({
      success: false,
      itemsScanned: 4,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: ['Provider could not read library'],
      durationMs: 12,
    })
    try {
      const taskId = service.addTask({ type: 'source-scan', label: 'Scan source', sourceId: 'src' })
      const completion = service.waitForTask(taskId)
      service.resumeQueue()
      const task = await completion
      expect(task.status).toBe('failed')
      expect(task.result?.itemsScanned).toBe(4)
      expect(task.result?.errors).toEqual(['Movies: Provider could not read library'])
      expect(task.error).toContain('Provider could not read library')
    } finally {
      sourceManager.scanLibrary = originalScanLibrary
      libraries.mockRestore()
    }
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
      expect(service.getQueueState().isPaused).toBe(true)

      service.resumeQueue()
      expect(service.getQueueState().isPaused).toBe(false)

      service.pauseQueue()
      expect(service.getQueueState().isPaused).toBe(true)
    })

    it('should start unpaused', () => {
      const newService = new TaskQueueService()
      expect(newService.getQueueState().isPaused).toBe(false)
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
      const id = service.addTask({ type: 'library-scan', label: 'Scan' })
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
      })
      expect(id).toBeDefined()
    })

    it('should accept collection-completeness task', () => {
      const id = service.addTask({
        type: 'collection-completeness',
        label: 'Analyze Collections',
      })
      expect(id).toBeDefined()
    })

    it('should accept music-completeness task', () => {
      const id = service.addTask({
        type: 'music-completeness',
        label: 'Analyze Music',
      })
      expect(id).toBeDefined()
    })
  })

  describe('background media analysis', () => {
    it('refreshes stored quality without reading a file or queuing measurement', async () => {
      database.exec(`INSERT INTO media_items (plex_id, title, type, file_path, file_size_bytes, duration_ms,
        resolution, width, height, video_codec, video_bitrate_kbps, audio_codec, audio_channels, audio_bitrate_kbps)
        VALUES ('remote', 'Remote movie', 'movie', '/unavailable/movie.mkv', 1000000, 1000,
        '1080p', 1920, 1080, 'h264', 8000, 'aac', 2, 192)`)
      const mediaItemId = (database.prepare("SELECT id FROM media_items WHERE plex_id = 'remote'").get() as { id: number }).id
      database.prepare(`INSERT INTO quality_scores (media_item_id, quality_tier, tier_quality, tier_score,
        video_savings_bytes, estimated_savings_bytes, savings_coverage, issues)
        VALUES (?, 'SD', 'LOW', 30, 120, 300, 'complete', '["Keep this review"]')`).run(mediaItemId)
      const taskId = service.addTask({ type: 'quality-analysis', label: 'Refresh quality' })
      const completed = service.waitForTask(taskId)
      service.resumeQueue()
      const task = await completed
      service.pauseQueue()
      expect(task.status).toBe('completed')
      expect(task.result?.itemsScanned).toBe(1)
      expect(database.prepare('SELECT quality_tier, video_savings_bytes, estimated_savings_bytes, issues FROM quality_scores').get()).toEqual({
        quality_tier: '1080p', video_savings_bytes: 120, estimated_savings_bytes: 300, issues: '["Keep this review"]',
      })
      expect(service.getQueueState().queue).toEqual([])
    })

    it('restores saved file checkpoints and skips completed files', async () => {
      database.exec(`INSERT INTO media_items (id, plex_id, title, type, file_path, file_size_bytes, duration_ms,
        resolution, width, height, video_codec, video_bitrate_kbps, audio_codec, audio_channels, audio_bitrate_kbps)
        VALUES (1, 'complete', 'Measured movie', 'movie', '/unavailable/measured.mkv', 1000000, 1000,
        '1080p', 1920, 1080, 'h264', 8000, 'aac', 2, 192)`)
      const taskId = service.addTask({ type: 'media-analysis', label: 'Measure media files', options: { completedMediaItemIds: [1] } })
      const restored = new TaskQueueService()
      restored.restorePendingQueue()
      expect(restored.getQueueState().isPaused).toBe(true)
      expect(restored.getQueueState().queue[0].options).toEqual({ completedMediaItemIds: [1] })
      const completed = restored.waitForTask(taskId)
      restored.resumeQueue()
      const task = await completed
      expect(task.status).toBe('completed')
      expect(task.result?.itemsScanned).toBe(1)
      expect(getDatabase().getPendingTasks()).toEqual([])
    })
  })
})
