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
    expect(result.coverage).toBe('partial')
  })

  it('does not invent savings for episodes without an estimate', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, estimatedSavingsBytes: 20 },
      { sizeBytes: 900 },
    ])

    expect(result.totalEstimatedSavingsBytes).toBe(20)
    expect(result.coverage).toBe('partial')
  })

  it('returns no numeric series total when no episode has savings evidence', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100 },
      { sizeBytes: 900, estimatedSavingsBytes: null },
    ])

    expect(result.totalEstimatedSavingsBytes).toBeNull()
    expect(result.coverage).toBe('insufficient')
  })

  it('preserves an evidenced zero when all planned episodes have complete coverage', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, estimatedSavingsBytes: 0, savingsCoverage: 'complete' },
      { sizeBytes: 200, estimatedSavingsBytes: 0, savingsCoverage: 'complete' },
    ])

    expect(result.totalEstimatedSavingsBytes).toBe(0)
    expect(result.coverage).toBe('complete')
  })

  it('caps the series total at the combined episode source size', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, estimatedSavingsBytes: 90, savingsCoverage: 'complete' },
      { sizeBytes: 200, estimatedSavingsBytes: 250, savingsCoverage: 'complete' },
    ])

    expect(result.totalEstimatedSavingsBytes).toBe(300)
  })

  it('keeps evidenced savings when a source size is missing and marks the series partial', () => {
    const result = aggregateShowOptimizationMetrics([
      { sizeBytes: 100, estimatedSavingsBytes: 20, savingsCoverage: 'complete' },
      { sizeBytes: null, estimatedSavingsBytes: 30, savingsCoverage: 'partial' },
    ])

    expect(result.totalSize).toBeNull()
    expect(result.totalEstimatedSavingsBytes).toBe(50)
    expect(result.coverage).toBe('partial')
  })
})
