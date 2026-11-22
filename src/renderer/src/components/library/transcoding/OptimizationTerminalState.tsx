import { CheckCircle2, RefreshCw } from 'lucide-react'

export function OptimizationTerminalState({ state, itemLabel, error, onClose, onRetry }: {
  state: 'complete' | 'failed'
  itemLabel?: string
  error?: string | null
  onClose: () => void
  onRetry?: () => void
}) {
  const complete = state === 'complete'
  return <section className="mx-auto max-w-xl space-y-4 py-8 text-center" aria-label={complete ? 'Optimization complete' : 'Optimization failed'} role="status">
    {complete && <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" aria-hidden="true" />}
    <div className="space-y-1">
      <h3 className={`text-xl font-bold ${complete ? '' : 'text-destructive'}`}>{complete ? 'Optimization complete' : 'Optimization failed'}</h3>
      {itemLabel && <p className="text-sm text-muted-foreground">{itemLabel}</p>}
      {!complete && error && <details className="pt-1 text-left text-xs"><summary className="cursor-pointer text-muted-foreground">Error details</summary><p className="break-words pt-1 text-muted-foreground">{error}</p></details>}
    </div>
    <div className="flex flex-wrap justify-center gap-2">
      <button type="button" onClick={onClose} className="rounded-lg bg-muted px-5 py-2.5 text-sm font-semibold hover:bg-muted/80">Close</button>
      {!complete && onRetry && <button type="button" onClick={onRetry} className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><RefreshCw className="h-4 w-4" />Retry optimization</button>}
    </div>
  </section>
}
