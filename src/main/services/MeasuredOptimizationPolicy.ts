export type OptimizationQualityProfile = 'transparent' | 'balanced' | 'maximum_savings'

export interface MeasuredCandidate {
  encoder: string
  preset: string
  quality: number
  outputBytes: number
  vmafMean: number
  vmafP5: number
  cambiMean: number
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
  return encoders.flatMap(encoder => [
    { encoder, preset: encoder.includes('nvenc') ? 'p5' : 'medium', quality: 18 },
    { encoder, preset: encoder.includes('nvenc') ? 'p6' : 'slow', quality: 22 },
    { encoder, preset: encoder.includes('nvenc') ? 'p7' : 'slower', quality: 26 }
  ])
}

interface QualityGates {
  vmafMean: number
  vmafP5: number
  cambiMean: number
}

const QUALITY_GATES: Record<OptimizationQualityProfile, QualityGates> = {
  transparent: { vmafMean: 96, vmafP5: 93, cambiMean: 5 },
  balanced: { vmafMean: 95, vmafP5: 92, cambiMean: 8 },
  maximum_savings: { vmafMean: 93, vmafP5: 88, cambiMean: 12 }
}

export function selectMeasuredCandidate(profile: OptimizationQualityProfile, candidates: MeasuredCandidate[]): MeasuredCandidate {
  const gates = QUALITY_GATES[profile]
  const eligible = candidates
    .filter(candidate => candidate.vmafMean >= gates.vmafMean && candidate.vmafP5 >= gates.vmafP5 && candidate.cambiMean <= gates.cambiMean)
    .sort((left, right) => left.outputBytes - right.outputBytes)
  const selected = eligible[0]
  if (!selected) throw new Error(`No measured candidate satisfies the ${profile} quality gates`)
  return selected
}
