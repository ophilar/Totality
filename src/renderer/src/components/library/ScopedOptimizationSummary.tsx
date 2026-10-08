import { RecoverableWasteDisplay } from './RecoverableWasteDisplay'

interface ScopedOptimizationSummaryProps {
  totalCount: number
  analyzedCount?: number
  recoverableBytes?: number | null
  className?: string
}

export function ScopedOptimizationSummary({ totalCount, analyzedCount = 0, recoverableBytes, className = '' }: ScopedOptimizationSummaryProps) {
  if (totalCount <= 0) return null
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      <span>{analyzedCount}/{totalCount} analyzed</span>
      {recoverableBytes != null && recoverableBytes > 0 && <span className="flex items-center gap-1">Recoverable <RecoverableWasteDisplay bytes={recoverableBytes} /></span>}
      {analyzedCount < totalCount && <span className="text-amber-300">{totalCount - analyzedCount} not analyzed</span>}
    </div>
  )
}
