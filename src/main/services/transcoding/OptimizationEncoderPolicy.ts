import type { GpuInfo } from '../utils/GpuDetector'
import { getHardwareEncoder } from '../TranscodingCapabilities'
import { OPTIMIZATION_VIDEO_CODECS, getOptimizationVideoCodec, playbackProfileSupportsOptimizationCodec, type OptimizationVideoCodec } from './OptimizationCodecPolicy'

/** Explicitly validated measured encoding modes (not every FFmpeg encoder is eligible). */
const MEASURED_ENCODERS = [
  { encoder: 'x265', codec: 'hevc', qualityDomain: 'x265', presets: ['medium', 'slow', 'slower'] },
  { encoder: 'svt_av1', codec: 'av1', qualityDomain: 'svt_av1', presets: ['8', '6', '4'] },
  { encoder: 'nvenc_h265', codec: 'hevc', qualityDomain: 'nvenc_hevc', presets: ['p5', 'p6', 'p7'] },
  { encoder: 'nvenc_av1', codec: 'av1', qualityDomain: 'nvenc_av1', presets: ['p5', 'p6', 'p7'] },
  { encoder: 'qsv_h265', codec: 'hevc', qualityDomain: 'qsv_hevc', presets: ['medium', 'slow', 'veryslow'] },
  { encoder: 'qsv_av1', codec: 'av1', qualityDomain: 'qsv_av1', presets: ['medium', 'slow', 'veryslow'] },
  { encoder: 'hevc_amf', codec: 'hevc', qualityDomain: 'amf_hevc', presets: ['speed', 'balanced', 'quality'] },
  { encoder: 'av1_amf', codec: 'av1', qualityDomain: 'amf_av1', presets: ['speed', 'balanced', 'quality'] },
] as const satisfies ReadonlyArray<{ encoder: string; codec: OptimizationVideoCodec; qualityDomain: string; presets: readonly string[] }>

export function measuredOptimizationEncoderSpec(encoder: string, codec: OptimizationVideoCodec) {
  const policy = MEASURED_ENCODERS.find(candidate => candidate.encoder === encoder)
  if (!policy || policy.codec !== codec) throw new Error(`Encoder ${encoder} has no validated measured-optimization quality domain for ${codec}`)
  return policy
}

export function supportsMeasuredOptimizationEncoder(encoder: string): boolean {
  return MEASURED_ENCODERS.some(policy => policy.encoder === encoder)
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
