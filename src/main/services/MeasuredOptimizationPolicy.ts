import { measuredOptimizationEncoderSpec } from './transcoding/OptimizationEncoderPolicy'

import { APP_CONFIG } from '@main/config'
import { getOptimizationVideoCodec, type OptimizationVideoCodec } from './transcoding/OptimizationCodecPolicy'
import type { MeasurementSourcePreparation } from './MeasuredOptimizationService'
import type { MediaItem } from '@main/types/database'

export type OptimizationQualityProfile = 'transparent' | 'balanced' | 'maximum_savings'

export const MEASUREMENT_VERSION = 18
export const OPTIMIZATION_SEARCH_VERSION = 7
/** Hard bound on expensive full-sample evaluations in each encoder/preset domain. */
export const MAX_MEASURED_CANDIDATES_PER_PRESET = 5
export const VMAF_LOW_PERCENTILE = 0.05
export const SHOW_PREFLIGHT_SETTING_PREFIX = 'transcoding.preflight.'
export const MEASUREMENT_SETTING_PREFIX = 'transcoding.measurement.'
export const OPTIMIZATION_CALIBRATION_VERSION = 3
export const OPTIMIZATION_QUALITY_PROFILES = ['transparent', 'balanced', 'maximum_savings'] as const
export interface OptimizationCalibrationEntry {
  /** Serialized measurement context; exact equality is required before using this search prior. */
  scopeKey: string
  qualityProfile: OptimizationQualityProfile
  sourceCodec: string
  targetCodec: OptimizationVideoCodec
  encoder: string
  gpuId?: string
  preset: string
  quality: number
  outputBytes: number
  sampledDurationSeconds: number
  measuredAt: string
}

export interface PersistedOptimizationCalibration {
  version: typeof OPTIMIZATION_CALIBRATION_VERSION
  entries: OptimizationCalibrationEntry[]
}

export function isValidOptimizationCalibrationEntry(value: unknown): value is OptimizationCalibrationEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<OptimizationCalibrationEntry>
  return typeof entry.scopeKey === 'string' && entry.scopeKey.length > 0 &&
    OPTIMIZATION_QUALITY_PROFILES.includes(entry.qualityProfile!) &&
    typeof entry.sourceCodec === 'string' && entry.sourceCodec.length > 0 &&
    (entry.targetCodec === 'hevc' || entry.targetCodec === 'av1') &&
    typeof entry.encoder === 'string' && entry.encoder.length > 0 &&
    typeof entry.preset === 'string' && entry.preset.length > 0 &&
    typeof entry.quality === 'number' && Number.isFinite(entry.quality) &&
    typeof entry.outputBytes === 'number' && Number.isFinite(entry.outputBytes) && entry.outputBytes > 0 &&
    typeof entry.sampledDurationSeconds === 'number' && Number.isFinite(entry.sampledDurationSeconds) && entry.sampledDurationSeconds > 0 &&
    typeof entry.measuredAt === 'string' && entry.measuredAt.length > 0
}

export function scopedCalibrationEntries(entries: OptimizationCalibrationEntry[], scopeKey: string | undefined): OptimizationCalibrationEntry[] {
  return scopeKey === undefined ? [] : entries.filter(entry => entry.scopeKey === scopeKey)
}

export interface CalibrationCandidateEvidence {
  scopeKey: string
  sourceCodec: string
  targetCodec: OptimizationVideoCodec
  role: 'calibration' | 'holdout'
  mediaItemId?: number
  measuredCandidate: MeasuredCandidate
  preflightValidated: boolean
  maximumOutputBytesPerSecond: number
}

function groupCalibrationEvidence<T, K>(values: T[], key: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const value of values) {
    const identity = key(value)
    const group = groups.get(identity) ?? []
    group.push(value)
    groups.set(identity, group)
  }
  return groups
}

/** Shared measured frontier: a candidate must be evaluated on every title in its context. */
export function buildValidatedCalibrationEntries(evidence: CalibrationCandidateEvidence[], measuredAt: string): OptimizationCalibrationEntry[] {
  const contexts = groupCalibrationEvidence(evidence, entry => entry.scopeKey)
  const result: OptimizationCalibrationEntry[] = []
  for (const [scopeKey, observations] of [...contexts].sort(([a], [b]) => a.localeCompare(b))) {
    const training = new Set(observations.filter(entry => entry.role === 'calibration').map(entry => entry.mediaItemId))
    const holdouts = new Set(observations.filter(entry => entry.role === 'holdout').map(entry => entry.mediaItemId))
    if (training.size < 2 || !holdouts.size || training.has(undefined) || holdouts.has(undefined) || [...training].some(id => holdouts.has(id))) continue
    const expected = training.size + holdouts.size
    const candidates = groupCalibrationEvidence(observations, ({ measuredCandidate: candidate }) => JSON.stringify([candidate.encoder, candidate.gpuId ?? null, candidate.preset, candidate.quality]))
    const aggregated: MeasuredCandidate[] = []
    for (const group of candidates.values()) {
      if (group.length !== expected || new Set(group.map(entry => entry.mediaItemId)).size !== expected ||
        group.some(entry => !entry.preflightValidated || !Number.isFinite(entry.maximumOutputBytesPerSecond) ||
          !isMeasuredCandidateValidForCalibration(entry.measuredCandidate, 'maximum_savings') ||
          entry.measuredCandidate.outputBytes / entry.measuredCandidate.sampledDurationSeconds >= entry.maximumOutputBytesPerSecond)) continue
      const samples = group.map(entry => entry.measuredCandidate)
      aggregated.push({
        encoder: samples[0].encoder, gpuId: samples[0].gpuId, preset: samples[0].preset, quality: samples[0].quality,
        outputBytes: Math.max(...samples.map(sample => sample.outputBytes / sample.sampledDurationSeconds)),
        sampledDurationSeconds: 1,
        vmafMean: Math.min(...samples.map(sample => sample.vmafMean)),
        vmafP5: Math.min(...samples.map(sample => sample.vmafP5)),
        cambiMean: Math.max(...samples.map(sample => sample.cambiMean)),
        encodingDurationMs: samples.every(sample => sample.encodingDurationMs !== undefined)
          ? Math.max(...samples.map(sample => sample.encodingDurationMs! / sample.sampledDurationSeconds)) : undefined,
      })
    }
    const families = groupCalibrationEvidence(aggregated, candidate => JSON.stringify([candidate.encoder, candidate.gpuId ?? null, candidate.preset]))
    for (const qualityProfile of OPTIMIZATION_QUALITY_PROFILES) {
      for (const family of families.values()) {
        for (const candidate of getNonDominatedMeasuredCandidates(qualityProfile, family)) {
          const { encoder, gpuId, preset, quality, outputBytes, sampledDurationSeconds } = candidate
          result.push({ scopeKey, qualityProfile, sourceCodec: observations[0].sourceCodec, targetCodec: observations[0].targetCodec,
            encoder, gpuId, preset, quality, outputBytes, sampledDurationSeconds, measuredAt })
        }
      }
    }
  }
  return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

export interface ContinuousLowVmafRun {
  frameCount: number
  startTimestampSeconds: number
  endTimestampSeconds: number
  threshold: number
}

/** Returns the longest contiguous run of frames below the profile's low-score gate. */
export function findLongestContinuousLowVmafRun(
  profile: OptimizationQualityProfile,
  vmafScores: number[],
  timestamps: number[],
): ContinuousLowVmafRun | undefined {
  if (vmafScores.length !== timestamps.length) throw new Error('VMAF scores and frame timestamps must have equal lengths')
  const threshold = QUALITY_GATES[profile].vmafP5
  let best: ContinuousLowVmafRun | undefined
  let currentStart = -1
  for (let index = 0; index <= vmafScores.length; index += 1) {
    const below = index < vmafScores.length && vmafScores[index] < threshold
    if (below && currentStart === -1) currentStart = index
    if (!below && currentStart !== -1) {
      const frameCount = index - currentStart
      const run = {
        frameCount,
        startTimestampSeconds: timestamps[currentStart],
        endTimestampSeconds: timestamps[index - 1],
        threshold,
      }
      if (!best || run.frameCount > best.frameCount) best = run
      currentStart = -1
    }
  }
  return best
}

export interface CachedMeasurement {
  version: number
  searchVersion?: number
  cacheKey: string
  sourceSha256: string
  complete: boolean
  candidates: MeasuredCandidate[]
  sampleHashes: string[][]
  sourcePreparation?: MeasurementSourcePreparation
  partialSamples: MeasuredCandidateSample[]
  partialSampleHashes: string[]
}

export interface MeasuredCandidateSample {
  screeningOnly?: boolean
  encoder: string
  gpuId?: string
  preset: string
  quality: number
  sampleIndex: number
  outputBytes: number
  sampledDurationSeconds: number
  encodingDurationMs: number
  vmafScores: number[]
  cambiScores: number[]
  sourceSelfVmaf: number
  sourceCambiMean: number
  samplePath: string
}

export interface MeasuredCandidate {
  encoder: string
  gpuId?: string
  preset: string
  quality: number
  outputBytes: number
  sampledDurationSeconds: number
  vmafMean: number
  vmafP5: number
  encodingDurationMs?: number
  sourceSelfVmaf?: number
  sourceCambiMean?: number
  samplePaths?: string[]
  cambiMean: number
  /** Runtime compatibility evidence; excluded from durable candidate measurements. */
  playbackBlockers?: string[]
  qualityRejectedReason?: string
  incompleteMeasurement?: boolean
  /** Bounded search selects the best tested candidate, not a proven global optimum. */
  searchSummary?: { measuredCount: number; maximumCandidates: number; budgetReached: boolean }
}

export interface CandidateEncodingParameters {
  encoder: string
  gpuId?: string
  preset: string
  quality: number
}

/** Returns the next measurement batch for adaptive search across the configured encoder and preset domain. */
export function nextCandidateSearch(
  domainCatalogue: CandidateEncodingParameters[],
  measuredCandidates: MeasuredCandidate[],
  profile: OptimizationQualityProfile,
  maxCandidatesPerPreset = MAX_MEASURED_CANDIDATES_PER_PRESET,
  calibrationEntries: OptimizationCalibrationEntry[] = [],
): CandidateEncodingParameters[] {
  const presets = [...new Map(domainCatalogue.map(candidate => [`${candidate.encoder}/${candidate.gpuId ?? 'software'}/${candidate.preset}`, candidate])).values()]
  const evaluation = (candidate: MeasuredCandidate) => evaluateMeasuredCandidates(profile, [candidate])[0]
  const qualityPasses = (candidate: MeasuredCandidate) => evaluation(candidate).qualityPassed
  const encoderKeys = [...new Set(presets.map(candidate => `${candidate.encoder}/${candidate.gpuId ?? 'software'}`))]
  for (const encoderKey of encoderKeys) {
    for (const presetCandidate of presets.filter(candidate => `${candidate.encoder}/${candidate.gpuId ?? 'software'}` === encoderKey)) {
      const domain = domainCatalogue.filter(candidate => `${candidate.encoder}/${candidate.gpuId ?? 'software'}` === encoderKey && candidate.preset === presetCandidate.preset)
      const measured = measuredCandidates.filter(candidate => `${candidate.encoder}/${candidate.gpuId ?? 'software'}` === encoderKey && candidate.preset === presetCandidate.preset)
      const qualities = [...new Set(domain.map(candidate => candidate.quality))].sort((a, b) => a - b)
      const tested = new Set(measured.map(candidate => candidate.quality))
      const untested = (values: number[]) => values.filter(quality => !tested.has(quality)).map(quality => ({ ...presetCandidate, quality }))
      if (measured.length >= maxCandidatesPerPreset) continue
      if (measured.length === 0) {
        const prior = calibrationEntries.filter(entry =>
          entry.qualityProfile === profile && entry.encoder === presetCandidate.encoder && entry.gpuId === presetCandidate.gpuId &&
          entry.preset === presetCandidate.preset && Number.isInteger(entry.quality) &&
          entry.quality >= qualities[0] && entry.quality <= qualities[qualities.length - 1]
        ).sort((left, right) => left.outputBytes / left.sampledDurationSeconds - right.outputBytes / right.sampledDurationSeconds || right.quality - left.quality)[0]
        const middle = qualities[Math.floor((qualities.length - 1) / 2)]
        return untested([prior?.quality ?? middle])
      }
      const ordered = [...measured].sort((a, b) => a.quality - b.quality)
      const passFlags = ordered.map(qualityPasses)
      if (!passFlags.some(Boolean) && !tested.has(qualities[0])) return untested([qualities[0]])
      const passTransitions = passFlags.reduce((count, pass, index) => count + (index > 0 && pass !== passFlags[index - 1] ? 1 : 0), 0)
      const contradictory = passTransitions > 1 || ordered.some((candidate, index) => index > 0 && (candidate.vmafMean > ordered[index - 1].vmafMean || candidate.vmafP5 > ordered[index - 1].vmafP5))
      if (contradictory) {
        // Perceptual metrics can be non-monotonic. Never schedule the entire
        // integer interval: it can contain dozens of full encodes per preset.
        // Probe the widest unresolved gap, one candidate at a time, under the budget.
        const anchors = [qualities[0], ...ordered.map(candidate => candidate.quality), qualities[qualities.length - 1]]
        const gaps = [...new Set(anchors)].sort((a, b) => a - b)
        const midpointCandidates = gaps.slice(1).map((high, index) => {
          const low = gaps[index]
          return { gap: high - low, midpoint: Math.floor((high + low) / 2) }
        }).filter(entry => entry.gap > 1 && !tested.has(entry.midpoint))
          .sort((a, b) => b.gap - a.gap)
        if (midpointCandidates.length) return untested([midpointCandidates[0].midpoint]).slice(0, maxCandidatesPerPreset - measured.length)
      }
      const next = new Set<number>()
      if (measured.length === 1) {
        const direction = qualityPasses(measured[0]) ? qualities[qualities.length - 1] : qualities[0]
        if (!tested.has(direction)) next.add(direction)
        else {
          const middle = qualities[Math.floor((qualities.length - 1) / 2)]
          if (!tested.has(middle)) next.add(middle)
        }
      }
      for (let index = 1; index < ordered.length; index += 1) {
        if (passFlags[index] !== passFlags[index - 1]) {
          const midpoint = Math.floor((ordered[index].quality + ordered[index - 1].quality) / 2)
          if (!tested.has(midpoint)) next.add(midpoint)
        }
      }
      if (next.size) return untested([...next].sort((a, b) => a - b)).slice(0, maxCandidatesPerPreset - measured.length)
    }
  }
  return []
}

export function buildCandidateLadder(targetCodec: OptimizationVideoCodec, encoderPolicy: 'automatic' | 'hardware' | 'software' | 'compare', hardwareEncoder?: string, hardwareCandidates?: Array<{ encoder: string; gpuId: string }>): CandidateEncodingParameters[] {
  const softwareEncoder = getOptimizationVideoCodec(targetCodec).softwareEncoder
  const hardware = hardwareEncoder ?? ''
  const encoders = encoderPolicy === 'hardware' ? [{ encoder: hardware, gpuId: undefined }] : encoderPolicy === 'software' ? [{ encoder: softwareEncoder, gpuId: undefined }] : encoderPolicy === 'automatic' ? (hardwareCandidates?.length ? hardwareCandidates : [{ encoder: hardware || softwareEncoder, gpuId: undefined }]) : [{ encoder: hardware, gpuId: undefined }, { encoder: softwareEncoder, gpuId: undefined }]
  if (encoders.some(candidate => !candidate.encoder)) throw new Error('A verified hardware encoder is required for hardware candidate measurement')
  return encoders.flatMap(({ encoder, gpuId }) => {
    const policy = measuredOptimizationEncoderSpec(encoder, targetCodec)
    const presets = policy.presets
    const qualities = APP_CONFIG.transcoding.sampleQualityDomains[policy.qualityDomain]
    // Automatic mode should not benchmark every speed preset before it can
    // recommend a usable encode. Explicit policies retain full preset exploration.
    const selectedPresets = encoderPolicy === 'automatic' ? [presets[Math.floor(presets.length / 2)]] : [...new Set(presets)]
    return selectedPresets.flatMap(preset => qualities.map(quality => ({ encoder, gpuId, preset, quality })))
  })
}

interface QualityGates {
  vmafMean: number
  vmafP5: number
  cambiMean: number
}

interface MeasuredCandidateEvaluation {
  candidate: MeasuredCandidate
  passed: boolean
  qualityPassed: boolean
  failedGates: string[]
}

const QUALITY_GATES: Record<OptimizationQualityProfile, QualityGates> = APP_CONFIG.transcoding.qualityGates

/** Select independent titles deterministically across resolution, bitrate and frame rate. */
export function selectCalibrationRepresentatives<T extends Pick<MediaItem, 'id' | 'type' | 'series_identity_key' | 'series_title' | 'file_path' | 'width' | 'height' | 'video_bitrate_kbps' | 'video_frame_rate'>>(
  items: T[], limit: number,
): Array<{ item: T; role: 'calibration' | 'holdout' }> {
  const compare = (left: T, right: T) =>
    left.width * left.height - right.width * right.height ||
    left.video_bitrate_kbps - right.video_bitrate_kbps ||
    (left.video_frame_rate ?? 0) - (right.video_frame_rate ?? 0) ||
    (left.id ?? 0) - (right.id ?? 0) ||
    (left.file_path < right.file_path ? -1 : left.file_path > right.file_path ? 1 : 0)
  const titles = new Map<string, T[]>()
  for (const item of items) {
    const identity = item.type === 'movie' ? `movie:${item.id}` : `series:${item.series_identity_key ?? item.series_title ?? item.id}`
    const group = titles.get(identity) ?? []
    group.push(item)
    titles.set(identity, group)
  }
  const ordered = [...titles.values()].map(group => group.sort(compare)[Math.floor((group.length - 1) / 2)]).sort(compare)
  const count = Math.min(ordered.length, limit)
  if (!count) return []
  const indices = count === 1 ? [Math.floor((ordered.length - 1) / 2)] :
    Array.from({ length: count }, (_, index) => Math.round(index * (ordered.length - 1) / (count - 1)))
  return indices.map((index, position) => ({ item: ordered[index], role: position % 2 === 0 ? 'calibration' : 'holdout' }))
}

export function getImpossibleQualityReason(
  profile: OptimizationQualityProfile,
  vmafScores: number[],
  cambiScores: number[],
  totalFrames: number,
): string | undefined {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0 || vmafScores.length > totalFrames || cambiScores.length > totalFrames) throw new Error('Quality bound requires valid accumulated scores and total frame count')
  const gates = QUALITY_GATES[profile]
  const remaining = totalFrames - vmafScores.length
  const optimisticMean = (vmafScores.reduce((sum, score) => sum + score, 0) + remaining * 100) / totalFrames
  if (optimisticMean < gates.vmafMean) return `VMAF mean cannot reach ${gates.vmafMean} even if all remaining frames score 100`
  const failedTailFrames = vmafScores.filter(score => score < gates.vmafP5).length
  if (failedTailFrames > Math.floor(totalFrames * VMAF_LOW_PERCENTILE)) return `VMAF p5 cannot reach ${gates.vmafP5} with ${failedTailFrames} below-threshold frames`
  const optimisticCambi = cambiScores.reduce((sum, score) => sum + score, 0) / totalFrames
  if (optimisticCambi > gates.cambiMean) return `CAMBI cannot reach ${gates.cambiMean} even if all remaining frames score 0`
  return undefined
}

export class MeasuredQualityError extends Error {
  constructor(message: string, public readonly decisionStatus: 'quality_threshold_unmet' | 'incompatible' | 'no_positive_savings') {
    super(message)
    this.name = 'MeasuredQualityError'
  }
}

export function selectMeasuredCandidate(
  profile: OptimizationQualityProfile,
  candidates: MeasuredCandidate[],
  maximumOutputBytesPerSecond?: number,
): MeasuredCandidate {
  const gates = QUALITY_GATES[profile]
  const evaluations = evaluateMeasuredCandidates(profile, candidates)
  const gatePassing = evaluations.filter(evaluation => evaluation.passed)
  const eligible = evaluations
    .filter(evaluation => evaluation.passed)
    .map(evaluation => evaluation.candidate)
    .filter(candidate => maximumOutputBytesPerSecond === undefined || candidate.outputBytes / candidate.sampledDurationSeconds < maximumOutputBytesPerSecond)
    .sort((left, right) => left.outputBytes - right.outputBytes || (left.encodingDurationMs ?? Number.POSITIVE_INFINITY) - (right.encodingDurationMs ?? Number.POSITIVE_INFINITY))
  const selected = eligible[0]
  if (!selected) {
    const reports = evaluations.map(({ candidate, failedGates }) =>
      `${candidate.encoder}/${candidate.preset} q${candidate.quality}: output ${candidate.outputBytes} bytes across ${candidate.sampledDurationSeconds}s, ${candidate.outputBytes / candidate.sampledDurationSeconds} bytes/s; VMAF mean ${candidate.vmafMean.toFixed(2)} (min ${gates.vmafMean}), VMAF p5 ${candidate.vmafP5.toFixed(2)} (min ${gates.vmafP5}), CAMBI ${candidate.cambiMean.toFixed(2)} (max ${gates.cambiMean}); failed=${failedGates.join(',')}`
    )
    const qualityPassed = evaluations.some(evaluation => evaluation.qualityPassed)
    const decisionStatus = gatePassing.length > 0 ? 'no_positive_savings' : qualityPassed ? 'incompatible' : 'quality_threshold_unmet'
    const reason = decisionStatus === 'no_positive_savings'
      ? `No measured candidate produces positive savings below ${maximumOutputBytesPerSecond} output bytes per second.`
      : `No measured candidate satisfies the ${profile} quality and playback requirements.`
    throw new MeasuredQualityError(`${reason} Candidate results: ${reports.join(' | ')}`, decisionStatus)
  }
  return selected
}

export function getNonDominatedMeasuredCandidates(
  profile: OptimizationQualityProfile,
  candidates: MeasuredCandidate[],
  maximumOutputBytesPerSecond?: number,
): MeasuredCandidate[] {
  const eligible = evaluateMeasuredCandidates(profile, candidates)
    .filter(evaluation => evaluation.passed)
    .map(evaluation => evaluation.candidate)
    .filter(candidate => maximumOutputBytesPerSecond === undefined || candidate.outputBytes / candidate.sampledDurationSeconds < maximumOutputBytesPerSecond)
  return eligible.filter(candidate => !eligible.some(other => other !== candidate &&
    other.outputBytes <= candidate.outputBytes &&
    other.vmafMean >= candidate.vmafMean &&
    other.vmafP5 >= candidate.vmafP5 &&
    other.cambiMean <= candidate.cambiMean &&
    (other.encodingDurationMs === undefined || candidate.encodingDurationMs === undefined || other.encodingDurationMs <= candidate.encodingDurationMs) &&
    (other.outputBytes < candidate.outputBytes || other.vmafMean > candidate.vmafMean || other.vmafP5 > candidate.vmafP5 || other.cambiMean < candidate.cambiMean ||
      other.encodingDurationMs !== undefined && candidate.encodingDurationMs !== undefined && other.encodingDurationMs < candidate.encodingDurationMs)
  )).sort((left, right) => left.outputBytes - right.outputBytes)
}

function evaluateMeasuredCandidates(profile: OptimizationQualityProfile, candidates: MeasuredCandidate[]): MeasuredCandidateEvaluation[] {
  const gates = QUALITY_GATES[profile]
  return candidates.map(candidate => {
    const failedGates = [
      ...(!Number.isFinite(candidate.outputBytes) || candidate.outputBytes <= 0 || !Number.isFinite(candidate.sampledDurationSeconds) || candidate.sampledDurationSeconds <= 0 || !Number.isFinite(candidate.vmafMean) || !Number.isFinite(candidate.vmafP5) || !Number.isFinite(candidate.cambiMean) ? ['Incomplete numeric measurement'] : []),
      ...(candidate.qualityRejectedReason ? [candidate.qualityRejectedReason] : []),
      ...(candidate.vmafMean >= gates.vmafMean ? [] : [`VMAF mean < ${gates.vmafMean}`]),
      ...(candidate.vmafP5 >= gates.vmafP5 ? [] : [`VMAF p5 < ${gates.vmafP5}`]),
      ...(candidate.cambiMean <= gates.cambiMean ? [] : [`CAMBI > ${gates.cambiMean}`]),
    ]
    const qualityPassed = failedGates.length === 0
    if (candidate.incompleteMeasurement) failedGates.push('Measurement did not cover all sample segments')
    failedGates.push(...candidate.playbackBlockers ?? [])
    return { candidate, passed: failedGates.length === 0, qualityPassed, failedGates }
  })
}

/** Returns whether a measured candidate has complete, quality-passing, playback-compatible evidence. */
export function isMeasuredCandidateValidForCalibration(candidate: MeasuredCandidate, profile: OptimizationQualityProfile = 'balanced'): boolean {
  return Number.isFinite(candidate.outputBytes) && candidate.outputBytes > 0 &&
    Number.isFinite(candidate.sampledDurationSeconds) && candidate.sampledDurationSeconds > 0 &&
    Number.isFinite(candidate.vmafMean) && Number.isFinite(candidate.vmafP5) && Number.isFinite(candidate.cambiMean) &&
    evaluateMeasuredCandidates(profile, [candidate])[0].passed
}
