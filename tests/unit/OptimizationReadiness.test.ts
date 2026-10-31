import { describe, expect, it } from 'vitest'
import { describeMissingOptimizationSettings, getMissingOptimizationSettings } from '../../src/renderer/src/components/library/transcoding/readiness'

describe('optimization readiness', () => {
  it('allows cleanup-only preparation without video choices', () => {
    expect(getMissingOptimizationSettings({ outputModeSelected: true, videoTranscode: false, streamPruning: false })).toEqual([])
  })

  it('requires only the relevant audio choices for audio cleanup or conversion', () => {
    expect(getMissingOptimizationSettings({ outputModeSelected: true, videoTranscode: false, audioTranscode: true })).toEqual(['output audio codec'])
    expect(getMissingOptimizationSettings({ outputModeSelected: true, videoTranscode: false, streamPruning: true })).toEqual(['original audio language'])
  })

  it('requires supported video format, quality, and encoder settings for video conversion', () => {
    expect(getMissingOptimizationSettings({ outputModeSelected: true, videoTranscode: true, videoCodecSelected: true, videoCodecSupported: false, qualityProfileSelected: true, encoderPolicySelected: true })).toEqual(['a supported video format'])
  })

  it('explains the first actionable blocker in concise user-facing language', () => {
    expect(describeMissingOptimizationSettings(['original audio language'])).toBe('Choose the original audio language under Audio and subtitles.')
    expect(describeMissingOptimizationSettings(['a supported video format'])).toBe('Choose a supported video format above.')
  })
})
