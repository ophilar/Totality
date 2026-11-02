import { describe, expect, it } from 'vitest'
import { buildCandidateLadder, selectMeasuredCandidate, type MeasuredCandidate } from '@main/services/MeasuredOptimizationPolicy'

describe('selectMeasuredCandidate', () => {
  const candidate = (overrides: Partial<MeasuredCandidate>): MeasuredCandidate => ({
    encoder: 'x265',
    preset: 'medium',
    quality: 20,
    outputBytes: 90,
    vmafMean: 95,
    vmafP5: 92,
    cambiMean: 0,
    ...overrides
  })

  it('selects the smallest measured candidate that meets the profile gates', () => {
    const result = selectMeasuredCandidate('balanced', [
      candidate({ outputBytes: 70, vmafMean: 93, vmafP5: 88 }),
      candidate({ outputBytes: 90, vmafMean: 95, vmafP5: 92 }),
      candidate({ outputBytes: 110, vmafMean: 97, vmafP5: 95 })
    ])

    expect(result.outputBytes).toBe(90)
  })

  it('does not claim a recommendation when measured quality gates fail', () => {
    expect(() => selectMeasuredCandidate('transparent', [candidate({ vmafMean: 94, vmafP5: 90 })]))
      .toThrow('No measured candidate satisfies the transparent quality gates')
  })

  it('builds candidates only for the explicitly selected encoder policy', () => {
    expect(buildCandidateLadder('hevc', 'software')).toHaveLength(3)
    expect(buildCandidateLadder('hevc', 'hardware', 'nvenc_h265')).toHaveLength(3)
    expect(buildCandidateLadder('hevc', 'compare', 'nvenc_h265')).toHaveLength(6)
  })
})
