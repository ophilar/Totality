import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'

interface ScopedOptimizationSummaryProps {
  totalCount: number
  estimatedSavingsBytes?: number | null
  className?: string
}

export function ScopedOptimizationSummary({ totalCount, estimatedSavingsBytes, className = '' }: ScopedOptimizationSummaryProps) {
  if (totalCount <= 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      <span className="flex items-center gap-1">Est. savings <EstimatedSavingsDisplay bytes={estimatedSavingsBytes} /></span>
    </div>
  )
}
