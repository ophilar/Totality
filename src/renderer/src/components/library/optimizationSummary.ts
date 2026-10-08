import type { OptimizationMetricsSummary, CalculationStatus } from '@main/types/database'

export interface OptimizableItem {
  file_size?: number | null
  storage_debt_bytes?: number | null
  efficiency_score?: number | null
}

/**
 * Computes an aggregate OptimizationMetricsSummary for an array of items.
 * Uses real positive file size weighting when sizes are available,
 * falling back to an unweighted mean if sizes are missing.
 * Avoids synthetic or fake byte counts.
 */
export function calculateOptimizationSummary(
  items: OptimizableItem[] | undefined | null,
  totalItemCount?: number
): OptimizationMetricsSummary | null {
  if (!items || items.length === 0) return null

  let knownCount = 0
  let weightedScoreSum = 0
  let weightedSizeSum = 0
  let unweightedScoreSum = 0
  let totalDebt = 0
  let hasAnyDebt = false

  for (const item of items) {
    if (item.efficiency_score != null) {
      knownCount++
      unweightedScoreSum += item.efficiency_score
      const size = item.file_size
      if (size != null && size > 0) {
        weightedScoreSum += item.efficiency_score * size
        weightedSizeSum += size
      }
    }
    if (item.storage_debt_bytes != null) {
      totalDebt += item.storage_debt_bytes
      hasAnyDebt = true
    }
  }

  const totalCount = totalItemCount || items.length
  const overallEfficiencyScore = knownCount > 0
    ? Math.round(weightedSizeSum > 0 ? weightedScoreSum / weightedSizeSum : unweightedScoreSum / knownCount)
    : null

  const status: CalculationStatus = knownCount === totalCount && totalCount > 0
    ? 'complete'
    : knownCount > 0
      ? 'partial'
      : 'unknown'

  return {
    recoverableBytes: hasAnyDebt ? totalDebt : null,
    wasteBytes: hasAnyDebt ? totalDebt : null,
    efficiency: overallEfficiencyScore,
    savingsBasis: hasAnyDebt ? 'measured' : null,
    evidenceStatus: status === 'complete' ? 'measured' : status === 'partial' ? 'estimated' : 'insufficient',
    confidence: status === 'complete' ? 'high' : status === 'partial' ? 'medium' : 'none',
    status,
    calculationStatus: status === 'complete' ? 'measured' : status === 'partial' ? 'estimated' : 'unavailable',
    knownCount,
    totalCount,
    overallEfficiencyScore,
    recoverableWasteBytes: hasAnyDebt ? totalDebt : null,
    confidenceScore: totalCount > 0 ? Math.round((knownCount / totalCount) * 100) : 0,
  }
}
