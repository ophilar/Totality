
import { APP_CONFIG } from '@main/config'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'

export type OptimizationQualityProfile = 'transparent' | 'balanced' | 'maximum_savings'

export const MEASUREMENT_VERSION = 4
export const SHOW_PREFLIGHT_SETTING_PREFIX = 'transcoding.preflight.'
export const MEASUREMENT_SETTING_PREFIX = 'transcoding.measurement.'

export interface CachedMeasurement {
  version: number
  cacheKey: string
  sourceSha256: string
  candidates: MeasuredCandidate[]
  sampleHashes: string[][]
  targetProfile?: PlaybackTargetProfile
}

export interface MeasuredCandidate {
  encoder: string
  preset: string
  quality: number
  outputBytes: number
  sampledDurationSeconds: number
  vmafMean: number
  vmafP5: number
  samplePaths?: string[]
  cambiMean: number
  playbackBlockers?: string[]
}

export interface CandidateEncodingParameters {
  encoder: string
  preset: string
  quality: number
}

export function buildCandidateLadder(targetCodec: 'av1' | 'hevc', encoderPolicy: 'hardware' | 'software' | 'compare', hardwareEncoder?: string): CandidateEncodingParameters[] {
  const softwareEncoder = targetCodec === 'av1' ? 'svt_av1' : 'x265'
  const hardware = hardwareEncoder ?? ''
  const encoders = encoderPolicy === 'hardware' ? [hardware] : encoderPolicy === 'software' ? [softwareEncoder] : [hardware, softwareEncoder]
  if (encoders.some(encoder => !encoder)) throw new Error('A verified hardware encoder is required for hardware candidate measurement')
  return encoders.flatMap(encoder => {
    const presets = encoder.startsWith('nvenc') ? ['p5', 'p6', 'p7'] : encoder === 'svt_av1' ? ['8', '6', '4'] : encoder.startsWith('qsv') ? ['medium', 'slow', 'veryslow'] : encoder.endsWith('_amf') ? ['speed', 'balanced', 'quality'] : encoder === 'vt_h265' ? ['quality', 'quality', 'quality'] : ['medium', 'slow', 'slower']
    const qualities = encoder.startsWith('qsv') ? APP_CONFIG.transcoding.qsvSampleQualities : APP_CONFIG.transcoding.sampleQualities
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

export class MeasuredQualityError extends Error {
  constructor(message: string, public readonly decisionStatus: 'quality_threshold_unmet' | 'incompatible') {
    super(message)
    this.name = 'MeasuredQualityError'
  }
}

export function selectMeasuredCandidate(profile: OptimizationQualityProfile, candidates: MeasuredCandidate[]): MeasuredCandidate {
  const gates = QUALITY_GATES[profile]
  const evaluations = evaluateMeasuredCandidates(profile, candidates)
  const eligible = evaluations
    .filter(evaluation => evaluation.passed)
    .map(evaluation => evaluation.candidate)
    .sort((left, right) => left.outputBytes - right.outputBytes)
  const selected = eligible[0]
  if (!selected) {
    const reports = evaluations.map(({ candidate, failedGates }) =>
      `${candidate.encoder}/${candidate.preset} q${candidate.quality}: VMAF mean ${candidate.vmafMean.toFixed(2)} (min ${gates.vmafMean}), VMAF p5 ${candidate.vmafP5.toFixed(2)} (min ${gates.vmafP5}), CAMBI ${candidate.cambiMean.toFixed(2)} (max ${gates.cambiMean}); failed=${failedGates.join(',')}`
    )
    const qualityPassed = evaluations.some(evaluation => evaluation.qualityPassed)
    throw new MeasuredQualityError(`No measured candidate satisfies the ${profile} quality and playback requirements. Candidate results: ${reports.join(' | ')}`, qualityPassed ? 'incompatible' : 'quality_threshold_unmet')
  }
  return selected
}

function evaluateMeasuredCandidates(profile: OptimizationQualityProfile, candidates: MeasuredCandidate[]): MeasuredCandidateEvaluation[] {
  const gates = QUALITY_GATES[profile]
  return candidates.map(candidate => {
    const failedGates = [
      ...(candidate.vmafMean >= gates.vmafMean ? [] : [`VMAF mean < ${gates.vmafMean}`]),
      ...(candidate.vmafP5 >= gates.vmafP5 ? [] : [`VMAF p5 < ${gates.vmafP5}`]),
      ...(candidate.cambiMean <= gates.cambiMean ? [] : [`CAMBI > ${gates.cambiMean}`]),
    ]
    const qualityPassed = failedGates.length === 0
    failedGates.push(...candidate.playbackBlockers ?? [])
    return { candidate, passed: failedGates.length === 0, qualityPassed, failedGates }
  })
}
