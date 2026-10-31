import type { TranscodeOptions } from './types'
import { normalizeAudioCodec } from '@main/services/MediaNormalizer'

export type OptimizationVideoCodec = NonNullable<TranscodeOptions['targetCodec']>

export const OPTIMIZATION_VIDEO_FORMATS: ReadonlyArray<{ value: OptimizationVideoCodec; label: string }> = [
  { value: 'hevc', label: 'HEVC (H.265)' },
  { value: 'av1', label: 'AV1' },
]

type OptimizationAudioCodecOption = 'aac' | 'ac3' | 'eac3'

const OPTIMIZATION_AUDIO_FORMATS: ReadonlyArray<{ value: OptimizationAudioCodecOption; label: string }> = [
  { value: 'aac', label: 'AAC' },
  { value: 'ac3', label: 'AC3' },
  { value: 'eac3', label: 'EAC3' },
]

export function optimizationAudioCodecOptions(supportedCodecs?: readonly string[]) {
  if (!supportedCodecs) return OPTIMIZATION_AUDIO_FORMATS
  return OPTIMIZATION_AUDIO_FORMATS.filter(format => supportedCodecs.some(codec => normalizeAudioCodec(codec) === normalizeAudioCodec(format.value)))
}

const OPTIMIZATION_CONTAINERS = [
  { value: 'mkv', label: 'MKV', identifiers: ['mkv', 'matroska'] },
  { value: 'mp4', label: 'MP4', identifiers: ['mp4'] },
] as const

export function optimizationContainerOptions(supportedContainers?: readonly string[]) {
  if (!supportedContainers) return []
  const normalizedContainers = new Set(supportedContainers.map(container => container.toLowerCase()))
  return OPTIMIZATION_CONTAINERS
    .filter(container => container.identifiers.some(identifier => normalizedContainers.has(identifier)))
    .map(({ value, label }) => ({ value, label }))
}
