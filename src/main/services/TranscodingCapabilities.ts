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
  verifiedEncoders: string[]
  probeFailures: string[]
  engines: Array<'ffmpeg'>
}

const SOFTWARE_ENCODERS = ['svt_av1', 'x265', 'libx264']

export function selectDefaultGpu(gpus: GpuInfo[]): GpuInfo | undefined {
  return gpus.find(gpu => gpu.vendor === 'NVIDIA') ?? gpus.find(gpu => gpu.vendor === 'Intel') ?? gpus[0]
}

export function resolveSelectedGpuId(gpus: GpuInfo[], persistedGpuId?: string | null): string | null {
  if (persistedGpuId === null) return null
  if (persistedGpuId && gpus.some(gpu => gpu.id === persistedGpuId)) return persistedGpuId
  return selectDefaultGpu(gpus)?.id ?? null
}

export function buildTranscodingCapabilities(
  availability: TranscodingAvailability,
  gpus: GpuInfo[],
  selectedGpuId: string | null = resolveSelectedGpuId(gpus),
  verifiedEncoders: string[] = [],
  probeFailures: string[] = []
): TranscodingCapabilities {
  const vendors: Array<GpuInfo['vendor'] | 'Software'> = []
  const encoders: string[] = []

  for (const gpu of gpus) {
    if (gpu.vendor === 'Unknown' || vendors.includes(gpu.vendor)) continue
    vendors.push(gpu.vendor)
    if (gpu.vendor === 'NVIDIA') encoders.push('nvenc_av1', 'nvenc_h265')
    if (gpu.vendor === 'Intel') encoders.push('qsv_av1', 'qsv_h265')
  }

  vendors.push('Software')
  encoders.push(...SOFTWARE_ENCODERS)

  return {
    ...availability,
    detectedAt: new Date().toISOString(),
    gpus,
    selectedGpuId,
    vendors,
    encoders: Array.from(new Set(encoders)),
    verifiedEncoders: Array.from(new Set(verifiedEncoders)),
    probeFailures,
    engines: [
      ...(availability.ffmpeg ? ['ffmpeg' as const] : [])
    ]
  }
}
