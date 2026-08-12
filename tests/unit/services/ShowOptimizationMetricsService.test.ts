import { describe, expect, it } from 'vitest'
import { aggregateShowOptimizationMetrics } from '@main/services/ShowOptimizationMetricsService'

describe('aggregateShowOptimizationMetrics', () => {
  it('sums waste and size-weights scored episodes', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, recoverableBytes: 20, efficiency: 0.5 },
      { sizeBytes: 300, recoverableBytes: 100, efficiency: 0.9 },
      { sizeBytes: 0, recoverableBytes: null, efficiency: null }
    ])
    expect(result.totalSize).toBe(400)
    expect(result.totalRecoverableBytes).toBe(120)
    expect(result.weightedEfficiency).toBeCloseTo(0.8)
    expect(result.scoredEpisodeCount).toBe(2)
    expect(result.unscoredEpisodeCount).toBe(1)
  })

  it('weights only the bytes of scored episodes', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, recoverableBytes: 20, efficiency: 0.5 },
      { sizeBytes: 900, recoverableBytes: null, efficiency: null },
    ])

    expect(result.weightedEfficiency).toBeCloseTo(0.5)
    expect(result.unscoredEpisodeCount).toBe(1)
  })
})
