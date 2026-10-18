
export type OptimizationSavingsCoverage = 'complete' | 'partial' | 'insufficient'

export interface OptimizationSavingsInput {
  totalBytes: number | null | undefined
  videoSavingsBytes: number | null | undefined
  audioPruningBytes: number | null | undefined
  audioTranscodeBytes: number | null | undefined
}

export interface OptimizationSavingsBreakdown {
  videoSavingsBytes: number | null
  audioPruningBytes: number | null
  audioTranscodeBytes: number | null
  totalEstimatedSavingsBytes: number
  percentageSavings: number | null
  coverage: OptimizationSavingsCoverage
}

function normalizeKnownBytes(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, value)
}

export function calculateBytesAtBitrateKbps(bitrateKbps: number, durationSeconds: number): number {
  return Math.round((bitrateKbps * 1000 * durationSeconds) / 8)
}

export function calculateBitrateSavingsBytes(sourceBitrateKbps: number, targetBitrateKbps: number, durationSeconds: number): number {
  return Math.max(0, calculateBytesAtBitrateKbps(sourceBitrateKbps - targetBitrateKbps, durationSeconds))
}

export function projectMeasuredSavingsBytes(sourceBytes: number, durationSeconds: number, sampleOutputBytes: number, sampleDurationSeconds: number): number {
  const projectedOutputBytes = Math.round((sampleOutputBytes / sampleDurationSeconds) * durationSeconds)
  return Math.min(sourceBytes, Math.max(0, sourceBytes - projectedOutputBytes))
}

export function projectSavingsRate(calibratedSourceBytes: number, calibratedSavingsBytes: number, targetSourceBytes: number): number {
  return Math.round(targetSourceBytes * calibratedSavingsBytes / calibratedSourceBytes)
}

export function buildOptimizationSavingsBreakdown(input: OptimizationSavingsInput): OptimizationSavingsBreakdown {
  const totalBytes = normalizeKnownBytes(input.totalBytes)
  const capComponent = (value: number | null | undefined) => {
    const bytes = normalizeKnownBytes(value)
    return bytes === null ? null : Math.min(totalBytes ?? Number.MAX_SAFE_INTEGER, bytes)
  }
  const videoSavingsBytes = capComponent(input.videoSavingsBytes)
  const audioPruningBytes = capComponent(input.audioPruningBytes)
  const audioTranscodeBytes = capComponent(input.audioTranscodeBytes)
  const components = [videoSavingsBytes, audioPruningBytes, audioTranscodeBytes]
  const knownCount = components.filter(component => component !== null).length
  const totalEstimatedSavingsBytes = Math.min(
    totalBytes ?? Number.MAX_SAFE_INTEGER,
    components.reduce<number>((sum, component) => sum + (component ?? 0), 0)
  )

  return {
    videoSavingsBytes,
    audioPruningBytes,
    audioTranscodeBytes,
    totalEstimatedSavingsBytes,
    percentageSavings: totalBytes != null && totalBytes > 0
      ? (totalEstimatedSavingsBytes / totalBytes) * 100
      : null,
    coverage: knownCount === 0 ? 'insufficient' : knownCount === components.length ? 'complete' : 'partial',
  }
}
