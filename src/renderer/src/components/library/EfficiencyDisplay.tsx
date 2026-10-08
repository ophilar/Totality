import React from 'react'
import type { CalculationStatus } from '@main/types/database'

export interface EfficiencyDisplayProps {
  score?: number | null
  status?: CalculationStatus
  showBadge?: boolean
  className?: string
}

export const EfficiencyDisplay: React.FC<EfficiencyDisplayProps> = ({
  score,
  status,
  showBadge = true,
  className = ''
}) => {
  if (score == null || score < 0) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <span className="text-xs text-muted-foreground font-mono" title="Efficiency score unknown or unscored">
          --
        </span>
        {status && status !== 'complete' && (
          <span className="text-[10px] text-muted-foreground bg-muted/60 px-1 py-0.2 rounded font-sans">
            {status}
          </span>
        )}
      </div>
    )
  }

  const rounded = Math.round(score)
  const colorClass =
    rounded >= 85
      ? 'bg-green-500/20 text-green-500'
      : rounded >= 60
      ? 'bg-yellow-500/20 text-yellow-500'
      : 'bg-red-500/20 text-red-500'

  if (!showBadge) {
    return (
      <span className={`text-xs font-mono font-bold ${colorClass.split(' ')[1]} ${className}`}>
        {rounded}%
      </span>
    )
  }

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block font-mono ${colorClass}`}>
        {rounded}%
      </span>
      {status === 'partial' && (
        <span className="text-[10px] text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 px-1 py-0.2 rounded font-sans" title="Partial calculation based on available scored items">
          partial
        </span>
      )}
    </div>
  )
}
