import type { QueueState, QueuedTask } from '@main/types/taskQueue'

export type OptimizationBatchOutcome = 'waiting' | 'running' | 'paused' | 'cancelling' | 'completed' | 'partly-completed' | 'failed' | 'cancelled' | 'incomplete'

export interface BatchOutcomeSummary {
  outcome: OptimizationBatchOutcome
  successfulCount: number
  failedMediaItemIds: number[]
  cancelledMediaItemIds: number[]
  partialCount: number
  activeCount: number
}

export function summarizeOptimizationBatch(queue: QueueState, batchId: string, submittedMediaItemIds: number[], submittedTaskIds: string[] = []): BatchOutcomeSummary {
  const submittedIds = new Set(submittedMediaItemIds)
  const submittedTaskIdSet = new Set(submittedTaskIds)
  const matchesOperation = (task: QueuedTask) => task.batchId === batchId &&
    (submittedTaskIdSet.size > 0 ? submittedTaskIdSet.has(task.id) : task.mediaItemId !== undefined && submittedIds.has(task.mediaItemId))
  const currentAndQueued = [queue.currentTask, ...queue.queue].filter((task): task is QueuedTask => task !== null && matchesOperation(task))
  const terminalTasks = queue.completedTasks.filter(matchesOperation)
  const latestTaskByMediaItemId = new Map<number, QueuedTask>()
  for (const task of [...terminalTasks, ...currentAndQueued].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    if (task.mediaItemId !== undefined && !latestTaskByMediaItemId.has(task.mediaItemId)) latestTaskByMediaItemId.set(task.mediaItemId, task)
  }
  const activeCount = currentAndQueued.length
  const successfulCount = [...latestTaskByMediaItemId.values()].filter(task => task.status === 'completed').length
  const failedMediaItemIds = [...latestTaskByMediaItemId.values()].filter(task => task.status === 'failed').map(task => task.mediaItemId!)
  const cancelledMediaItemIds = [...latestTaskByMediaItemId.values()].filter(task => task.status === 'cancelled').map(task => task.mediaItemId!)
  const partialCount = [...latestTaskByMediaItemId.values()].filter(task => task.status === 'partial').length

  let outcome: OptimizationBatchOutcome
  if (queue.currentTask?.batchId === batchId && queue.currentTask.status === 'cancelling') outcome = 'cancelling'
  else if (activeCount > 0 && queue.isPaused) outcome = 'paused'
  else if (activeCount > 0 && !queue.currentTask) outcome = 'waiting'
  else if (activeCount > 0) outcome = 'running'
  else if (submittedIds.size === 0 || latestTaskByMediaItemId.size < submittedIds.size) outcome = 'incomplete'
  else if (partialCount > 0 || successfulCount > 0 && (failedMediaItemIds.length > 0 || cancelledMediaItemIds.length > 0)) outcome = 'partly-completed'
  else if (failedMediaItemIds.length > 0) outcome = 'failed'
  else if (cancelledMediaItemIds.length > 0) outcome = 'cancelled'
  else outcome = 'completed'

  return { outcome, successfulCount, failedMediaItemIds, cancelledMediaItemIds, partialCount, activeCount }
}
