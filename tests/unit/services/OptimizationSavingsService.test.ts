import { describe, expect, it } from 'vitest'
import { buildOptimizationSavingsBreakdown, calculateBitrateSavingsBytes, calculateBytesAtBitrateKbps, projectMeasuredSavingsBytes, projectSavingsRate } from '@main/services/OptimizationSavingsService'

describe('shared savings calculations', () => {
  it('converts bitrate and duration to bytes consistently', () => {
    expect(calculateBytesAtBitrateKbps(1_000, 60)).toBe(7_500_000)
    expect(calculateBitrateSavingsBytes(1_000, 128, 60)).toBe(6_540_000)
  })

  it('projects measured sample output across a representative episode and show', () => {
    const representativeSavings = projectMeasuredSavingsBytes(1_000_000_000, 3_600, 80_000_000, 300)
    expect(representativeSavings).toBe(40_000_000)
    expect(projectSavingsRate(1_000_000_000, representativeSavings, 2_000_000_000)).toBe(80_000_000)
  })
})

describe('buildOptimizationSavingsBreakdown', () => {
  it('sums known non-overlapping components and uses that total for percentage', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: 200,
      audioPruningBytes: 100,
      audioTranscodeBytes: 50,
    })

    expect(result.totalEstimatedSavingsBytes).toBe(350)
    expect(result.percentageSavings).toBe(35)
    expect(result.coverage).toBe('complete')
  })

  it('preserves unknown component evidence as partial rather than zero', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: 200,
      audioPruningBytes: null,
      audioTranscodeBytes: null,
    })

    expect(result.videoSavingsBytes).toBe(200)
    expect(result.audioPruningBytes).toBeNull()
    expect(result.audioTranscodeBytes).toBeNull()
    expect(result.totalEstimatedSavingsBytes).toBe(200)
    expect(result.percentageSavings).toBe(20)
    expect(result.coverage).toBe('partial')
  })

  it('reports insufficient coverage when no savings component is evidenced', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: null,
      audioPruningBytes: null,
      audioTranscodeBytes: null,
    })

    expect(result.totalEstimatedSavingsBytes).toBe(0)
    expect(result.percentageSavings).toBe(0)
    expect(result.coverage).toBe('insufficient')
  })

  it('does not invent a percentage when total size is unknown or zero', () => {
    expect(buildOptimizationSavingsBreakdown({
      totalBytes: null,
      videoSavingsBytes: 100,
      audioPruningBytes: 50,
      audioTranscodeBytes: 0,
    }).percentageSavings).toBeNull()

    expect(buildOptimizationSavingsBreakdown({
      totalBytes: 0,
      videoSavingsBytes: 100,
      audioPruningBytes: 50,
      audioTranscodeBytes: 0,
    }).percentageSavings).toBeNull()
  })

  it('caps every component at the source file size', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 100,
      videoSavingsBytes: 200,
      audioPruningBytes: 150,
      audioTranscodeBytes: null,
    })

    expect(result.videoSavingsBytes).toBe(100)
    expect(result.audioPruningBytes).toBe(100)
    expect(result.totalEstimatedSavingsBytes).toBe(100)
  })
})
