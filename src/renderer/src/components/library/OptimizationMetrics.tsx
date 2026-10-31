import React from 'react'
import type { OptimizationMetricsSummary } from '@main/types/database'
import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'
import { optimizationCoverageLabel } from './transcoding/optimizationStatus'

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
        <span className="text-muted-foreground">Estimated savings</span>
        <EstimatedSavingsDisplay bytes={summary.estimatedSavingsBytes} />
      </div>
      {summary.coverage && <details className="text-muted-foreground"><summary className="cursor-pointer">Details</summary><span>Savings evidence: {optimizationCoverageLabel(summary.coverage)}</span></details>}
    </div>
  )
}
