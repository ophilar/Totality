import { describe, expect, it } from 'vitest'
import { buildMeasuredCandidateArgs, verifyQsvQualityMode, verifySampleFrameAlignment, type SampleTimingEvidence } from '@main/services/MeasuredOptimizationService'

describe('buildMeasuredCandidateArgs', () => {
  it('seeks into the original source and trims before hardware filters', () => {
    const args = buildMeasuredCandidateArgs(
      ['-y', '-i', '<input>', '-vf', 'vpp_qsv=format=nv12', '-c:v', 'hevc_qsv', '<output>'],
      '/tmp/original.mkv', 'candidate.mkv', { startSeconds: 12.25, durationSeconds: 3.5 },
    )
    expect(args).toEqual([
      '-y', '-ss', '12.25', '-i', '/tmp/original.mkv',
      '-vf', 'trim=duration=3.5,setpts=PTS-STARTPTS,vpp_qsv=format=nv12',
      '-c:v', 'hevc_qsv', '-t', '3.5', '-enc_time_base:v:0', 'demux', 'candidate.mkv',
    ])
  })

  it('inserts the video filter when the encoder has no filter', () => {
    const args = buildMeasuredCandidateArgs(
      ['-i', '<input>', '-c:v', 'libx265', '<output>'],
      '/tmp/original.mkv', 'candidate.mkv', { startSeconds: 0, durationSeconds: 2 },
    )
    expect(args).toContain('trim=duration=2,setpts=PTS-STARTPTS')
    expect(args).not.toContain('ffv1')
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
