import { describe, expect, it } from 'vitest'
import type { QueueState, QueuedTask } from '../../../src/main/types/taskQueue'
import { summarizeOptimizationBatch } from '../../../src/renderer/src/components/library/tv/batchOutcomeSummary'

const task = (mediaItemId: number, status: QueuedTask['status'], createdAt = `2026-01-01T00:00:0${mediaItemId}.000Z`): QueuedTask => ({
  id: `task-${mediaItemId}-${status}`,
  type: 'transcode',
  label: `Episode ${mediaItemId}`,
  batchId: 'batch-a',
  mediaItemId,
  status,
  createdAt,
})

const state = (tasks: QueuedTask[], currentTask: QueuedTask | null = null, queue: QueuedTask[] = [], isPaused = false): QueueState => ({
  currentTask,
  queue,
  completedTasks: tasks,
  isPaused,
})

describe('summarizeOptimizationBatch', () => {
  it('reports success only after every submitted task completes', () => {
    const waiting = summarizeOptimizationBatch(state([task(1, 'completed')]), 'batch-a', [1, 2])
    const complete = summarizeOptimizationBatch(state([task(1, 'completed'), task(2, 'completed')]), 'batch-a', [1, 2])

    expect(waiting.outcome).toBe('incomplete')
    expect(complete.outcome).toBe('completed')
    expect(complete.successfulCount).toBe(2)
  })

  it('separates mixed failed and cancelled outcomes and ignores unrelated queue activity', () => {
    const summary = summarizeOptimizationBatch(state([
      task(1, 'completed'),
      task(2, 'failed'),
      task(3, 'cancelled'),
      { ...task(4, 'failed'), batchId: 'other-batch' },
    ]), 'batch-a', [1, 2, 3])

    expect(summary).toMatchObject({ outcome: 'partly-completed', successfulCount: 1, failedMediaItemIds: [2], cancelledMediaItemIds: [3] })
  })

  it('scopes outcomes to submitted task IDs even when the same batch contains other tasks', () => {
    const summary = summarizeOptimizationBatch(state([
      task(1, 'failed'),
      { ...task(1, 'completed', '2026-01-01T00:00:20.000Z'), id: 'submitted-task' },
      { ...task(2, 'failed'), id: 'unrelated-task' },
    ]), 'batch-a', [1], ['submitted-task'])

    expect(summary).toMatchObject({ outcome: 'completed', successfulCount: 1, failedMediaItemIds: [] })
  })

  it('reports waiting, running, pausing through pause state, and cancelling from actual tasks', () => {
    expect(summarizeOptimizationBatch(state([], null, [task(1, 'queued')]), 'batch-a', [1]).outcome).toBe('waiting')
    expect(summarizeOptimizationBatch(state([], task(1, 'running')), 'batch-a', [1]).outcome).toBe('running')
    expect(summarizeOptimizationBatch(state([], task(1, 'running'), [], true), 'batch-a', [1]).outcome).toBe('paused')
    expect(summarizeOptimizationBatch(state([], task(1, 'cancelling')), 'batch-a', [1]).outcome).toBe('cancelling')
  })
})
