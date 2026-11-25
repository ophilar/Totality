
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

/** Canonical internal encoder IDs and FFmpeg probe names. */
export interface EncoderProbeDefinition {
  ffmpegName: string
  codec: EncodingCodec
  vendor?: GpuInfo['vendor']
  arguments?: readonly string[]
}

export const ENCODER_PROBES: Readonly<Record<string, EncoderProbeDefinition>> = {
  nvenc_h264: { ffmpegName: 'h264_nvenc', vendor: 'NVIDIA', codec: 'h264' },
  nvenc_h265: { ffmpegName: 'hevc_nvenc', vendor: 'NVIDIA', codec: 'hevc' },
  nvenc_av1: { ffmpegName: 'av1_nvenc', vendor: 'NVIDIA', codec: 'av1' },
  qsv_h264: { ffmpegName: 'h264_qsv', vendor: 'Intel', codec: 'h264' },
  qsv_h265: { ffmpegName: 'hevc_qsv', vendor: 'Intel', codec: 'hevc' },
  qsv_av1: { ffmpegName: 'av1_qsv', vendor: 'Intel', codec: 'av1' },
  h264_amf: { ffmpegName: 'h264_amf', vendor: 'AMD', codec: 'h264' },
  hevc_amf: { ffmpegName: 'hevc_amf', vendor: 'AMD', codec: 'hevc' },
  av1_amf: { ffmpegName: 'av1_amf', vendor: 'AMD', codec: 'av1' },
  vt_h264: { ffmpegName: 'h264_videotoolbox', vendor: 'Apple', codec: 'h264', arguments: ['-allow_sw', '0'] },
  vt_h265: { ffmpegName: 'hevc_videotoolbox', vendor: 'Apple', codec: 'hevc', arguments: ['-allow_sw', '0'] },
  libx264: { ffmpegName: 'libx264', codec: 'h264' },
  x265: { ffmpegName: 'libx265', codec: 'hevc' },
  svt_av1: { ffmpegName: 'libsvtav1', codec: 'av1' },
}

export function getHardwareEncoder(vendor: GpuInfo['vendor'], codec: EncodingCodec): string | undefined {
  return Object.entries(ENCODER_PROBES).find(([, probe]) => probe.vendor === vendor && probe.codec === codec)?.[0]
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
