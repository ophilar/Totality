
import { APP_CONFIG } from '@main/config'
import type { MeasurementSourcePreparation } from './MeasuredOptimizationService'

export type OptimizationQualityProfile = 'transparent' | 'balanced' | 'maximum_savings'

export const MEASUREMENT_VERSION = 12
export const OPTIMIZATION_SEARCH_VERSION = 2
export const VMAF_LOW_PERCENTILE = 0.05
export const SHOW_PREFLIGHT_SETTING_PREFIX = 'transcoding.preflight.'
export const MEASUREMENT_SETTING_PREFIX = 'transcoding.measurement.'

export interface CachedMeasurement {
  version: number
  searchVersion?: number
  cacheKey: string
  sourceSha256: string
  complete: boolean
  candidates: MeasuredCandidate[]
  sampleHashes: string[][]
  sourcePreparation?: MeasurementSourcePreparation
  sourcePreparationHashes?: string[][]
  partialSamples: MeasuredCandidateSample[]
  partialSampleHashes: string[]
}

export interface MeasuredCandidateSample {
  screeningOnly?: boolean
  encoder: string
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
}

export interface CandidateEncodingParameters {
  encoder: string
  preset: string
  quality: number
}

/** Returns the next measurement batch for adaptive search across the configured encoder and preset domain. */
export function nextCandidateSearch(
  domainCatalogue: CandidateEncodingParameters[],
  measuredCandidates: MeasuredCandidate[],
  profile: OptimizationQualityProfile,
): CandidateEncodingParameters[] {
  const presets = [...new Map(domainCatalogue.map(candidate => [`${candidate.encoder}/${candidate.preset}`, candidate])).values()]
  const evaluation = (candidate: MeasuredCandidate) => evaluateMeasuredCandidates(profile, [candidate])[0]
  const qualityPasses = (candidate: MeasuredCandidate) => evaluation(candidate).qualityPassed
  const encoders = [...new Set(presets.map(candidate => candidate.encoder))]
  for (const encoder of encoders) {
    for (const presetCandidate of presets.filter(candidate => candidate.encoder === encoder)) {
      const domain = domainCatalogue.filter(candidate => candidate.encoder === encoder && candidate.preset === presetCandidate.preset)
      const measured = measuredCandidates.filter(candidate => candidate.encoder === encoder && candidate.preset === presetCandidate.preset)
      const qualities = [...new Set(domain.map(candidate => candidate.quality))].sort((a, b) => a - b)
      const tested = new Set(measured.map(candidate => candidate.quality))
      const untested = (values: number[]) => values.filter(quality => !tested.has(quality)).map(quality => domain.find(candidate => candidate.quality === quality) ?? { encoder: presetCandidate.encoder, preset: presetCandidate.preset, quality })
      if (measured.length === 0) {
        const middle = qualities[Math.floor((qualities.length - 1) / 2)]
        return untested([middle])
      }
      const ordered = [...measured].sort((a, b) => a.quality - b.quality)
      const passFlags = ordered.map(qualityPasses)
      const passTransitions = passFlags.reduce((count, pass, index) => count + (index > 0 && pass !== passFlags[index - 1] ? 1 : 0), 0)
      const contradictory = passTransitions > 1 || ordered.some((candidate, index) => index > 0 && (candidate.vmafMean > ordered[index - 1].vmafMean || candidate.vmafP5 > ordered[index - 1].vmafP5))
      if (contradictory) {
        const relevant = Array.from({ length: ordered[ordered.length - 1].quality - ordered[0].quality + 1 }, (_, index) => ordered[0].quality + index)
        const remaining = untested(relevant)
        if (remaining.length) return remaining
      }
      const next = new Set<number>()
      if (measured.length === 1) {
        const direction = qualityPasses(measured[0]) ? qualities[qualities.length - 1] : qualities[0]
        if (!tested.has(direction)) next.add(direction)
      }
      for (let index = 1; index < ordered.length; index += 1) {
        if (passFlags[index] !== passFlags[index - 1]) {
          const midpoint = Math.floor((ordered[index].quality + ordered[index - 1].quality) / 2)
          if (!tested.has(midpoint)) next.add(midpoint)
        }
      }
      if (next.size) return untested([...next].sort((a, b) => a - b))
    }
  }
  return []
}

function getQualityDomainKey(encoder: string, targetCodec: 'av1' | 'hevc'): keyof typeof APP_CONFIG.transcoding.sampleQualityDomains {
  if (encoder === 'x265' || encoder === 'svt_av1') return encoder
  if (encoder.startsWith('nvenc')) return `nvenc_${targetCodec}`
  if (encoder.startsWith('qsv')) return `qsv_${targetCodec}`
  if (encoder.endsWith('_amf')) return `amf_${targetCodec}`
  throw new Error(`Measured quality domain is not configured for encoder ${encoder}`)
}

export function buildCandidateLadder(targetCodec: 'av1' | 'hevc', encoderPolicy: 'automatic' | 'hardware' | 'software' | 'compare', hardwareEncoder?: string): CandidateEncodingParameters[] {
  const softwareEncoder = targetCodec === 'av1' ? 'svt_av1' : 'x265'
  const hardware = hardwareEncoder ?? ''
  const encoders = encoderPolicy === 'hardware' ? [hardware] : encoderPolicy === 'software' ? [softwareEncoder] : encoderPolicy === 'automatic' ? [hardware || softwareEncoder] : [hardware, softwareEncoder]
  if (encoders.some(encoder => !encoder)) throw new Error('A verified hardware encoder is required for hardware candidate measurement')
  return encoders.flatMap(encoder => {
    const presets = encoder.startsWith('nvenc') ? ['p5', 'p6', 'p7'] : encoder === 'svt_av1' ? ['8', '6', '4'] : encoder.startsWith('qsv') ? ['medium', 'slow', 'veryslow'] : encoder.endsWith('_amf') ? ['speed', 'balanced', 'quality'] : encoder === 'vt_h265' ? ['quality', 'quality', 'quality'] : ['medium', 'slow', 'slower']
    const qualities = APP_CONFIG.transcoding.sampleQualityDomains[getQualityDomainKey(encoder, targetCodec)]
    return [...new Set(presets)].flatMap(preset => qualities.map(quality => ({ encoder, preset, quality })))
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

const QUALITY_GATES: Record<OptimizationQualityProfile, QualityGates> = {
  transparent: { vmafMean: 96, vmafP5: 93, cambiMean: 5 },
  balanced: { vmafMean: 95, vmafP5: 92, cambiMean: 8 },
  maximum_savings: { vmafMean: 93, vmafP5: 88, cambiMean: 12 }
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
