import { describe, expect, it } from 'vitest'
import { aggregateShowOptimizationMetrics } from '@main/services/ShowOptimizationMetricsService'

describe('aggregateShowOptimizationMetrics', () => {
  it('sums known estimated savings across episodes', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, estimatedSavingsBytes: 20 },
      { sizeBytes: 300, estimatedSavingsBytes: 100 },
      { sizeBytes: 0 },
    ])

    expect(result.totalSize).toBe(400)
    expect(result.totalEstimatedSavingsBytes).toBe(120)
  })

  it('does not invent savings for episodes without an estimate', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, estimatedSavingsBytes: 20 },
      { sizeBytes: 900 },
    ])

    expect(result.totalEstimatedSavingsBytes).toBe(20)
  })
})
