import React from 'react'
import type { OptimizationMetricsSummary } from '@main/types/database'
import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'

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
        <span className="text-muted-foreground">Est. savings</span>
        <EstimatedSavingsDisplay bytes={summary.estimatedSavingsBytes} />
      </div>
    </div>
  )
}
