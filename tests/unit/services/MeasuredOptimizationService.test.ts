import { describe, expect, it } from 'vitest'
import { buildLosslessSampleArgs, buildMeasuredCandidateArgs, verifyQsvQualityMode, verifySampleFrameAlignment, type SampleTimingEvidence } from '@main/services/MeasuredOptimizationService'

describe('buildLosslessSampleArgs', () => {
  it('accurately seeks and encodes the video reference losslessly without copying video packets', () => {
    const args = buildLosslessSampleArgs('/tmp/source.mkv', '/tmp/reference.mkv', 12.25, 3.5, true)
    expect(args).toContain('ffv1')
    expect(args).toContain('setpts=PTS-STARTPTS')
    expect(args).toContain('passthrough')
    expect(args).toContain('filter')
    expect(args).toContain('0')
    expect(args).toEqual(expect.arrayContaining(['-ss', '12.25', '-t', '3.5', '-c:v:0', 'ffv1']))
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args).not.toContain('-noaccurate_seek')
  })
  it('maps only video during full-output verification', () => {
    const args = buildLosslessSampleArgs('/tmp/source.mkv', '/tmp/reference.mkv', 0, 2)
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-an', '-sn', '-dn']))
    expect(args).not.toContain('-c')
  })
  it('rejects invalid windows instead of silently extracting the wrong segment', () => {
    expect(() => buildLosslessSampleArgs('/tmp/source.mkv', '/tmp/reference.mkv', -1, 4)).toThrow()
    expect(() => buildLosslessSampleArgs('/tmp/source.mkv', '/tmp/reference.mkv', 1, 0)).toThrow()
  })
})

describe('buildMeasuredCandidateArgs', () => {
  it('preserves decoded reference timestamps in the encoder rather than rounding to nominal frame rate', () => {
    const args = buildMeasuredCandidateArgs(['-i', '<input>', '-fps_mode', 'passthrough', '-c:v', 'libx265', '<output>'], 'reference.mkv', 'candidate.mkv')
    expect(args).toEqual(['-i', 'reference.mkv', '-fps_mode', 'passthrough', '-c:v', 'libx265', '-enc_time_base:v:0', 'demux', 'candidate.mkv'])
  })
  it('rejects malformed candidate commands', () => {
    expect(() => buildMeasuredCandidateArgs(['-i', '<input>'], 'reference.mkv', 'candidate.mkv')).toThrow('must end with its output path')
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
