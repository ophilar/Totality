export type OptimizationSavingsCoverage = 'complete' | 'partial' | 'insufficient'

export interface OptimizationSavingsInput {
  totalBytes: number | null | undefined
  videoDebtBytes: number | null | undefined
  audioPruningBytes: number | null | undefined
  audioTranscodeBytes: number | null | undefined
}

export interface OptimizationSavingsBreakdown {
  videoDebtBytes: number | null
  audioPruningBytes: number | null
  audioTranscodeBytes: number | null
  totalRecoverableBytes: number
  percentageSavings: number | null
  coverage: OptimizationSavingsCoverage
}

function normalizeKnownBytes(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, value)
}

export function buildOptimizationSavingsBreakdown(input: OptimizationSavingsInput): OptimizationSavingsBreakdown {
  const videoDebtBytes = normalizeKnownBytes(input.videoDebtBytes)
  const audioPruningBytes = normalizeKnownBytes(input.audioPruningBytes)
  const audioTranscodeBytes = normalizeKnownBytes(input.audioTranscodeBytes)
  const components = [videoDebtBytes, audioPruningBytes, audioTranscodeBytes]
  const knownCount = components.filter(component => component !== null).length
  const totalRecoverableBytes = components.reduce<number>((sum, component) => sum + (component ?? 0), 0)
  const totalBytes = normalizeKnownBytes(input.totalBytes)

  return {
    videoDebtBytes,
    audioPruningBytes,
    audioTranscodeBytes,
    totalRecoverableBytes,
    percentageSavings: totalBytes != null && totalBytes > 0
      ? (totalRecoverableBytes / totalBytes) * 100
      : null,
    coverage: knownCount === 0 ? 'insufficient' : knownCount === components.length ? 'complete' : 'partial',
  }
}
