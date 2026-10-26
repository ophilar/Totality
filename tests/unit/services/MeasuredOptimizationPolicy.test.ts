import { describe, expect, it } from 'vitest'
import { buildCandidateLadder, selectMeasuredCandidate, type MeasuredCandidate } from '@main/services/MeasuredOptimizationPolicy'

describe('selectMeasuredCandidate', () => {
  const candidate = (overrides: Partial<MeasuredCandidate>): MeasuredCandidate => ({
    encoder: 'x265',
    preset: 'medium',
    quality: 20,
    outputBytes: 90,
    sampledDurationSeconds: 30,
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
      .toThrow('No measured candidate satisfies the transparent quality and playback requirements')
  })

  it('builds candidates only for the explicitly selected encoder policy', () => {
    expect(buildCandidateLadder('hevc', 'software').every(item => item.encoder === 'x265')).toBe(true)
    expect(buildCandidateLadder('hevc', 'hardware', 'nvenc_h265').every(item => item.encoder === 'nvenc_h265')).toBe(true)
    expect(new Set(buildCandidateLadder('hevc', 'compare', 'nvenc_h265').map(item => item.encoder))).toEqual(new Set(['nvenc_h265', 'x265']))
  })

  it('varies QSV quality independently of preset and includes the measured high fidelity range', () => {
    const ladder = buildCandidateLadder('hevc', 'hardware', 'qsv_h265')
    const qualities = new Set(ladder.map(item => item.quality))
    expect(qualities).toContain(14)
    expect(qualities).toContain(16)
    for (const preset of new Set(ladder.map(item => item.preset))) {
      expect(new Set(ladder.filter(item => item.preset === preset).map(item => item.quality))).toEqual(qualities)
    }
  })

  it('selects a playback compatible candidate even when a smaller encode passes quality', () => {
    const compatible = candidate({ outputBytes: 100 })
    expect(selectMeasuredCandidate('balanced', [candidate({ outputBytes: 80, playbackBlockers: ['Target cannot play this output'] }), compatible])).toBe(compatible)
  })
})
