import { describe, expect, it } from 'vitest'
import { buildCandidateLadder, getImpossibleQualityReason, getNonDominatedMeasuredCandidates, nextCandidateSearch, selectMeasuredCandidate, type CandidateEncodingParameters, type MeasuredCandidate } from '@main/services/MeasuredOptimizationPolicy'

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

  it('starts at the configured middle quality, then expands to endpoints and refines the selected profile boundary', () => {
    const domain: CandidateEncodingParameters[] = [18, 22, 26].map(quality => ({ encoder: 'x265', preset: 'medium', quality }))
    expect(nextCandidateSearch(domain, [], 'balanced')).toEqual([domain[1]])
    const middle = candidate({ quality: 22, vmafMean: 95, vmafP5: 92 })
    expect(nextCandidateSearch(domain, [middle], 'balanced')).toEqual([domain[2]])
    const endpoints = [candidate({ quality: 18, vmafMean: 97, vmafP5: 95 }), candidate({ quality: 26, vmafMean: 92, vmafP5: 88 })]
    expect(nextCandidateSearch(domain, [middle, ...endpoints], 'balanced')).toEqual([{ encoder: 'x265', preset: 'medium', quality: 24 }])
  })

  it('uses integers inside the active pass/fail bracket and enumerates a contradictory bracket', () => {
    const domain: CandidateEncodingParameters[] = Array.from({ length: 9 }, (_, quality) => ({ encoder: 'x265', preset: 'medium', quality: quality + 18 }))
    const measured = [candidate({ quality: 18, vmafMean: 97, vmafP5: 95 }), candidate({ quality: 26, vmafMean: 92, vmafP5: 88 })]
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([domain[4]])
    const contradictory = [measured[0], candidate({ quality: 22, vmafMean: 98, vmafP5: 96 }), measured[1]]
    expect(nextCandidateSearch(domain, contradictory, 'balanced')).toEqual([domain[1], domain[2], domain[3], domain[5], domain[6], domain[7]])
  })

  it('moves to the next preset only when the earlier preset has no acceptable result', () => {
    const domain: CandidateEncodingParameters[] = ['medium', 'slow'].flatMap(preset => [18, 22, 26].map(quality => ({ encoder: 'x265', preset, quality })))
    const medium = [18, 22, 26].map(quality => candidate({ preset: 'medium', quality, vmafMean: 90, vmafP5: 85 }))
    expect(nextCandidateSearch(domain, medium, 'balanced')).toEqual([domain[4]])
    expect(nextCandidateSearch(domain, [candidate({ preset: 'medium', quality: 22 })], 'balanced')).toEqual([domain[2]])
  })

  it('schedules each encoder through presets until an acceptable preset is bracketed', () => {
    const domain: CandidateEncodingParameters[] = ['hardware', 'x265'].flatMap(encoder => ['medium', 'slow'].flatMap(preset => [18, 22, 26].map(quality => ({ encoder, preset, quality }))))
    const measured: MeasuredCandidate[] = []
    const accept = (encoder: string, preset: string, quality: number) => candidate({ encoder, preset, quality, vmafMean: 96, vmafP5: 94 })
    const reject = (encoder: string, preset: string, quality: number) => candidate({ encoder, preset, quality, vmafMean: 90, vmafP5: 85 })
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([domain[1]])
    measured.push(reject('hardware', 'medium', 22))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([{ encoder: 'hardware', preset: 'medium', quality: 18 }])
    measured.push(reject('hardware', 'medium', 18))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([domain[4]])
    measured.push(reject('hardware', 'slow', 22))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([{ encoder: 'hardware', preset: 'slow', quality: 18 }])
    measured.push(reject('hardware', 'slow', 18))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([domain[7]])
    measured.push(reject('x265', 'medium', 22))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([{ encoder: 'x265', preset: 'medium', quality: 18 }])
    measured.push(accept('x265', 'medium', 18))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([{ encoder: 'x265', preset: 'medium', quality: 20 }])
    measured.push(reject('x265', 'medium', 20))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([{ encoder: 'x265', preset: 'medium', quality: 19 }])
    measured.push(accept('x265', 'medium', 19))
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([])
  })

  it('rejects partial candidates only when the full-sample quality gate is mathematically impossible', () => {
    expect(getImpossibleQualityReason('balanced', Array(10).fill(0), [], 10)).toContain('VMAF mean cannot reach')
    expect(getImpossibleQualityReason('balanced', [80], [], 20)).toBeUndefined()
    expect(getImpossibleQualityReason('balanced', Array(2).fill(80), [], 20)).toContain('VMAF p5 cannot reach')
    expect(getImpossibleQualityReason('balanced', [], [9, 9, 9], 3)).toContain('CAMBI cannot reach')
  })

  it('excludes candidates marked as impossible from quality-passing selection', () => {
    expect(() => selectMeasuredCandidate('balanced', [candidate({ qualityRejectedReason: 'VMAF mean cannot reach 95' })]))
      .toThrow('No measured candidate satisfies')
  })

  it('never selects a quality-passing candidate with incomplete measurement coverage', () => {
    expect(() => selectMeasuredCandidate('balanced', [candidate({ incompleteMeasurement: true })]))
      .toThrow('No measured candidate satisfies')
  })

  it('continues to later presets when a quality-passing result exceeds the size-rate ceiling', () => {
    const domain: CandidateEncodingParameters[] = ['medium', 'slow'].flatMap(preset => [18, 22, 26].map(quality => ({ encoder: 'x265', preset, quality })))
    const tooLarge = [18, 22, 26].map(quality => candidate({ preset: 'medium', quality, outputBytes: 120, sampledDurationSeconds: 30 }))
    expect(nextCandidateSearch(domain, tooLarge, 'balanced', 3)).toEqual([domain[4]])
  })
})
