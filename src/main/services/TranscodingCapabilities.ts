import type { GpuInfo } from './utils/GpuDetector'

export interface TranscodingAvailability {
  ffmpeg: boolean
  handbrake: boolean
}

export interface TranscodingCapabilities extends TranscodingAvailability {
  gpus: GpuInfo[]
  vendors: Array<GpuInfo['vendor'] | 'Software'>
  encoders: string[]
  engines: Array<'ffmpeg' | 'handbrake'>
}

const SOFTWARE_ENCODERS = ['svt_av1', 'x265', 'libx264']

export function buildTranscodingCapabilities(
  availability: TranscodingAvailability,
  gpus: GpuInfo[]
): TranscodingCapabilities {
  const vendors: Array<GpuInfo['vendor'] | 'Software'> = []
  const encoders: string[] = []

  for (const gpu of gpus) {
    if (gpu.vendor === 'Unknown' || vendors.includes(gpu.vendor)) continue
    vendors.push(gpu.vendor)
    if (gpu.vendor === 'NVIDIA') encoders.push('nvenc_av1', 'nvenc_h265')
    if (gpu.vendor === 'Intel') encoders.push('qsv_av1', 'qsv_h265')
    // AMD and Apple devices remain visible in the device inventory, but are
    // not offered as acceleration choices until their command builders are
    // implemented and validated by the installed toolchain.
  }

  vendors.push('Software')
  encoders.push(...SOFTWARE_ENCODERS)

  return {
    ...availability,
    gpus,
    vendors,
    encoders: Array.from(new Set(encoders)),
    engines: [
      ...(availability.ffmpeg ? ['ffmpeg' as const] : []),
      ...(availability.handbrake ? ['handbrake' as const] : [])
    ]
  }
}
