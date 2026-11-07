import type { QueuedTask } from '@main/types/taskQueue'
import { formatOptimizationBytes, sumKnownResultBytes } from './optimizationResults'

function taskStatusLabel(status: QueuedTask['status']): string {
  if (status === 'completed') return 'Completed'
  if (status === 'partial') return 'Partially completed'
  if (status === 'cancelled') return 'Cancelled'
  return 'Failed'
}

export function OptimizationTaskResults({ tasks }: { tasks: QueuedTask[] }) {
  if (tasks.length === 0) return null
  const completedResults = tasks
    .filter(task => task.status === 'completed')
    .map(task => (task.result as Record<string, unknown> | undefined) ?? {})
  const measuredSavings = sumKnownResultBytes(completedResults, 'encodedReductionBytes')
  const spaceFreed = sumKnownResultBytes(completedResults, 'physicallyReclaimedBytes')

  return <section className="space-y-2 rounded-xl border border-border/30 p-3" aria-label="File results">
    <h3 className="text-sm font-semibold">File results</h3>
    {completedResults.length > 0 && <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-lg bg-muted/20 p-3 text-xs text-muted-foreground sm:grid-cols-2">
      <div className="flex justify-between gap-2"><dt>Measured savings</dt><dd>{measuredSavings === null ? 'Not measured' : formatOptimizationBytes(measuredSavings)}</dd></div>
      <div className="flex justify-between gap-2"><dt>Space freed</dt><dd>{spaceFreed === null ? 'Not measured' : formatOptimizationBytes(spaceFreed)}</dd></div>
    </dl>}
    <ul className="space-y-2 text-xs">{tasks.map(task => <li key={task.id} className="space-y-1 border-t border-border/20 pt-2 first:border-0 first:pt-0">
      <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{task.label}</span><span className={task.status === 'completed' ? 'text-muted-foreground' : 'text-destructive'}>{taskStatusLabel(task.status)}</span></div>
      {task.status === 'completed' ? <>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-muted-foreground sm:grid-cols-2">
          <div className="flex justify-between gap-2"><dt>Measured savings</dt><dd>{typeof task.result?.encodedReductionBytes === 'number' ? formatOptimizationBytes(task.result.encodedReductionBytes) : 'Not measured'}</dd></div>
          <div className="flex justify-between gap-2"><dt>Space freed</dt><dd>{typeof task.result?.physicallyReclaimedBytes === 'number' ? formatOptimizationBytes(task.result.physicallyReclaimedBytes) : 'Not measured'}</dd></div>
        </dl>
        {task.result && typeof task.result.outputBytes === 'number' && <p className="text-muted-foreground">Output: {formatOptimizationBytes(task.result.outputBytes)}</p>}
        {task.result && typeof task.result.retainedOriginalBytes === 'number' && task.result.retainedOriginalBytes > 0 && <p className="text-muted-foreground">Original backup: {formatOptimizationBytes(task.result.retainedOriginalBytes)}</p>}
        {task.result?.qualityVerification && <details className="text-muted-foreground"><summary className="cursor-pointer">Quality details</summary><p className="pt-1">VMAF {task.result.qualityVerification.vmafMean.toFixed(2)} · CAMBI {task.result.qualityVerification.cambiMean.toFixed(2)}</p></details>}
      </> : task.error ? <details className="text-destructive"><summary className="cursor-pointer">Details</summary><p className="break-words pt-1">{task.error}</p></details> : null}
    </li>)}</ul>
  </section>
}
