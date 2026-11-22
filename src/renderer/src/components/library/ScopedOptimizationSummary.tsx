import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'
import type { OptimizationMetricsSummary } from '@main/types/database'
import { optimizationCoverageLabel } from './transcoding/optimizationStatus'

interface ScopedOptimizationSummaryProps {
  totalCount: number
  estimatedSavingsBytes?: number | null
  coverage?: OptimizationMetricsSummary['coverage']
  className?: string
}

export function ScopedOptimizationSummary({ totalCount, estimatedSavingsBytes, coverage = 'insufficient', className = '' }: ScopedOptimizationSummaryProps) {
  if (totalCount <= 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      <span className="flex items-center gap-1">
        Estimated savings <EstimatedSavingsDisplay bytes={estimatedSavingsBytes} />
      </span>
      <details><summary className="cursor-pointer">Details</summary><span>Savings evidence: {optimizationCoverageLabel(coverage)}</span></details>
    </div>
  )
}
