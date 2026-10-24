import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'
import type { OptimizationMetricsSummary } from '@main/types/database'

interface ScopedOptimizationSummaryProps {
  totalCount: number
  estimatedSavingsBytes?: number | null
  coverage?: OptimizationMetricsSummary['coverage']
  className?: string
}

export function ScopedOptimizationSummary({ totalCount, estimatedSavingsBytes, coverage = 'insufficient', className = '' }: ScopedOptimizationSummaryProps) {
  if (totalCount <= 0) return null
  const label = coverage === 'insufficient' ? 'Savings not assessed' : coverage === 'partial' ? 'Known estimated savings' : 'Estimated savings'
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      <span className="flex items-center gap-1" title={coverage === 'insufficient' ? 'No measured stream removals or configured conversion estimates are available yet.' : undefined}>
        {label} {estimatedSavingsBytes != null && <EstimatedSavingsDisplay bytes={estimatedSavingsBytes} />}
        {coverage !== 'insufficient' && <span>· {coverage}</span>}
      </span>
    </div>
  )
}
