import type { ReactNode } from 'react'
import { EstimatedSavingsDisplay } from '../EstimatedSavingsDisplay'
import { optimizationCoverageLabel } from './optimizationStatus'

export function OptimizationReviewSummary({
  title = 'Review',
  estimatedSavingsBytes,
  coverage,
  scopeSummary,
  children,
}: {
  title?: string
  estimatedSavingsBytes?: number | null
  coverage?: string
  scopeSummary?: string
  children?: ReactNode
}) {
  return <section className="space-y-3 rounded-xl border border-border/40 bg-muted/20 p-4" aria-label={title}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <span className="text-sm">Estimated savings: <EstimatedSavingsDisplay bytes={estimatedSavingsBytes} /></span>
    </div>
    {scopeSummary && <p className="text-xs text-muted-foreground">{scopeSummary}</p>}
    {coverage && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Evidence details</summary><p className="pt-1">Savings evidence: {optimizationCoverageLabel(coverage)}</p></details>}
    {children}
  </section>
}
