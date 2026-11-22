import { describe, expect, it } from 'vitest'
import {
  OPTIMIZATION_VIDEO_CODECS,
  DEFAULT_OPTIMIZATION_VIDEO_CODEC,
  chooseOptimizationVideoCodec,
  getOptimizationVideoCodec,
  playbackProfileSupportsOptimizationCodec,
} from '@main/services/transcoding/OptimizationCodecPolicy'

describe('optimization codec policy', () => {
  it('has unique supported targets with an explicit default', () => {
    const codecs = OPTIMIZATION_VIDEO_CODECS.map(codec => codec.value)
    expect(new Set(codecs).size).toBe(codecs.length)
    expect(codecs).toContain(DEFAULT_OPTIMIZATION_VIDEO_CODEC)
    expect(getOptimizationVideoCodec('hevc').softwareEncoder).toBe('x265')
    expect(getOptimizationVideoCodec('av1').softwareEncoder).toBe('svt_av1')
  })

  it('preserves the user-selected HEVC codec when AV1 is also supported', () => {
    expect(chooseOptimizationVideoCodec('hevc', ['hevc', 'av1'])).toBe('hevc')
    expect(chooseOptimizationVideoCodec('av1', ['hevc', 'av1'])).toBe('av1')
    expect(chooseOptimizationVideoCodec('av1', ['hevc'])).toBe('hevc')
    expect(chooseOptimizationVideoCodec('', [])).toBe('')
  })

  it('checks playback compatibility using normalized codec identities', () => {
    expect(playbackProfileSupportsOptimizationCodec('hevc', ['h.265'])).toBe(true)
    expect(playbackProfileSupportsOptimizationCodec('av1', ['h.265'])).toBe(false)
    expect(playbackProfileSupportsOptimizationCodec('av1')).toBe(true)
  })
})
