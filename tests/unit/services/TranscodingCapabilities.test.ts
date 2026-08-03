import { describe, expect, it } from 'vitest'
import { buildTranscodingCapabilities } from '../../../src/main/services/TranscodingCapabilities'

describe('TranscodingCapabilities', () => {
  it('exposes only detected hardware vendors and retains software fallback', () => {
    const capabilities = buildTranscodingCapabilities(
      { ffmpeg: true, handbrake: false },
      [
        { id: 'gpu-1', name: 'NVIDIA GeForce RTX', vendor: 'NVIDIA' },
        { id: 'gpu-2', name: 'Intel UHD', vendor: 'Intel' }
      ]
    )

    expect(capabilities.vendors).toEqual(['NVIDIA', 'Intel', 'Software'])
    expect(capabilities.encoders).toContain('nvenc_av1')
    expect(capabilities.encoders).toContain('qsv_av1')
    expect(capabilities.encoders).toContain('svt_av1')
    expect(capabilities.engines).toEqual(['ffmpeg'])
  })

  it('does not advertise hardware acceleration when no GPU is detected', () => {
    const capabilities = buildTranscodingCapabilities({ ffmpeg: true, handbrake: true }, [])

    expect(capabilities.vendors).toEqual(['Software'])
    expect(capabilities.encoders).toEqual(['svt_av1', 'x265', 'libx264'])
    expect(capabilities.engines).toEqual(['ffmpeg', 'handbrake'])
  })
})
