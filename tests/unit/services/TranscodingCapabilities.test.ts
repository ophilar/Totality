import { describe, expect, it } from 'vitest'
import { buildTranscodingCapabilities, resolveSelectedGpuId, selectDefaultGpu } from '../../../src/main/services/TranscodingCapabilities'

describe('TranscodingCapabilities', () => {
  it('prefers NVIDIA over an integrated GPU for the default hardware encoder', () => {
    expect(selectDefaultGpu([
      { id: 'intel', name: 'Intel UHD', vendor: 'Intel' },
      { id: 'nvidia', name: 'NVIDIA GeForce RTX', vendor: 'NVIDIA' }
    ])).toEqual({ id: 'nvidia', name: 'NVIDIA GeForce RTX', vendor: 'NVIDIA' })
  })

  it('keeps an explicit software selection and discards unavailable device selections', () => {
    const gpus = [{ id: 'intel', name: 'Intel UHD', vendor: 'Intel' as const }]
    expect(resolveSelectedGpuId(gpus, null)).toBeNull()
    expect(resolveSelectedGpuId(gpus, 'missing')).toBe('intel')
    expect(buildTranscodingCapabilities({ ffmpeg: true }, gpus, null).selectedGpuId).toBeNull()
  })

  it('exposes only detected hardware vendors and retains software fallback', () => {
    const capabilities = buildTranscodingCapabilities(
      { ffmpeg: true },
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
    const capabilities = buildTranscodingCapabilities({ ffmpeg: true }, [])

    expect(capabilities.vendors).toEqual(['Software'])
    expect(capabilities.encoders).toEqual(['svt_av1', 'x265', 'libx264'])
    expect(capabilities.engines).toEqual(['ffmpeg'])
  })
})
