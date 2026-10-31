import { normalizeVideoCodec } from '../MediaNormalizer'

/**
 * Supported *output* codecs for measured optimization.
 * A codec is not offered merely because FFmpeg can decode it: it needs a
 * verified encoder, quality-search domain, and output validation.
 * Keep UI labels and encoder selection in the same small registry.
 */
export const OPTIMIZATION_VIDEO_CODECS = [
  {
    value: 'hevc',
    label: 'HEVC (H.265)',
    shortLabel: 'H.265',
    description: 'Smaller files with broad device support.',
    softwareEncoder: 'x265',
    normalizedCodec: 'HEVC',
  },
  {
    value: 'av1',
    label: 'AV1',
    shortLabel: 'AV1',
    description: 'Smaller files; newer devices may be needed.',
    softwareEncoder: 'svt_av1',
    normalizedCodec: 'AV1',
  },
] as const

export type OptimizationVideoCodec = (typeof OPTIMIZATION_VIDEO_CODECS)[number]['value']
export const DEFAULT_OPTIMIZATION_VIDEO_CODEC: OptimizationVideoCodec = OPTIMIZATION_VIDEO_CODECS[0].value

export function getOptimizationVideoCodec(codec: OptimizationVideoCodec) {
  const definition = OPTIMIZATION_VIDEO_CODECS.find(item => item.value === codec)
  if (!definition) throw new Error(`Unsupported optimization target codec: ${codec}`)
  return definition
}

/** Do not silently change a user's output codec when preferences are refreshed. */
export function chooseOptimizationVideoCodec(
  selected: OptimizationVideoCodec | '',
  supported: readonly OptimizationVideoCodec[],
): OptimizationVideoCodec | '' {
  if (selected && supported.includes(selected)) return selected
  return OPTIMIZATION_VIDEO_CODECS.find(item => supported.includes(item.value))?.value ?? ''
}

export function playbackProfileSupportsOptimizationCodec(
  codec: OptimizationVideoCodec,
  playbackCodecs?: readonly string[],
): boolean {
  return !playbackCodecs || playbackCodecs.some(value =>
    normalizeVideoCodec(value) === getOptimizationVideoCodec(codec).normalizedCodec)
}
