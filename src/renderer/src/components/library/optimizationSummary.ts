import type { OptimizationMetricsSummary } from '@main/types/database'

export interface OptimizableItem {
  estimated_savings_bytes?: number | null
}

/**
 * Computes an aggregate OptimizationMetricsSummary for an array of items.
 * Sums known per-item estimated storage savings without inventing missing values.
 */
export function calculateOptimizationSummary(
  items: OptimizableItem[] | undefined | null
): OptimizationMetricsSummary | null {
  if (!items || items.length === 0) return null

  let totalEstimatedSavings = 0
  let hasEstimatedSavings = false

  for (const item of items) {
    if (item.estimated_savings_bytes != null) {
      totalEstimatedSavings += item.estimated_savings_bytes
      hasEstimatedSavings = true
    }
  }

  return {
    estimatedSavingsBytes: hasEstimatedSavings ? totalEstimatedSavings : null,
  }
}
