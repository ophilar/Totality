
import type { GpuInfo } from './utils/GpuDetector'
import { OPTIMIZATION_VIDEO_CODECS, getOptimizationVideoCodec, type OptimizationVideoCodec } from './transcoding/OptimizationCodecPolicy'

export interface TranscodingAvailability {
  ffmpeg: boolean
}

export interface TranscodingCapabilities extends TranscodingAvailability {
  detectedAt: string
  snapshotFingerprint?: string
  gpus: GpuInfo[]
  selectedGpuId: string | null
  deviceEncoders: Record<string, string[]>
  encodingMatrix: EncodingMatrix
  engines: Array<'ffmpeg'>
}

export type EncodingCodec = 'h264' | OptimizationVideoCodec

export interface EncodingMatrix {
  devices: Array<{ id: string; name: string; kind: 'software' | 'hardware' }>
  codecs: Array<{ codec: EncodingCodec; capabilities: boolean[] }>
}

// Keep the encoder mapping exhaustive. Adding a new target codec must supply
// explicit vendor support (or undefined), rather than silently picking H.264.
const HARDWARE_ENCODERS = {
  NVIDIA: { h264: 'nvenc_h264', hevc: 'nvenc_h265', av1: 'nvenc_av1' },
  Intel: { h264: 'qsv_h264', hevc: 'qsv_h265', av1: 'qsv_av1' },
  AMD: { h264: 'h264_amf', hevc: 'hevc_amf', av1: 'av1_amf' },
  Apple: { h264: 'vt_h264', hevc: 'vt_h265', av1: undefined },
} satisfies Record<'NVIDIA' | 'Intel' | 'AMD' | 'Apple', Record<EncodingCodec, string | undefined>>

export function getHardwareEncoder(vendor: GpuInfo['vendor'], codec: EncodingCodec): string | undefined {
  const encoders = HARDWARE_ENCODERS[vendor as keyof typeof HARDWARE_ENCODERS]
  return encoders?.[codec]
}

export function resolveSelectedGpuId(gpus: GpuInfo[], persistedGpuId?: string | null): string | null {
  if (persistedGpuId && gpus.some(gpu => gpu.id === persistedGpuId)) return persistedGpuId
  return null
}

export function buildTranscodingCapabilities(
  availability: TranscodingAvailability,
  gpus: GpuInfo[],
  selectedGpuId: string | null = null,
  deviceEncoders: Record<string, string[]>
): TranscodingCapabilities {
  const devices = [
    { id: 'software', name: 'Software', kind: 'software' as const },
    ...gpus.map(gpu => ({ id: gpu.id, name: gpu.name, kind: 'hardware' as const })),
  ]
  const encoderAvailable = (deviceId: string, vendor: GpuInfo['vendor'] | 'Software', codec: EncodingCodec): boolean => {
    const encoder = vendor === 'Software'
      ? codec === 'h264' ? 'libx264' : getOptimizationVideoCodec(codec).softwareEncoder
      : getHardwareEncoder(vendor, codec)
    return encoder !== undefined && Boolean(deviceEncoders[deviceId]?.includes(encoder))
  }
  const encodingMatrix: EncodingMatrix = {
    devices,
    codecs: (['h264', ...OPTIMIZATION_VIDEO_CODECS.map(item => item.value)] as EncodingCodec[]).map(codec => ({
      codec,
      capabilities: [encoderAvailable('software', 'Software', codec), ...gpus.map(gpu => encoderAvailable(gpu.id, gpu.vendor, codec))],
    })),
  }
  return {
    ...availability,
    detectedAt: new Date().toISOString(),
    gpus,
    selectedGpuId,
    deviceEncoders,
    encodingMatrix,
    engines: availability.ffmpeg ? ['ffmpeg'] : []
  }
}
