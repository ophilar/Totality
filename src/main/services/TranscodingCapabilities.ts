
import type { GpuInfo } from './utils/GpuDetector'

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

export type EncodingCodec = 'h264' | 'hevc' | 'av1'

export interface EncodingMatrix {
  devices: Array<{ id: string; name: string; kind: 'software' | 'hardware' }>
  codecs: Array<{ codec: EncodingCodec; capabilities: boolean[] }>
}

export function getHardwareEncoder(vendor: GpuInfo['vendor'], codec: EncodingCodec): string | undefined {
  if (vendor === 'NVIDIA') return codec === 'av1' ? 'nvenc_av1' : codec === 'hevc' ? 'nvenc_h265' : 'nvenc_h264'
  if (vendor === 'Intel') return codec === 'av1' ? 'qsv_av1' : codec === 'hevc' ? 'qsv_h265' : 'qsv_h264'
  if (vendor === 'AMD') return codec === 'av1' ? 'av1_amf' : codec === 'hevc' ? 'hevc_amf' : 'h264_amf'
  if (vendor === 'Apple') return codec === 'av1' ? undefined : codec === 'hevc' ? 'vt_h265' : 'vt_h264'
  return undefined
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
      ? codec === 'h264' ? 'libx264' : codec === 'hevc' ? 'x265' : 'svt_av1'
      : getHardwareEncoder(vendor, codec)
    return encoder !== undefined && deviceEncoders[deviceId].includes(encoder)
  }
  const encodingMatrix: EncodingMatrix = {
    devices,
    codecs: [
      { codec: 'h264', capabilities: [encoderAvailable('software', 'Software', 'h264'), ...gpus.map(gpu => encoderAvailable(gpu.id, gpu.vendor, 'h264'))] },
      { codec: 'hevc', capabilities: [encoderAvailable('software', 'Software', 'hevc'), ...gpus.map(gpu => encoderAvailable(gpu.id, gpu.vendor, 'hevc'))] },
      { codec: 'av1', capabilities: [encoderAvailable('software', 'Software', 'av1'), ...gpus.map(gpu => encoderAvailable(gpu.id, gpu.vendor, 'av1'))] },
    ],
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
