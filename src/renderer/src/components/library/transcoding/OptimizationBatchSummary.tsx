import type { BatchOutcomeSummary } from '../tv/batchOutcomeSummary'

export type OptimizationQueueControlState = 'pausing' | 'resuming' | null

export function OptimizationBatchSummary({
  summary,
  queuePaused,
  waitingCount,
  queueControlState,
  retryDisabled = false,
  onTogglePause,
  onRetry,
  onOpenQueue,
}: {
  summary: BatchOutcomeSummary | null
  queuePaused: boolean
  waitingCount: number
  queueControlState: OptimizationQueueControlState
  retryDisabled?: boolean
  onTogglePause: () => void
  onRetry: () => void
  onOpenQueue?: () => void
}) {
  if (!summary) return null
  const status = summary.outcome === 'partly-completed' ? 'Partly completed'
    : summary.outcome === 'incomplete' ? 'In progress'
      : summary.outcome.charAt(0).toUpperCase() + summary.outcome.slice(1)
  const failedCount = summary.failedMediaItemIds.length + summary.cancelledMediaItemIds.length

  return <section className="space-y-3 rounded-xl border border-border/40 bg-muted/20 p-4" aria-live="polite">
    <h3 className="font-semibold">{status}</h3>
    <p className="text-xs text-muted-foreground">Completed {summary.successfulCount} · Partial {summary.partialCount} · Failed {summary.failedMediaItemIds.length} · Cancelled {summary.cancelledMediaItemIds.length}{waitingCount ? ` · Waiting ${waitingCount}` : ''}</p>
    <div className="flex flex-wrap gap-3 text-xs">
      {summary.activeCount > 0 && <button type="button" disabled={queueControlState !== null} onClick={onTogglePause} className="text-primary underline disabled:opacity-50">{queueControlState === 'pausing' ? 'Pausing…' : queueControlState === 'resuming' ? 'Resuming…' : queuePaused ? 'Resume queue' : 'Pause queue'}</button>}
      {failedCount > 0 && summary.activeCount === 0 && <button type="button" disabled={retryDisabled} onClick={onRetry} className="text-primary underline disabled:opacity-50">Retry failed or cancelled</button>}
      {onOpenQueue && <button type="button" onClick={onOpenQueue} className="text-primary underline">Open Task Queue</button>}
    </div>
  </section>
}
