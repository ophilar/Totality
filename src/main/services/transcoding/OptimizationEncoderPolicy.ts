import type { GpuInfo } from '../utils/GpuDetector'
import { getHardwareEncoder } from '../TranscodingCapabilities'
import { OPTIMIZATION_VIDEO_CODECS, getOptimizationVideoCodec, playbackProfileSupportsOptimizationCodec, type OptimizationVideoCodec } from './OptimizationCodecPolicy'

/** A detected FFmpeg encoder is not necessarily supported by the measured-quality workflow. */
export function supportsMeasuredOptimizationEncoder(encoder: string): boolean {
  return encoder === 'x265' || encoder === 'svt_av1' ||
    /^nvenc_(h265|av1)$/.test(encoder) || /^qsv_(h265|av1)$/.test(encoder) ||
    /^(hevc|av1)_amf$/.test(encoder)
}

export interface OptimizationEncoderAvailability {
  gpus: readonly Pick<GpuInfo, 'id' | 'vendor'>[]
  deviceEncoders: Readonly<Record<string, readonly string[]>>
  selectedGpuId?: string | null
  encoderPolicy?: 'automatic' | 'hardware' | 'software' | 'compare' | ''
  playbackCodecs?: readonly string[]
  playbackPolicy?: string
}

export function availableOptimizationEncoders(codec: OptimizationVideoCodec, input: OptimizationEncoderAvailability): {
  software: boolean
  hardware: boolean
  selectedHardware: boolean
} {
  const softwareEncoder = getOptimizationVideoCodec(codec).softwareEncoder
  const software = supportsMeasuredOptimizationEncoder(softwareEncoder) &&
    (input.deviceEncoders.software ?? []).includes(softwareEncoder)
  const compatibleGpu = (gpu: Pick<GpuInfo, 'id' | 'vendor'>) => {
    const encoder = getHardwareEncoder(gpu.vendor, codec)
    return Boolean(encoder && supportsMeasuredOptimizationEncoder(encoder) && input.deviceEncoders[gpu.id]?.includes(encoder))
  }
  return {
    software,
    hardware: input.gpus.some(compatibleGpu),
    selectedHardware: input.gpus.some(gpu => gpu.id === input.selectedGpuId && compatibleGpu(gpu)),
  }
}

/** One policy for library-wide, series and individual-file optimization choices. */
export function supportedOptimizationCodecs(input: OptimizationEncoderAvailability): OptimizationVideoCodec[] {
  return OPTIMIZATION_VIDEO_CODECS.map(codec => codec.value).filter(codec => {
    if (input.playbackPolicy !== 'allow-transcoding' && !playbackProfileSupportsOptimizationCodec(codec, input.playbackCodecs)) return false
    const encoders = availableOptimizationEncoders(codec, input)
    if (input.encoderPolicy === 'software') return encoders.software
    if (input.encoderPolicy === 'hardware') return encoders.selectedHardware
    return encoders.software || encoders.hardware
  })
}
