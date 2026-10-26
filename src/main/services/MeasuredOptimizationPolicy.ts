
import { APP_CONFIG } from '@main/config'

export type OptimizationQualityProfile = 'transparent' | 'balanced' | 'maximum_savings'

export const MEASUREMENT_VERSION = 9
export const SHOW_PREFLIGHT_SETTING_PREFIX = 'transcoding.preflight.'
export const MEASUREMENT_SETTING_PREFIX = 'transcoding.measurement.'

export interface CachedMeasurement {
  version: number
  cacheKey: string
  sourceSha256: string
  complete: boolean
  candidates: MeasuredCandidate[]
  sampleHashes: string[][]
  partialSamples: MeasuredCandidateSample[]
  partialSampleHashes: string[]
}

export interface MeasuredCandidateSample {
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
}

export interface CandidateEncodingParameters {
  encoder: string
  preset: string
  quality: number
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

export function buildQualityBoundaryCandidates(
  candidates: CandidateEncodingParameters[],
  measurements: MeasuredCandidate[],
): CandidateEncodingParameters[] {
  const additions = new Map<string, CandidateEncodingParameters>()
  const candidateKeys = new Set(candidates.map(candidate => `${candidate.encoder}/${candidate.preset}/${candidate.quality}`))
  const measuredByEncoderAndPreset = new Map<string, MeasuredCandidate[]>()
  for (const measurement of measurements) {
    const key = `${measurement.encoder}/${measurement.preset}`
    measuredByEncoderAndPreset.set(key, [...(measuredByEncoderAndPreset.get(key) ?? []), measurement])
  }

  for (const { encoder, preset } of candidates) {
    const key = `${encoder}/${preset}`
    const measured = measuredByEncoderAndPreset.get(key) ?? []
    const testedQualities = new Set(measured.map(candidate => candidate.quality))
    const ordered = [...measured].sort((left, right) => left.quality - right.quality)
    for (const profile of ['transparent', 'balanced', 'maximum_savings'] as const) {
      for (let index = 1; index < ordered.length; index += 1) {
        const betterQuality = ordered[index - 1]
        const smallerFile = ordered[index]
        const qualityPasses = (candidate: MeasuredCandidate) => {
          const gates = QUALITY_GATES[profile]
          return candidate.vmafMean >= gates.vmafMean && candidate.vmafP5 >= gates.vmafP5 && candidate.cambiMean <= gates.cambiMean
        }
        if (qualityPasses(betterQuality) === qualityPasses(smallerFile) || smallerFile.quality - betterQuality.quality <= 1) continue
        const quality = Math.floor((betterQuality.quality + smallerFile.quality) / 2)
        if (testedQualities.has(quality) || candidateKeys.has(`${encoder}/${preset}/${quality}`)) continue
        additions.set(`${encoder}/${preset}/${quality}`, { encoder, preset, quality })
      }
    }
  }

  return [...additions.values()]
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

export function getNonDominatedMeasuredCandidates(profile: OptimizationQualityProfile, candidates: MeasuredCandidate[]): MeasuredCandidate[] {
  const eligible = evaluateMeasuredCandidates(profile, candidates)
    .filter(evaluation => evaluation.passed)
    .map(evaluation => evaluation.candidate)
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
      ...(candidate.vmafMean >= gates.vmafMean ? [] : [`VMAF mean < ${gates.vmafMean}`]),
      ...(candidate.vmafP5 >= gates.vmafP5 ? [] : [`VMAF p5 < ${gates.vmafP5}`]),
      ...(candidate.cambiMean <= gates.cambiMean ? [] : [`CAMBI > ${gates.cambiMean}`]),
    ]
    const qualityPassed = failedGates.length === 0
    failedGates.push(...candidate.playbackBlockers ?? [])
    return { candidate, passed: failedGates.length === 0, qualityPassed, failedGates }
  })
}
