export interface OptimizationReadinessInput {
  outputModeSelected: boolean
  videoTranscode: boolean
  videoCodecSelected?: boolean
  videoCodecSupported?: boolean
  qualityProfileSelected?: boolean
  encoderPolicySelected?: boolean
  audioTranscode?: boolean
  audioCodecSelected?: boolean
  streamPruning?: boolean
  originalAudioLanguageSelected?: boolean
  playbackTargetRequired?: boolean
  playbackTargetSelected?: boolean
  additionalRequirements?: Array<{ label: string; ready: boolean }>
}

export function getMissingOptimizationSettings(input: OptimizationReadinessInput): string[] {
  const missing: string[] = []
  if (!input.outputModeSelected) missing.push('output handling')
  if (input.videoTranscode) {
    if (!input.videoCodecSelected) missing.push('output video codec')
    else if (input.videoCodecSupported === false) missing.push('a codec supported by this playback target and encoder')
    if (!input.qualityProfileSelected) missing.push('quality preference')
    if (!input.encoderPolicySelected) missing.push('encoder policy')
  }
  if (input.audioTranscode && !input.audioCodecSelected) missing.push('output audio codec')
  if (input.streamPruning && !input.originalAudioLanguageSelected) missing.push('original language for stream cleanup')
  if (input.playbackTargetRequired && !input.playbackTargetSelected) missing.push('playback target')
  for (const requirement of input.additionalRequirements ?? []) {
    if (!requirement.ready) missing.push(requirement.label)
  }
  return missing
}
