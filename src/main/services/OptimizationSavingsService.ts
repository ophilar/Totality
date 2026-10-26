
import type { SavingsCoverage } from '@main/types/database'

export type OptimizationSavingsCoverage = SavingsCoverage
export type OptimizationSavingsOperation = 'video_transcode' | 'audio_pruning' | 'audio_transcode' | 'subtitle_pruning'

export interface OptimizationSavingsInput {
  totalBytes: number | null | undefined
  videoSavingsBytes: number | null | undefined
  audioPruningBytes: number | null | undefined
  audioTranscodeBytes: number | null | undefined
  subtitlePruningBytes?: number | null
  plannedOperations: readonly OptimizationSavingsOperation[]
  measuredPlanSavingsBytes?: number | null
  videoTargetCodec?: 'hevc' | 'av1' | null
}

export interface OptimizationSavingsBreakdown {
  videoSavingsBytes: number | null
  audioPruningBytes: number | null
  audioTranscodeBytes: number | null
  subtitlePruningBytes: number | null
  totalEstimatedSavingsBytes: number | null
  percentageSavings: number | null
  coverage: OptimizationSavingsCoverage
  videoTargetCodec: 'hevc' | 'av1' | null
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

export function sumMeasuredStreamBytes(streamBytes: Readonly<Record<number, number>> | undefined, streamIndexes: readonly number[]): number | null {
  if (streamIndexes.length === 0) return null
  let total = 0
  for (const index of streamIndexes) {
    const bytes = streamBytes?.[index]
    if (bytes === undefined) return null
    total += bytes
  }
  return total
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
    return bytes === null || totalBytes === null ? bytes : Math.min(totalBytes, bytes)
  }
  const videoSavingsBytes = capComponent(input.videoSavingsBytes)
  const audioPruningBytes = capComponent(input.audioPruningBytes)
  const audioTranscodeBytes = capComponent(input.audioTranscodeBytes)
  const subtitlePruningBytes = capComponent(input.subtitlePruningBytes)
  const measuredPlanSavingsBytes = capComponent(input.measuredPlanSavingsBytes)
  const componentBytes: Record<OptimizationSavingsOperation, number | null> = {
    video_transcode: videoSavingsBytes,
    audio_pruning: audioPruningBytes,
    audio_transcode: audioTranscodeBytes,
    subtitle_pruning: subtitlePruningBytes,
  }
  const components = input.plannedOperations.map(operation => componentBytes[operation])
  const knownCount = components.filter(component => component !== null).length
  const totalEstimatedSavingsBytes = measuredPlanSavingsBytes ?? (knownCount === 0
    ? null
    : totalBytes === null
      ? components.reduce<number>((sum, component) => sum + (component ?? 0), 0)
      : Math.min(totalBytes, components.reduce<number>((sum, component) => sum + (component ?? 0), 0)))
  const coverage = measuredPlanSavingsBytes !== null
    ? 'complete'
    : knownCount === 0 ? 'insufficient' : knownCount === components.length && totalBytes !== null ? 'complete' : 'partial'

  return {
    videoSavingsBytes,
    audioPruningBytes,
    audioTranscodeBytes,
    subtitlePruningBytes,
    totalEstimatedSavingsBytes,
    percentageSavings: totalEstimatedSavingsBytes != null && totalBytes != null && totalBytes > 0
      ? (totalEstimatedSavingsBytes / totalBytes) * 100
      : null,
    coverage,
    videoTargetCodec: input.videoTargetCodec ?? null,
  }
}
