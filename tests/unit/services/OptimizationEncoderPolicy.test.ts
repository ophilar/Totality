import { describe, expect, it } from 'vitest'
import { availableOptimizationEncoders, supportedOptimizationCodecs, supportsMeasuredOptimizationEncoder, unsupportedOptimizationCodecReason } from '@main/services/transcoding/OptimizationEncoderPolicy'
import { chooseOptimizationVideoCodec } from '@main/services/transcoding/OptimizationCodecPolicy'
import { buildCandidateLadder } from '@main/services/MeasuredOptimizationPolicy'

describe('measured optimization encoder eligibility', () => {
  const gpus = [{ id: 'apple', vendor: 'Apple' as const }, { id: 'nvidia', vendor: 'NVIDIA' as const }]
  const deviceEncoders = {
    software: ['x265', 'svt_av1'],
    apple: ['vt_h265'],
    nvidia: ['nvenc_h265', 'nvenc_av1'],
  }

  it('rejects probed VideoToolbox encoders that lack validated measured quality domains', () => {
    expect(supportsMeasuredOptimizationEncoder('vt_h265')).toBe(false)
    expect(supportsMeasuredOptimizationEncoder('nvenc_h265')).toBe(true)
    expect(() => buildCandidateLadder('hevc', 'hardware', 'vt_h265')).toThrow('validated')
    expect(() => buildCandidateLadder('av1', 'hardware', 'nvenc_h265')).toThrow('no validated measured-optimization quality domain')
    expect(() => buildCandidateLadder('hevc', 'hardware', 'qsv_av1')).toThrow('no validated measured-optimization quality domain')
    expect(supportedOptimizationCodecs({
      gpus: [gpus[0]], deviceEncoders, selectedGpuId: 'apple', encoderPolicy: 'hardware',
    })).toEqual([])
  })

  it('filters by selected hardware, source codec target and explicit playback policy', () => {
    expect(supportedOptimizationCodecs({
      gpus, deviceEncoders, selectedGpuId: 'nvidia', encoderPolicy: 'hardware',
      playbackCodecs: ['h.265'], playbackPolicy: 'direct-play',
    })).toEqual(['hevc'])
    expect(availableOptimizationEncoders('hevc', {
      gpus, deviceEncoders, selectedGpuId: 'apple',
    })).toEqual({ software: true, hardware: true, selectedHardware: false })
  })

  it('explains unsupported targets using the same playback and encoder rules', () => {
    expect(unsupportedOptimizationCodecReason('av1', {
      gpus, deviceEncoders, playbackCodecs: ['h.265'], playbackPolicy: 'direct-play', capabilitiesLoaded: true, playbackTargetName: 'Living room',
    })).toContain('Living room')
    expect(unsupportedOptimizationCodecReason('av1', {
      gpus: [gpus[0]], deviceEncoders, selectedGpuId: 'apple', selectedGpuName: 'Apple GPU', encoderPolicy: 'hardware', playbackPolicy: 'allow-transcoding', capabilitiesLoaded: true,
    })).toContain('Apple GPU')
    expect(unsupportedOptimizationCodecReason('hevc', {
      gpus, deviceEncoders, capabilitiesLoaded: true,
    })).toBeUndefined()
  })

  it('never replaces explicit HEVC selection merely because AV1 is available', () => {
    const supported = supportedOptimizationCodecs({ gpus, deviceEncoders })
    expect(supported).toEqual(['hevc', 'av1'])
    expect(chooseOptimizationVideoCodec('hevc', supported)).toBe('hevc')
  })
})
