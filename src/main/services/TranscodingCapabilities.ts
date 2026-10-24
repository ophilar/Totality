
import type { GpuInfo } from './utils/GpuDetector'

export interface TranscodingAvailability {
  ffmpeg: boolean
}

export interface TranscodingCapabilities extends TranscodingAvailability {
  detectedAt: string
  gpus: GpuInfo[]
  selectedGpuId: string | null
  vendors: Array<GpuInfo['vendor'] | 'Software'>
  encoders: string[]
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
  encoders: string[] = []
): TranscodingCapabilities {
  const vendors: Array<GpuInfo['vendor'] | 'Software'> = []

  for (const gpu of gpus) {
    if (gpu.vendor === 'Unknown' || vendors.includes(gpu.vendor)) continue
    vendors.push(gpu.vendor)
  }

  vendors.push('Software')

  const verifiedEncoders = new Set(encoders)
  const devices = [
    { id: 'software', name: 'Software', kind: 'software' as const },
    ...vendors.filter(vendor => vendor !== 'Software').map(vendor => ({
      id: `hardware-${vendor.toLowerCase()}`,
      name: vendor === 'NVIDIA' ? 'NVIDIA NVENC' : vendor === 'Intel' ? 'Intel QSV' : vendor === 'AMD' ? 'AMD AMF' : 'Apple VideoToolbox',
      kind: 'hardware' as const,
    })),
  ]
  const encodingMatrix: EncodingMatrix = {
    devices,
    codecs: [
      { codec: 'h264', capabilities: [verifiedEncoders.has('libx264'), ...devices.slice(1).map(device => {
        const vendor = device.name.split(' ')[0] as GpuInfo['vendor']
        const encoder = getHardwareEncoder(vendor, 'h264')
        return encoder ? verifiedEncoders.has(encoder) : false
      })] },
      { codec: 'hevc', capabilities: [verifiedEncoders.has('x265'), ...devices.slice(1).map(device => {
        const vendor = device.name.split(' ')[0] as GpuInfo['vendor']
        const encoder = getHardwareEncoder(vendor, 'hevc')
        return encoder ? verifiedEncoders.has(encoder) : false
      })] },
      { codec: 'av1', capabilities: [verifiedEncoders.has('svt_av1'), ...devices.slice(1).map(device => {
        const vendor = device.name.split(' ')[0] as GpuInfo['vendor']
        const encoder = getHardwareEncoder(vendor, 'av1')
        return encoder ? verifiedEncoders.has(encoder) : false
      })] },
    ],
  }

  return {
    ...availability,
    detectedAt: new Date().toISOString(),
    gpus,
    selectedGpuId,
    vendors,
    encoders: Array.from(new Set(encoders)),
    encodingMatrix,
    engines: availability.ffmpeg ? ['ffmpeg'] : []
  }
}
