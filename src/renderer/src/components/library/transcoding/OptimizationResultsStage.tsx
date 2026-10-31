import type { ReactNode } from 'react'
import type { BatchOutcomeSummary } from '../tv/batchOutcomeSummary'
import { OptimizationBatchSummary, type OptimizationQueueControlState } from './OptimizationBatchSummary'
import { OptimizationTaskResults } from './OptimizationTaskResults'
import type { QueuedTask } from '@main/types/taskQueue'

export function OptimizationResultsStage({
  summary,
  queuePaused,
  waitingCount,
  queueControlState,
  retryDisabled,
  showBatchSummary = true,
  tasks,
  onTogglePause,
  onRetry,
  onOpenQueue,
  children,
}: {
  summary: BatchOutcomeSummary | null
  queuePaused: boolean
  waitingCount: number
  queueControlState: OptimizationQueueControlState
  retryDisabled?: boolean
  showBatchSummary?: boolean
  tasks: QueuedTask[]
  onTogglePause: () => void
  onRetry: () => void
  onOpenQueue: () => void
  children?: ReactNode
}) {
  return <section aria-label="Optimization results" className="space-y-6 p-5 sm:p-6">
    {showBatchSummary && <OptimizationBatchSummary summary={summary} queuePaused={queuePaused} waitingCount={waitingCount} queueControlState={queueControlState} retryDisabled={retryDisabled} onTogglePause={onTogglePause} onRetry={onRetry} onOpenQueue={onOpenQueue} />}
    <OptimizationTaskResults tasks={tasks} />
    {children}
  </section>
}
