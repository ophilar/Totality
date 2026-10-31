import type { APP_CONFIG } from '@main/config'
import type { GpuInfo } from '../utils/GpuDetector'
import { getHardwareEncoder } from '../TranscodingCapabilities'
import { OPTIMIZATION_VIDEO_CODECS, getOptimizationVideoCodec, playbackProfileSupportsOptimizationCodec, type OptimizationVideoCodec } from './OptimizationCodecPolicy'

/** Only these hardware families have a validated measured-quality search domain.
 * Encoder names live exclusively in TranscodingCapabilities; software encoder
 * names live exclusively in OptimizationCodecPolicy.
 */
const MEASURED_HARDWARE = {
  NVIDIA: {
    hevc: { qualityDomain: 'nvenc_hevc', presets: ['p5', 'p6', 'p7'] },
    av1: { qualityDomain: 'nvenc_av1', presets: ['p5', 'p6', 'p7'] },
  },
  Intel: {
    hevc: { qualityDomain: 'qsv_hevc', presets: ['medium', 'slow', 'veryslow'] },
    av1: { qualityDomain: 'qsv_av1', presets: ['medium', 'slow', 'veryslow'] },
  },
  AMD: {
    hevc: { qualityDomain: 'amf_hevc', presets: ['speed', 'balanced', 'quality'] },
    av1: { qualityDomain: 'amf_av1', presets: ['speed', 'balanced', 'quality'] },
  },
} as const satisfies Partial<Record<GpuInfo['vendor'], Partial<Record<OptimizationVideoCodec, {
  qualityDomain: keyof typeof APP_CONFIG.transcoding.sampleQualityDomains
  presets: readonly string[]
}>>>>

const MEASURED_SOFTWARE_PRESETS = {
  hevc: ['medium', 'slow', 'slower'],
  av1: ['8', '6', '4'],
} as const satisfies Record<OptimizationVideoCodec, readonly string[]>

export function measuredOptimizationEncoderSpec(encoder: string, codec: OptimizationVideoCodec): {
  qualityDomain: keyof typeof APP_CONFIG.transcoding.sampleQualityDomains
  presets: readonly string[]
} {
  const software = getOptimizationVideoCodec(codec).softwareEncoder
  if (encoder === software) return { qualityDomain: software, presets: MEASURED_SOFTWARE_PRESETS[codec] }
  for (const vendor of ['NVIDIA', 'Intel', 'AMD'] as const) {
    if (encoder === getHardwareEncoder(vendor, codec)) return MEASURED_HARDWARE[vendor][codec]
  }
  throw new Error(`Encoder ${encoder} has no validated measured-optimization quality domain for ${codec}`)
}

export function supportsMeasuredOptimizationEncoder(encoder: string): boolean {
  return OPTIMIZATION_VIDEO_CODECS.some(codec => {
    try {
      measuredOptimizationEncoderSpec(encoder, codec.value)
      return true
    } catch {
      return false
    }
  })
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

export function unsupportedOptimizationCodecReason(
  codec: OptimizationVideoCodec,
  input: OptimizationEncoderAvailability & {
    capabilitiesLoaded: boolean
    playbackTargetName?: string
    selectedGpuName?: string
  },
): string | undefined {
  if (supportedOptimizationCodecs(input).includes(codec)) return undefined
  if (input.playbackPolicy !== 'allow-transcoding' && !playbackProfileSupportsOptimizationCodec(codec, input.playbackCodecs)) {
    return `Not supported by ${input.playbackTargetName ?? 'the selected playback target'}.`
  }
  if (!input.capabilitiesLoaded) return 'Checking encoder support.'
  const label = getOptimizationVideoCodec(codec).shortLabel
  if (input.encoderPolicy === 'software') return `Software encoding for ${label} is unavailable.`
  if (input.encoderPolicy === 'hardware') return input.selectedGpuName
    ? `${input.selectedGpuName} cannot encode ${label} with validated measured optimization.`
    : `Choose a GPU with validated ${label} encoding support.`
  return `No validated ${label} encoder is available.`
}
