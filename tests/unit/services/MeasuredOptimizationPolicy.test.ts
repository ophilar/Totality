import { describe, expect, it } from 'vitest'
import { buildCandidateLadder, buildQualityBoundaryCandidates, getNonDominatedMeasuredCandidates, selectMeasuredCandidate, type MeasuredCandidate } from '@main/services/MeasuredOptimizationPolicy'

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

  it('uses codec-specific quality domains for QSV and keeps quality points independent of presets', () => {
    const ladder = buildCandidateLadder('hevc', 'hardware', 'qsv_h265')
    const qualities = new Set(ladder.map(item => item.quality))
    expect(qualities).toContain(14)
    expect(qualities).toContain(26)
    for (const preset of new Set(ladder.map(item => item.preset))) {
      expect(new Set(ladder.filter(item => item.preset === preset).map(item => item.quality))).toEqual(qualities)
    }
    expect([...new Set(buildCandidateLadder('av1', 'software').map(item => item.quality))]).toEqual([24, 32, 40])
  })

  it('refines measured pass/fail boundaries separately for each preset and quality preference', () => {
    const presetCandidates = buildCandidateLadder('hevc', 'hardware', 'qsv_h265')
    const measurements = [
      candidate({ encoder: 'qsv_h265', quality: 14, preset: 'medium', vmafMean: 97, vmafP5: 95 }),
      candidate({ encoder: 'qsv_h265', quality: 26, preset: 'medium', vmafMean: 92, vmafP5: 88 }),
      candidate({ encoder: 'qsv_h265', quality: 14, preset: 'slow', vmafMean: 97, vmafP5: 95 }),
      candidate({ encoder: 'qsv_h265', quality: 26, preset: 'slow', vmafMean: 92, vmafP5: 88 }),
    ]

    expect(buildQualityBoundaryCandidates(presetCandidates, measurements)).toEqual([
      { encoder: 'qsv_h265', preset: 'medium', quality: 20 },
      { encoder: 'qsv_h265', preset: 'slow', quality: 20 },
    ])
  })

  it('refines the balanced profile boundary from the same measured candidates', () => {
    const candidates = buildCandidateLadder('hevc', 'software')
    const measurements = [
      candidate({ quality: 20, vmafMean: 96, vmafP5: 94 }),
      candidate({ quality: 28, vmafMean: 94, vmafP5: 90 }),
    ]

    expect(buildQualityBoundaryCandidates(candidates, measurements)).toContainEqual({ encoder: 'x265', preset: 'medium', quality: 24 })
  })

  it('selects a playback compatible candidate even when a smaller encode passes quality', () => {
    const compatible = candidate({ outputBytes: 100 })
    expect(selectMeasuredCandidate('balanced', [candidate({ outputBytes: 80, playbackBlockers: ['Target cannot play this output'] }), compatible])).toBe(compatible)
  })

  it('retains non-dominated measured choices across size, quality, and encode time', () => {
    const smaller = candidate({ outputBytes: 80, encodingDurationMs: 1200 })
    const higherFidelity = candidate({ outputBytes: 100, vmafMean: 98, vmafP5: 96, encodingDurationMs: 1800 })
    const dominated = candidate({ outputBytes: 110, vmafMean: 96, vmafP5: 94, encodingDurationMs: 2200 })

    expect(getNonDominatedMeasuredCandidates('balanced', [dominated, higherFidelity, smaller]))
      .toEqual([smaller, higherFidelity])
  })
})
