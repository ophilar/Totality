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
  const label = summary.coverage === 'insufficient' ? 'Savings not assessed' : summary.coverage === 'partial' ? 'Known estimated savings' : 'Estimated savings'

  return (
    <div className={`flex flex-wrap items-center gap-4 text-xs ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">{label}</span>
        {summary.estimatedSavingsBytes != null && <EstimatedSavingsDisplay bytes={summary.estimatedSavingsBytes} />}
        {summary.coverage !== 'insufficient' && <span>· {summary.coverage}</span>}
      </div>
    </div>
  )
}
