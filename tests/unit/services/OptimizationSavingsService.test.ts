import { describe, expect, it } from 'vitest'
import { buildOptimizationSavingsBreakdown } from '@main/services/OptimizationSavingsService'

describe('buildOptimizationSavingsBreakdown', () => {
  it('sums known non-overlapping components and uses that total for percentage', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoDebtBytes: 200,
      audioPruningBytes: 100,
      audioTranscodeBytes: 50,
    })

    expect(result.totalRecoverableBytes).toBe(350)
    expect(result.percentageSavings).toBe(35)
    expect(result.coverage).toBe('complete')
  })

  it('preserves unknown component evidence as partial rather than zero', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoDebtBytes: 200,
      audioPruningBytes: null,
      audioTranscodeBytes: null,
    })

    expect(result.videoDebtBytes).toBe(200)
    expect(result.audioPruningBytes).toBeNull()
    expect(result.audioTranscodeBytes).toBeNull()
    expect(result.totalRecoverableBytes).toBe(200)
    expect(result.percentageSavings).toBe(20)
    expect(result.coverage).toBe('partial')
  })

  it('reports insufficient coverage when no recovery component is evidenced', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoDebtBytes: null,
      audioPruningBytes: null,
      audioTranscodeBytes: null,
    })

    expect(result.totalRecoverableBytes).toBe(0)
    expect(result.percentageSavings).toBe(0)
    expect(result.coverage).toBe('insufficient')
  })

  it('does not invent a percentage when total size is unknown or zero', () => {
    expect(buildOptimizationSavingsBreakdown({
      totalBytes: null,
      videoDebtBytes: 100,
      audioPruningBytes: 50,
      audioTranscodeBytes: 0,
    }).percentageSavings).toBeNull()

    expect(buildOptimizationSavingsBreakdown({
      totalBytes: 0,
      videoDebtBytes: 100,
      audioPruningBytes: 50,
      audioTranscodeBytes: 0,
    }).percentageSavings).toBeNull()
  })
})
