import { describe, expect, it } from 'vitest'
import { calculateDryRunMetrics } from '@main/services/ShowOptimizationMetricsService'

describe('TV estimated savings contract', () => {
  it('does not double-count fresh audio pruning included in the combined estimate', () => {
    const result = calculateDryRunMetrics([
      {
        sizeBytes: 1_000_000_000,
        estimatedSavingsBytes: 200_000_000,
        durationSeconds: 1_000,
        audioStreams: [
          { index: 1, codec: 'aac', language: 'en', channels: 2, bit_rate: 192_000 },
          { index: 2, codec: 'aac', language: 'fr', channels: 2, bit_rate: 800_000 },
        ],
      },
    ], 'en')

    expect(result.audioPruningBytes).toBe(100_000_000)
    expect(result.videoSavingsBytes).toBe(100_000_000)
    expect(result.totalEstimatedSavingsBytes).toBe(200_000_000)
    expect(result.percentageSavings).toBeCloseTo(20)
  })

  it('adds fresh audio pruning to an explicit video savings estimate', () => {
    const result = calculateDryRunMetrics([
      {
        sizeBytes: 1_000_000_000,
        videoSavingsBytes: 200_000_000,
        durationSeconds: 1_000,
        audioStreams: [
          { index: 1, codec: 'aac', language: 'en', channels: 2, bit_rate: 192_000 },
          { index: 2, codec: 'aac', language: 'fr', channels: 2, bit_rate: 800_000 },
        ],
      },
    ], 'en')

    expect(result.audioPruningBytes).toBe(100_000_000)
    expect(result.videoSavingsBytes).toBe(200_000_000)
    expect(result.totalEstimatedSavingsBytes).toBe(300_000_000)
    expect(result.percentageSavings).toBeCloseTo(30)
  })

  it('keeps zero estimated savings distinct from missing evidence', () => {
    const result = calculateDryRunMetrics([
      {
        sizeBytes: 1_000_000_000,
        videoSavingsBytes: 0,
        durationSeconds: 1_000,
        audioStreams: [
          { index: 1, codec: 'aac', language: 'en', channels: 2, bit_rate: 192_000 },
        ],
      },
    ], 'en')

    expect(result.totalEstimatedSavingsBytes).toBe(0)
    expect(result.coverage).toBe('partial')
  })
})
