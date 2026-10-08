import React from 'react'
import type { OptimizationMetricsSummary } from '@main/types/database'
import { EfficiencyDisplay } from './EfficiencyDisplay'
import { RecoverableWasteDisplay } from './RecoverableWasteDisplay'

export interface OptimizationMetricsProps {
  summary?: OptimizationMetricsSummary | null
  className?: string
}

export const OptimizationMetrics: React.FC<OptimizationMetricsProps> = ({
  summary,
  className = ''
}) => {
  if (!summary) return null

  return (
    <div className={`flex flex-wrap items-center gap-4 text-xs ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Efficiency:</span>
        <EfficiencyDisplay score={summary.overallEfficiencyScore} status={summary.status} />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Recoverable:</span>
        <RecoverableWasteDisplay bytes={summary.recoverableWasteBytes} />
      </div>

      {typeof summary.totalCount === 'number' && summary.totalCount > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span>{summary.knownCount ?? 0}/{summary.totalCount} items analyzed</span>
          {typeof summary.confidenceScore === 'number' && (
            <span className="ml-1.5 font-medium">({summary.confidenceScore}% coverage)</span>
          )}
        </div>
      )}
    </div>
  )
}
