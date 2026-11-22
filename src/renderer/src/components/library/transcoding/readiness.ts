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
  if (!input.outputModeSelected) missing.push('save output')
  if (input.videoTranscode) {
    if (!input.videoCodecSelected) missing.push('video format')
    else if (input.videoCodecSupported === false) missing.push('a supported video format')
    if (!input.qualityProfileSelected) missing.push('quality')
    if (!input.encoderPolicySelected) missing.push('encoder')
  }
  if (input.audioTranscode && !input.audioCodecSelected) missing.push('output audio codec')
  if (input.streamPruning && !input.originalAudioLanguageSelected) missing.push('original audio language')
  if (input.playbackTargetRequired && !input.playbackTargetSelected) missing.push('playback target')
  for (const requirement of input.additionalRequirements ?? []) {
    if (!requirement.ready) missing.push(requirement.label)
  }
  return missing
}

export function describeMissingOptimizationSettings(missing: readonly string[]): string {
  if (missing.includes('original audio language')) return 'Choose the original audio language under Audio and subtitles.'
  if (missing.includes('a supported video format')) return 'Choose a supported video format above.'
  if (missing.includes('video format')) return 'Choose a video format above.'
  if (missing.includes('quality')) return 'Choose a quality above.'
  if (missing.includes('encoder')) return 'Choose an encoder in Advanced settings.'
  if (missing.includes('output audio codec')) return 'Choose an audio format in Advanced settings.'
  if (missing.includes('save output')) return 'Choose how to save the output.'
  if (missing.includes('playback target')) return 'Choose a playback target above.'
  return `Complete: ${missing.join(', ')}.`
}
