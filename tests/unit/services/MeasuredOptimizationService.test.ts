import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { buildMeasuredCandidateArgs, findReusableMeasuredSample, measuredSampleStem, verifyQsvQualityMode, verifySampleFrameAlignment, type SampleTimingEvidence } from '@main/services/MeasuredOptimizationService'

describe('findReusableMeasuredSample', () => {
  const candidate = { encoder: 'hevc_qsv', preset: 'medium', quality: 24 }
  const sample = {
    encoder: candidate.encoder,
    preset: candidate.preset,
    quality: candidate.quality,
    sampleIndex: 0,
    outputBytes: 100,
    sampledDurationSeconds: 2,
    encodingDurationMs: 10,
    vmafScores: [95],
    cambiScores: [0.1],
    sourceSelfVmaf: 100,
    sourceCambiMean: 0.1,
    samplePath: 'candidate.mkv',
  }

  it('reuses successful evidence while rejecting screening-only evidence for remeasurement', () => {
    const screeningOnly = { ...sample, screeningOnly: true }
    expect(findReusableMeasuredSample([screeningOnly], candidate, 0)).toBeUndefined()
    expect(findReusableMeasuredSample([screeningOnly, sample], candidate, 0)).toBe(sample)
  })

  it('does not reuse evidence from a different candidate or sample position', () => {
    expect(findReusableMeasuredSample([sample], candidate, 1)).toBeUndefined()
    expect(findReusableMeasuredSample([sample], { ...candidate, quality: 26 }, 0)).toBeUndefined()
  })
})

describe('buildMeasuredCandidateArgs', () => {
  it('seeks into the original source and trims before hardware filters', () => {
    const source = resolve('original.mkv')
    const args = buildMeasuredCandidateArgs(
      ['-y', '-i', '<input>', '-vf', 'vpp_qsv=format=nv12', '-c:v', 'hevc_qsv', '<output>'],
      source, 'candidate.mkv', { startSeconds: 12.25, durationSeconds: 3.5 },
    )
    expect(args).toEqual([
      '-y', '-ss', '12.25', '-i', source,
      '-vf', 'trim=duration=3.5,setpts=PTS-STARTPTS,vpp_qsv=format=nv12',
      '-c:v', 'hevc_qsv', '-an', '-sn', '-dn', '-enc_time_base:v:0', 'demux', 'candidate.mkv',
    ])
  })

  it('inserts the video filter when the encoder has no filter', () => {
    const args = buildMeasuredCandidateArgs(
      ['-i', '<input>', '-c:v', 'libx265', '<output>'],
      '/tmp/original.mkv', 'candidate.mkv', { startSeconds: 0, durationSeconds: 2 },
    )
    expect(args).toContain('trim=duration=2,setpts=PTS-STARTPTS')
    expect(args).not.toContain('ffv1')
    expect(args).not.toContain('-t')
  })
})

describe('verifyQsvQualityMode', () => {
  it.each(['ICQ', 'LA_ICQ'])('accepts %s when FFmpeg reports the configured quality', rateControl => {
    expect(() => verifyQsvQualityMode(`RateControlMethod: ${rateControl}\nICQQuality: 22`, 22)).not.toThrow()
  })

  it('rejects a different rate-control mode', () => {
    expect(() => verifyQsvQualityMode('RateControlMethod: CQP\nICQQuality: 22', 22)).toThrow('instead of the configured quality mode')
  })

  it('rejects a quality value different from the requested candidate', () => {
    expect(() => verifyQsvQualityMode('RateControlMethod: ICQ\nICQQuality: 24', 22)).toThrow('instead of 22')
  })
})

describe('verifySampleFrameAlignment', () => {
  const source: SampleTimingEvidence = {
    frames: 3,
    timestamps: [0, 1 / 24, 2 / 24],
    timestampPrecisionSeconds: 1 / 24000,
    width: 1920,
    height: 1080,
    pixelFormat: 'yuv420p10le',
    colorRange: 'tv',
    colorSpace: 'bt2020nc',
    colorTransfer: 'smpte2084',
    colorPrimaries: 'bt2020',
  }

  it('accepts matching frame windows within stream timestamp precision', () => {
    expect(() => verifySampleFrameAlignment(source, {
      ...source,
      timestampPrecisionSeconds: 1 / 24000,
      timestamps: [0, 1 / 24 + 1 / 24000, 2 / 24],
    })).not.toThrow()
  })

  it('treats equivalent planar and semiplanar pixel layouts as the same sample format', () => {
    expect(() => verifySampleFrameAlignment(source, { ...source, pixelFormat: 'p010le' })).not.toThrow()
  })

  it('rejects a deliberate one-frame alignment shift', () => {
    expect(() => verifySampleFrameAlignment(source, {
      ...source,
      timestamps: [1 / 24, 2 / 24, 3 / 24],
    })).toThrow('Encoded sample frame timing differs from its source')
  })

  it('rejects differing frame counts', () => {
    expect(() => verifySampleFrameAlignment(source, {
      ...source,
      frames: 2,
      timestamps: [0, 1 / 24],
    })).toThrow('Encoded sample frame count differs from its source')
  })

  it('rejects changed dimensions, pixel format, and color metadata', () => {
    expect(() => verifySampleFrameAlignment(source, { ...source, width: 1280 })).toThrow('Encoded sample width differs from its transformed reference')
    expect(() => verifySampleFrameAlignment(source, { ...source, pixelFormat: 'yuv420p' })).toThrow('Encoded sample pixelFormat differs from its transformed reference')
    expect(() => verifySampleFrameAlignment(source, { ...source, colorTransfer: 'bt709' })).toThrow('Encoded sample colorTransfer differs from its transformed reference')
  })
})

it('generates stable portable and device-specific filenames for video samples and logs', () => {
  const candidate = { encoder: 'qsv_h265', gpuId: 'linux-0000:00:02.0', preset: 'medium', quality: 22 }
  expect(measuredSampleStem(candidate, 0)).toMatch(/^[a-f0-9]{64}-0$/)
  expect(measuredSampleStem(candidate, 0)).toBe(measuredSampleStem({ ...candidate }, 0))
  expect(measuredSampleStem(candidate, 0)).not.toBe(measuredSampleStem({ ...candidate, gpuId: 'other/device' }, 0))
  expect(measuredSampleStem(candidate, 0)).not.toBe(measuredSampleStem(candidate, 1))
})
