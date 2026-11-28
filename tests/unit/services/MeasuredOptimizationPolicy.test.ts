import { describe, expect, it } from 'vitest'
import { buildCandidateLadder, buildValidatedCalibrationEntries, findLongestContinuousLowVmafRun, getImpossibleQualityReason, getNonDominatedMeasuredCandidates, isMeasuredCandidateValidForCalibration, isValidOptimizationCalibrationEntry, nextCandidateSearch, scopedCalibrationEntries, selectCalibrationRepresentatives, selectMeasuredCandidate, type CalibrationCandidateEvidence, type CandidateEncodingParameters, type MeasuredCandidate } from '@main/services/MeasuredOptimizationPolicy'

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

  it('accepts calibration evidence only when quality, completeness and playback pass', () => {
    expect(isMeasuredCandidateValidForCalibration(candidate({}))).toBe(true)
    expect(isMeasuredCandidateValidForCalibration(candidate({ vmafP5: 91 }))).toBe(false)
    expect(isMeasuredCandidateValidForCalibration(candidate({ incompleteMeasurement: true }))).toBe(false)
    expect(isMeasuredCandidateValidForCalibration(candidate({ playbackBlockers: ['incompatible'] }))).toBe(false)
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

  it('accepts every positive saving and excludes equal or larger outputs from recommendations', () => {
    const positiveSaving = candidate({ outputBytes: 89, sampledDurationSeconds: 30 })
    const equalSize = candidate({ outputBytes: 90, sampledDurationSeconds: 30 })
    const larger = candidate({ outputBytes: 120, sampledDurationSeconds: 30 })

    expect(selectMeasuredCandidate('balanced', [equalSize, larger, positiveSaving], 3)).toBe(positiveSaving)
    expect(getNonDominatedMeasuredCandidates('balanced', [equalSize, larger, positiveSaving], 3)).toEqual([positiveSaving])
  })

  it('uses scoped calibration to change the first measured quality while preserving final measurement authority', () => {
    const domain = [10, 14, 18, 24, 30].map(quality => ({ encoder: 'nvenc_h265', gpuId: 'nvidia', preset: 'p6', quality }))
    const entry = {
      scopeKey: 'library-A/HDR10/profile-1', qualityProfile: 'balanced' as const, sourceCodec: 'H.264', targetCodec: 'hevc' as const,
      ...domain[3], outputBytes: 80, sampledDurationSeconds: 30, measuredAt: new Date().toISOString(),
    }
    expect(nextCandidateSearch(domain, [], 'balanced')).toEqual([domain[2]])
    expect(nextCandidateSearch(domain, [], 'balanced', 2, scopedCalibrationEntries([entry], entry.scopeKey))).toEqual([domain[3]])
    expect(nextCandidateSearch(domain, [], 'balanced', 2, scopedCalibrationEntries([entry], 'library-B/SDR/profile-2'))).toEqual([domain[2]])
    const rejected = candidate({ ...domain[3], vmafP5: 80, outputBytes: 40 })
    const accepted = candidate({ ...domain[0], outputBytes: 100 })
    expect(nextCandidateSearch(domain, [rejected], 'balanced', 2, [entry])).toEqual([domain[0]])
    expect(selectMeasuredCandidate('balanced', [rejected, accepted])).toBe(accepted)
  })

  it('learns profile choices from the same independently validated frontier', () => {
    const candidates = [
      candidate({ quality: 18, outputBytes: 90, vmafMean: 97, vmafP5: 95 }),
      candidate({ quality: 22, outputBytes: 80, vmafMean: 95, vmafP5: 92 }),
      candidate({ quality: 26, outputBytes: 70, vmafMean: 93, vmafP5: 88 }),
    ]
    const evidence: CalibrationCandidateEvidence[] = [1, 2, 3, 4].flatMap(mediaItemId =>
      candidates.map(measuredCandidate => ({
        scopeKey: 'scope-a', sourceCodec: 'H.264', targetCodec: 'hevc', role: mediaItemId <= 2 ? 'calibration' : 'holdout',
        mediaItemId, measuredCandidate, preflightValidated: true, maximumOutputBytesPerSecond: 10,
      })))
    const timestamp = new Date().toISOString()
    const entries = buildValidatedCalibrationEntries(evidence, timestamp)
    const domain = candidates.map(({ encoder, preset, quality }) => ({ encoder, preset, quality }))
    for (const [profile, quality] of [['transparent', 18], ['balanced', 22], ['maximum_savings', 26]] as const) {
      expect(nextCandidateSearch(domain, [], profile, 5, entries)[0].quality).toBe(quality)
    }
    expect(buildValidatedCalibrationEntries(evidence.filter(entry => entry.mediaItemId < 3), timestamp)).toEqual([])
    const missing = evidence.filter(entry => !(entry.mediaItemId === 4 && entry.measuredCandidate.quality === 26))
    expect(buildValidatedCalibrationEntries(missing, timestamp).some(entry => entry.quality === 26)).toBe(false)
    const failed = evidence.map(entry => entry.mediaItemId === 4 && entry.measuredCandidate.quality === 26
      ? { ...entry, measuredCandidate: { ...entry.measuredCandidate, playbackBlockers: ['incompatible'] } } : entry)
    expect(buildValidatedCalibrationEntries(failed, timestamp).some(entry => entry.quality === 26)).toBe(false)
    const limits = [1000, 4000, 2000, 3000]
    const bounded = buildValidatedCalibrationEntries(evidence.map(entry => ({ ...entry, rateLimit: limits[entry.mediaItemId! - 1] })), timestamp)
    expect(scopedCalibrationEntries(bounded, 'scope-a', 2500).length).toBeGreaterThan(0)
    expect(scopedCalibrationEntries(bounded, 'scope-a', 1500)).toEqual([])
    expect(scopedCalibrationEntries(bounded, 'scope-a', 3500)).toEqual([])
    expect(scopedCalibrationEntries(bounded, 'scope-a')).toEqual([])
  })

  it('validates persisted calibration entries without accepting incomplete evidence', () => {
    expect(isValidOptimizationCalibrationEntry({
      scopeKey: 'library-A/SDR/profile-1', qualityProfile: 'balanced', sourceCodec: 'H.264', targetCodec: 'hevc', encoder: 'x265', preset: 'medium', quality: 22,
      outputBytes: 100, sampledDurationSeconds: 30, measuredAt: new Date().toISOString(),
    })).toBe(true)
    expect(isValidOptimizationCalibrationEntry({ sourceCodec: 'H.264', targetCodec: 'hevc' })).toBe(false)
  })

  it('classifies an exhausted search without positive savings separately from quality rejection', () => {
    const candidates = [candidate({ outputBytes: 90, sampledDurationSeconds: 30 })]

    expect(() => selectMeasuredCandidate('balanced', candidates, 3)).toThrowError(expect.objectContaining({ decisionStatus: 'no_positive_savings' }))
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
    expect(nextCandidateSearch(domain, contradictory, 'balanced')).toEqual([domain[2]])
  })

  it('bounds contradictory quality measurements instead of enumerating every integer quality', () => {
    const domain: CandidateEncodingParameters[] = [18, 22, 26, 30, 34].map(quality => ({ encoder: 'x265', preset: 'medium', quality }))
    const measured = [
      candidate({ quality: 18, vmafMean: 97, vmafP5: 95 }),
      candidate({ quality: 22, vmafMean: 98, vmafP5: 96 }),
      candidate({ quality: 26, vmafMean: 92, vmafP5: 88 }),
    ]
    expect(nextCandidateSearch(domain, measured, 'balanced')).toHaveLength(1)
    const next = nextCandidateSearch(domain, [
      ...measured,
      candidate({ quality: 20, vmafMean: 96, vmafP5: 94 }),
      candidate({ quality: 24, vmafMean: 94, vmafP5: 90 }),
    ], 'balanced')
    expect(next).toEqual([])
  })

  it('retains the NVIDIA device when contradictory scores select an off-ladder midpoint', () => {
    const device = { encoder: 'nvenc_h265', gpuId: 'nvidia-device', preset: 'p6' }
    const domain = [18, 24, 30].map(quality => ({ ...device, quality }))
    const measured = [
      candidate({ ...device, quality: 18, vmafMean: 93.18, vmafP5: 83.99 }),
      candidate({ ...device, quality: 24, vmafMean: 92, vmafP5: 84.08 }),
    ]
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([{ ...device, quality: 21 }])
  })

  it('automatically searches one representative speed preset but permits explicit comparisons', () => {
    const automatic = buildCandidateLadder('hevc', 'automatic', 'nvenc_h265')
    expect(new Set(automatic.map(item => item.preset)).size).toBe(1)
    expect(new Set(buildCandidateLadder('hevc', 'compare', 'nvenc_h265').map(item => item.preset)).size).toBeGreaterThan(1)
  })

  it.each([
    ['qsv_h265', 6],
    ['nvenc_h265', 10],
  ] as const)('tests a stronger HEVC setting for %s when the first sample misses quality', (encoder, strongestQuality) => {
    const domain = buildCandidateLadder('hevc', 'automatic', undefined, [{ encoder, gpuId: 'device' }])
    const [initial] = nextCandidateSearch(domain, [], 'balanced')
    const rejected = candidate({ ...initial, vmafP5: 87 })
    expect(nextCandidateSearch(domain, [rejected], 'balanced')).toEqual([{ ...initial, quality: strongestQuality }])
  })

  it('moves to the next preset after adaptively completing the earlier preset domain', () => {
    const domain: CandidateEncodingParameters[] = ['medium', 'slow'].flatMap(preset => [18, 22, 26].map(quality => ({ encoder: 'x265', preset, quality })))
    const medium = [18, 22, 26].map(quality => candidate({ preset: 'medium', quality, vmafMean: 90, vmafP5: 85 }))
    expect(nextCandidateSearch(domain, medium, 'balanced')).toEqual([domain[4]])
    expect(nextCandidateSearch(domain, [candidate({ preset: 'medium', quality: 22 })], 'balanced')).toEqual([domain[2]])
  })

  it('searches all configured encoders and presets after finding acceptable results', () => {
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
    expect(nextCandidateSearch(domain, measured, 'balanced')).toEqual([{ encoder: 'x265', preset: 'slow', quality: 22 }])
  })

  it('does not stop exploring presets when an earlier preset has an eligible result', () => {
    const domain: CandidateEncodingParameters[] = ['medium', 'slow'].flatMap(preset => [18, 22, 26].map(quality => ({ encoder: 'x265', preset, quality })))
    const medium = [18, 22, 26].map(quality => candidate({ preset: 'medium', quality, outputBytes: 70 }))

    expect(nextCandidateSearch(domain, medium, 'balanced')).toEqual([domain[4]])
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

})

describe('findLongestContinuousLowVmafRun', () => {
  it('reports the longest contiguous below-profile-p5 run with frame timestamps', () => {
    expect(findLongestContinuousLowVmafRun('balanced', [93, 91, 90, 94, 91, 90, 89], [0, 1, 2, 3, 4, 5, 6])).toEqual({
      frameCount: 3,
      startTimestampSeconds: 4,
      endTimestampSeconds: 6,
      threshold: 92,
    })
  })

  it('does not treat an isolated low frame as a sustained run', () => {
    expect(findLongestContinuousLowVmafRun('balanced', [95, 91, 95], [10, 11, 12])).toEqual({
      frameCount: 1,
      startTimestampSeconds: 11,
      endTimestampSeconds: 11,
      threshold: 92,
    })
  })

  it('rejects mismatched frame evidence instead of inferring timestamps', () => {
    expect(() => findLongestContinuousLowVmafRun('balanced', [91], [])).toThrow('equal lengths')
  })
})

describe('selectCalibrationRepresentatives', () => {
  it('is independent of database order and uses distinct titles spanning technical strata', () => {
    const media = [1, 2, 3, 4, 5, 6].map(id => ({
      id, type: 'episode' as const, series_identity_key: id <= 2 ? 'shared' : String(id),
      file_path: String(id), width: id <= 3 ? 1920 : 3840, height: id <= 3 ? 1080 : 2160,
      video_bitrate_kbps: id * 1000, video_frame_rate: 24,
    }))
    const result = selectCalibrationRepresentatives(media, 4)
    expect(selectCalibrationRepresentatives([...media].reverse(), 4)).toEqual(result)
    expect(new Set(result.map(entry => entry.item.series_identity_key)).size).toBe(4)
    expect(result[0].item.id).toBe(1)
    expect(result.at(-1)?.item.id).toBe(6)
    expect(result.filter(entry => entry.role === 'calibration')).toHaveLength(2)
  })
})
