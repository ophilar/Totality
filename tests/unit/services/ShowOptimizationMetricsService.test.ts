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

  it('correctly aggregates integer percentage efficiency scores (0-100 scale)', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 2000, recoverableBytes: 500, efficiency: 80 },
      { sizeBytes: 8000, recoverableBytes: 2000, efficiency: 90 }
    ])
    // (80 * 2000 + 90 * 8000) / 10000 = (160000 + 720000) / 10000 = 88
    expect(result.weightedEfficiency).toBe(88)
    expect(result.totalSize).toBe(10000)
    expect(result.totalRecoverableBytes).toBe(2500)
    expect(result.scoredEpisodeCount).toBe(2)
    expect(result.unscoredEpisodeCount).toBe(0)
  })

  it('falls back to simple average when all scored episodes have 0 size', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 0, recoverableBytes: 0, efficiency: 80 },
      { sizeBytes: 0, recoverableBytes: 0, efficiency: 90 }
    ])
    expect(result.weightedEfficiency).toBe(85)
    expect(result.scoredEpisodeCount).toBe(2)
  })

  it('returns null weightedEfficiency when no episodes are scored', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 1000, recoverableBytes: null, efficiency: null }
    ])
    expect(result.weightedEfficiency).toBeNull()
    expect(result.scoredEpisodeCount).toBe(0)
    expect(result.unscoredEpisodeCount).toBe(1)
  })
})

