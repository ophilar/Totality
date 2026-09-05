import { describe, expect, it } from 'vitest'
import { calculateDryRunMetrics } from '@main/services/ShowOptimizationMetricsService'

describe('TV optimization recovery contract', () => {
  it('uses the combined recoverable total as the percentage numerator', () => {
    const result = calculateDryRunMetrics([
      {
        sizeBytes: 1_000_000_000,
        recoverableBytes: 200_000_000,
        efficiency: 80,
        durationSeconds: 1_000,
        audioStreams: [
          { index: 1, codec: 'aac', language: 'en', channels: 2, bit_rate: 192_000 },
          { index: 2, codec: 'aac', language: 'fr', channels: 2, bit_rate: 800_000 },
        ],
      },
    ], 'en')

    expect(result.recoverableBytes).toBe(100_000_000)
    expect(result.videoDebtBytes).toBe(200_000_000)
    expect(result.totalCombinedSavingsBytes).toBe(300_000_000)
    expect(result.percentageSavings).toBeCloseTo(30)
  })

  it('counts an episode as scored only when efficiency evidence exists', () => {
    const result = calculateDryRunMetrics([
      {
        sizeBytes: 1_000_000_000,
        recoverableBytes: 0,
        efficiency: null,
        durationSeconds: 1_000,
        audioStreams: [
          { index: 1, codec: 'aac', language: 'en', channels: 2, bit_rate: 192_000 },
        ],
      },
    ], 'en')

    expect(result.scoredEpisodes).toBe(0)
    expect(result.unscoredEpisodes).toBe(1)
    expect(result.weightedEfficiency).toBeNull()
  })
})
