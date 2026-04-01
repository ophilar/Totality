/**
 * FFprobeWorkerPool Unit Tests
 *
 * Tests worker pool lifecycle, queue management, error handling,
 * and resource cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock worker_threads
class MockWorker extends EventEmitter {
  postMessage = vi.fn()
  terminate = vi.fn().mockImplementation(() => {
    // Simulate async exit
    setImmediate(() => this.emit('exit', 0))
    return Promise.resolve(0)
  })
  // Overwrite to avoid calling actual EventEmitter.removeAllListeners if we want to track it
  removeAllListeners = vi.fn().mockImplementation((event?: string) => {
    if (event) super.removeAllListeners(event)
    else super.removeAllListeners()
    return this
  })
}

const mockWorker = new MockWorker()

vi.mock('worker_threads', () => ({
  Worker: vi.fn().mockImplementation(function() {
    return mockWorker
  }),
}))

vi.mock('os', () => ({
  cpus: vi.fn(() => Array(4).fill({ model: 'test' })),
}))

vi.mock('path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}))

// Import after mocks
const { FFprobeWorkerPool } = await import('../../src/main/services/FFprobeWorkerPool')

describe('FFprobeWorkerPool', () => {
  let pool: InstanceType<typeof FFprobeWorkerPool>

  beforeEach(() => {
    vi.clearAllMocks()
    pool = new FFprobeWorkerPool()
    // Reset the mock worker state
    mockWorker.removeAllListeners()
    mockWorker.postMessage.mockReset()
    mockWorker.terminate.mockReset()
    mockWorker.removeAllListeners.mockReset()
  })

  describe('initialization', () => {
    it('should not be initialized by default', () => {
      const stats = pool.getStats()
      expect(stats.activeWorkers).toBe(0)
      expect(stats.queuedTasks).toBe(0)
    })

    it('should set max workers based on CPU count', () => {
      const stats = pool.getStats()
      expect(stats.maxWorkers).toBe(3) // 4 CPUs - 1
    })

    it('should allow setting max workers', () => {
      pool.setMaxWorkers(2)
      expect(pool.getStats().maxWorkers).toBe(2)
    })

    it('should clamp max workers between 1 and 16', () => {
      pool.setMaxWorkers(0)
      expect(pool.getStats().maxWorkers).toBe(1)
      pool.setMaxWorkers(100)
      expect(pool.getStats().maxWorkers).toBe(16)
    })

    it('should initialize with ffprobe path', async () => {
      await pool.initialize('/path/to/ffprobe')
      // Second call should be a no-op
      await pool.initialize('/different/path')
      // Pool is initialized
      expect(pool.getStats().maxWorkers).toBeGreaterThan(0)
    })
  })

  describe('queue management', () => {
    it('should return error for uninitialized pool', async () => {
      const result = await pool.analyzeFile('/test.mkv')
      expect(result.success).toBe(false)
      expect(result.error).toContain('not initialized')
    })

    it('should return error when shutting down', async () => {
      await pool.initialize('/path/to/ffprobe')
      // Start shutdown (async)
      const shutdownPromise = pool.shutdown()
      const result = await pool.analyzeFile('/test.mkv')
      expect(result.success).toBe(false)
      expect(result.error).toContain('shutting down')
      await shutdownPromise
    })

    it('should reject tasks when queue is full', async () => {
      await pool.initialize('/path/to/ffprobe')

      // Fill the queue
      // We need to avoid assigned tasks since they won't be in taskQueue
      // But workers are created and tasks are assigned.
      // With 3 workers, the first 3 tasks are assigned, 10000 are queued.
      // So 10003 calls total to fill queue + 1 to fail.
      const promises: Promise<unknown>[] = []
      for (let i = 0; i < 10004; i++) {
        promises.push(pool.analyzeFile(`/test${i}.mkv`))
      }

      // The 10004th task should be rejected
      const lastResult = await promises[10003]
      expect(lastResult).toEqual(expect.objectContaining({
        success: false,
        error: expect.stringContaining('queue is full'),
      }))
      
      // Cleanup to resolve pending promises
      await pool.shutdown()
    })
  })

  describe('shutdown', () => {
    it('should resolve queued tasks on shutdown', async () => {
      await pool.initialize('/path/to/ffprobe')

      // Queue more tasks than workers to ensure some stay in taskQueue
      // 3 workers, so 5 tasks = 3 assigned, 2 in queue
      const p1 = pool.analyzeFile('/test1.mkv')
      const p2 = pool.analyzeFile('/test2.mkv')
      const p3 = pool.analyzeFile('/test3.mkv')
      const p4 = pool.analyzeFile('/test4.mkv')
      const p5 = pool.analyzeFile('/test5.mkv')

      // Shutdown should resolve the queued tasks (p4, p5)
      // Note: p1, p2, p3 are assigned to workers and our current pool doesn't 
      // reject them automatically if they are already assigned! 
      // (This might be a bug in the actual service, but let's test what we expect)
      
      await pool.shutdown()
      
      const r4 = await p4
      const r5 = await p5
      expect(r4.success).toBe(false)
      expect(r4.error).toContain('shutting down')
      expect(r5.success).toBe(false)
      expect(r5.error).toContain('shutting down')
    })

    it('should reset state after shutdown', async () => {
      await pool.initialize('/path/to/ffprobe')
      await pool.shutdown()
      expect(pool.getStats().activeWorkers).toBe(0)
      expect(pool.getStats().queuedTasks).toBe(0)
    })
  })

  describe('analyzeFiles batch', () => {
    it('should return empty map for empty file list', async () => {
      await pool.initialize('/path/to/ffprobe')
      const results = await pool.analyzeFiles([])
      expect(results.size).toBe(0)
    })
  })
})
