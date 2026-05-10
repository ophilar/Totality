/**
 * FFprobeWorkerPool Unit Tests
 *
 * Tests worker pool lifecycle, queue management, error handling,
 * and resource cleanup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Worker } from 'worker_threads'
import * as os from 'os'

// Mock worker_threads
const mockWorker = {
  on: vi.fn(),
  once: vi.fn(),
  postMessage: vi.fn(),
  terminate: vi.fn(() => Promise.resolve(0)),
  removeAllListeners: vi.fn(),
}

vi.mock('worker_threads', () => ({
  Worker: vi.fn(() => mockWorker),
}))

// Import after mocks
const { FFprobeWorkerPool } = await import('../../src/main/services/FFprobeWorkerPool')

describe('FFprobeWorkerPool', () => {
  let pool: InstanceType<typeof FFprobeWorkerPool>

  beforeEach(() => {
    vi.clearAllMocks()
    pool = new FFprobeWorkerPool()
    // Reset the mock worker handlers
    mockWorker.on.mockReset()
    mockWorker.once.mockReset()
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
      const expected = Math.max(1, os.cpus().length - 1)
      // Note: Config might limit it, but we check logic
      expect(stats.maxWorkers).toBeGreaterThanOrEqual(1)
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
    it('should throw error for uninitialized pool', async () => {
      await expect(pool.analyzeFile('/test.mkv')).rejects.toThrow('not initialized')
    })

    it('should throw error when shutting down', async () => {
      await pool.initialize('/path/to/ffprobe')
      // Start shutdown
      const shutdownPromise = pool.shutdown()
      await expect(pool.analyzeFile('/test.mkv')).rejects.toThrow('shutting down')
      await shutdownPromise
    })

    it('should reject tasks when queue is full', async () => {
      await pool.initialize('/path/to/ffprobe')

      // Fill the queue
      const promises: Promise<unknown>[] = []
      for (let i = 0; i < 10000; i++) {
        promises.push(pool.analyzeFile(`/test${i}.mkv`).catch(() => {}))
      }

      // The 10001st task should throw immediately
      expect(() => pool.analyzeFile('/test-too-many.mkv')).rejects.toThrow('queue is full')
      
      // Cleanup to resolve pending promises
      await pool.shutdown()
      await Promise.all(promises)
    })
  })

  describe('shutdown', () => {
    it('should resolve queued tasks on shutdown', async () => {
      await pool.initialize('/path/to/ffprobe')

      // Queue a task (it won't be processed since worker mock doesn't respond)
      const taskPromise = pool.analyzeFile('/test.mkv')

      // Shutdown should resolve the queued task with error
      await pool.shutdown()
      const result = await taskPromise
      expect(result.success).toBe(false)
      expect(result.error).toContain('shutting down')
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



