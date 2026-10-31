import { describe, expect, it } from 'vitest'
import { createInitialOptimizationConfiguration, createOptimizationConfiguration, mergeSavedOptimizationConfiguration, optimizationConfigurationFromOptions, optimizationConfigurationToOptions, optimizationReviewMatches, optimizationStreamSelection, unavailablePlaybackTargetMessage } from '../../src/renderer/src/components/library/transcoding/optimizationConfiguration'
import type { TranscodeOptions } from '../../src/main/services/TranscodingService'

describe('optimization configuration', () => {
  it('initializes all scopes through the same configuration shape', () => {
    expect(createInitialOptimizationConfiguration()).toEqual({
      optimizationMode: 'smart',
      targetProfileId: '',
      targetContainer: '',
      targetContainerSelection: 'automatic',
      outputMode: 'quarantine-replace',
      qualityProfile: 'balanced',
      encoderPolicy: 'automatic',
      targetCodec: 'hevc',
      targetAudioCodec: '',
      targetHdrFormat: '',
      audioTranscodeEnabled: false,
      removeUnnecessaryStreams: true,
      playbackPolicy: 'allow-transcoding',
      audioTrackPolicy: 'original-and-protected',
      originalAudioLanguage: '',
      subtitleLanguages: '',
    })
    expect(createOptimizationConfiguration({ optimizationMode: 'transcode', targetProfileId: 'living-room-tv', outputMode: 'copy' })).toMatchObject({
      optimizationMode: 'transcode', targetProfileId: 'living-room-tv', outputMode: 'copy',
    })
    expect(createInitialOptimizationConfiguration('remux_only')).toMatchObject({ optimizationMode: 'remux_only', qualityProfile: 'balanced', encoderPolicy: 'automatic', targetCodec: 'hevc' })
  })

  it('preserves selected saved-review values without inventing unset choices', () => {
    const options: TranscodeOptions = {
      optimizationMode: 'transcode',
      qualityProfile: 'balanced',
      encoderPolicy: 'software',
      targetProfileId: 'living-room-tv',
      targetContainer: 'mp4',
      targetCodec: 'hevc',
      targetAudioCodec: 'eac3',
      targetHdrFormat: 'HDR10',
      outputMode: 'copy',
    }

    expect(optimizationConfigurationFromOptions(options)).toEqual({
      optimizationMode: 'transcode',
      targetProfileId: 'living-room-tv',
      targetContainer: 'mp4',
      outputMode: 'copy',
      qualityProfile: 'balanced',
      encoderPolicy: 'software',
      targetCodec: 'hevc',
      targetAudioCodec: 'eac3',
      targetHdrFormat: 'HDR10',
      audioTranscodeEnabled: true,
      removeUnnecessaryStreams: true,
      playbackPolicy: 'allow-transcoding',
      audioTrackPolicy: 'all',
      originalAudioLanguage: '',
      subtitleLanguages: '',
    })
    expect(optimizationConfigurationFromOptions({}).optimizationMode).toBeUndefined()
  })

  it('restores saved container selection and preserves the current choice when older reviews omit it', () => {
    const current = createInitialOptimizationConfiguration('smart', { targetContainerSelection: 'automatic' })
    expect(mergeSavedOptimizationConfiguration(current, { targetContainer: 'mkv' }).targetContainerSelection).toBe('automatic')
    expect(mergeSavedOptimizationConfiguration(current, { targetContainer: 'mp4', targetContainerSelection: 'user-selected' }).targetContainerSelection).toBe('user-selected')
  })

  it('restores audio and subtitle policy from a saved review', () => {
    expect(optimizationConfigurationFromOptions({ streamSelection: {
      audio: 'original-and-protected', originalLanguage: 'eng', subtitle: 'all',
      subtitleLanguageWhitelist: ['eng', 'heb'], defaultSubtitle: 'preserve',
    } })).toMatchObject({
      audioTrackPolicy: 'original-and-protected', originalAudioLanguage: 'eng', subtitleLanguages: 'eng, heb',
    })
  })

  it('restores TV playback behavior and stream cleanup through shared configuration', () => {
    const restored = mergeSavedOptimizationConfiguration(createInitialOptimizationConfiguration(), {
      playbackPolicy: 'avoid-video-transcoding',
      streamSelection: { audio: 'all', subtitle: 'all' },
    })
    expect(restored.playbackPolicy).toBe('avoid-video-transcoding')
    expect(restored.removeUnnecessaryStreams).toBe(false)
  })

  it('serializes shared playback behavior and stream cleanup to existing options', () => {
    expect(optimizationConfigurationToOptions(createInitialOptimizationConfiguration('smart', {
      playbackPolicy: 'direct-play', removeUnnecessaryStreams: false,
    }))).toMatchObject({ playbackPolicy: 'direct-play', streamSelection: { audio: 'all', subtitle: 'all' } })
  })

  it('builds stream options from shared policy and applies the stream-removal switch', () => {
    const configuration = createInitialOptimizationConfiguration('smart', {
      audioTrackPolicy: 'original-and-protected', originalAudioLanguage: 'ENG', subtitleLanguages: 'eng, heb',
    })
    expect(optimizationStreamSelection(configuration)).toEqual({
      audio: 'original-and-protected', originalLanguage: 'eng', subtitle: 'all',
      subtitleLanguageWhitelist: ['eng', 'heb'], defaultSubtitle: 'preserve',
    })
    expect(optimizationStreamSelection(configuration, false)).toEqual({
      audio: 'all', subtitle: 'all', subtitleLanguageWhitelist: undefined, defaultSubtitle: 'preserve',
    })
  })

  it('invalidates a review when any reviewed setting changes', () => {
    const reviewed = { targetProfileId: 'living-room-tv', qualityProfile: 'balanced' }
    const key = JSON.stringify(reviewed)

    expect(optimizationReviewMatches(key, reviewed)).toBe(true)
    expect(optimizationReviewMatches(key, { ...reviewed, qualityProfile: 'transparent' })).toBe(false)
    expect(optimizationReviewMatches(null, reviewed)).toBe(false)
  })

  it('only reports a saved playback target unavailable when it is absent', () => {
    expect(unavailablePlaybackTargetMessage('', ['living-room-tv'])).toBeNull()
    expect(unavailablePlaybackTargetMessage('living-room-tv', ['living-room-tv'])).toBeNull()
    expect(unavailablePlaybackTargetMessage('removed-tv', ['living-room-tv'])).toBe('Saved playback target is unavailable. Choose another target or no target.')
  })

})
