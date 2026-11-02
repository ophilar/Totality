/**
 * FFprobeWorkerPool tests use the real worker thread and worker implementation.
 */

import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FFprobeWorkerPool } from '../../src/main/services/FFprobeWorkerPool'

describe('FFprobeWorkerPool', () => {
  let workerScriptPath: string
  let workerBuildDirectory: string
  let unavailableFFprobePath: string
  let pool: FFprobeWorkerPool

  beforeAll(async () => {
    workerBuildDirectory = await mkdtemp(path.join(tmpdir(), 'totality-ffprobe-worker-'))
    workerScriptPath = path.join(workerBuildDirectory, 'ffprobe-worker.cjs')
    await build({
      entryPoints: [path.resolve('src/main/workers/ffprobe-worker.ts')],
      outfile: workerScriptPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
    })
  })

  beforeEach(() => {
    pool = new FFprobeWorkerPool(workerScriptPath)
    unavailableFFprobePath = path.join(tmpdir(), `totality-missing-ffprobe-${randomUUID()}`)
  })

  afterEach(async () => {
    const { activeWorkers, queuedTasks } = pool.getStats()
    if (activeWorkers > 0 || queuedTasks > 0) {
      await pool.shutdown()
    }
  })

  afterAll(async () => {
    await rm(workerBuildDirectory, { recursive: true })
  })

  it('starts uninitialized and bounds its worker count by available CPUs', () => {
    expect(pool.getStats()).toMatchObject({
      activeWorkers: 0,
      queuedTasks: 0,
    })
    expect(pool.getStats().maxWorkers).toBeGreaterThan(0)
    expect(pool.getStats().maxWorkers).toBeLessThanOrEqual(4)
  })

  it('allows setting worker count within the supported bounds', () => {
    pool.setMaxWorkers(2)
    expect(pool.getStats().maxWorkers).toBe(2)

    pool.setMaxWorkers(0)
    expect(pool.getStats().maxWorkers).toBe(1)

    pool.setMaxWorkers(100)
    expect(pool.getStats().maxWorkers).toBe(16)
  })

  it('initializes once and analyzes a file through the real worker', async () => {
    await pool.initialize(unavailableFFprobePath)
    await pool.initialize('/unused/second-ffprobe-path')

    const result = await pool.analyzeFile('/file-that-does-not-exist.mkv')

    expect(result.success).toBe(false)
    expect(result.filePath).toBe('/file-that-does-not-exist.mkv')
    expect(result.error).toBeTruthy()
  })

  it('returns an error when a file is submitted before initialization', async () => {
    const result = await pool.analyzeFile('/test.mkv')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not initialized')
  })

  it('returns an error when a file is submitted during shutdown', async () => {
    await pool.initialize(unavailableFFprobePath)
    const shutdown = pool.shutdown()

    const result = await pool.analyzeFile('/test.mkv')
    expect(result.success).toBe(false)
    expect(result.error).toContain('shutting down')

    await shutdown
  })

  it('rejects work beyond the queue limit and resolves accepted work on shutdown', async () => {
    pool.setMaxWorkers(1)
    await pool.initialize(unavailableFFprobePath)

    const tasks = Array.from({ length: 10_002 }, (_, index) =>
      pool.analyzeFile(`/test-${index}.mkv`)
    )

    await expect(tasks[10_001]).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('queue is full'),
    })

    await pool.shutdown()
    const results = await Promise.all(tasks)
    expect(results).toHaveLength(10_002)
    expect(results.every(result => !result.success)).toBe(true)
  })

  it('returns an empty map for an empty batch', async () => {
    await pool.initialize(unavailableFFprobePath)
    await expect(pool.analyzeFiles([])).resolves.toEqual(new Map())
  })

  it('resolves all queued work when workers are shut down', async () => {
    await pool.initialize(unavailableFFprobePath)
    const task = pool.analyzeFile('/test.mkv')

    await pool.shutdown()

    const result = await task
    expect(result.success).toBe(false)
    expect(result.error).toContain('shutting down')
  })

  it('resets state after shutdown', async () => {
    await pool.initialize(unavailableFFprobePath)
    await pool.shutdown()

    expect(pool.getStats().activeWorkers).toBe(0)
    expect(pool.getStats().queuedTasks).toBe(0)
  })
})
