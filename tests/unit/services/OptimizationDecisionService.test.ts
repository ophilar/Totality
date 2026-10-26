import { describe, expect, it } from 'vitest'
import { buildOptimizationDecision, buildUnavailableOptimizationDecision } from '@main/services/OptimizationDecisionService'

describe('buildOptimizationDecision', () => {
  it('reports track removal before audio and video transcoding', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 8_000,
      videoSavingsBytes: 2_000,
      audioTranscodeSavingsBytes: 1_000,
      audioTracks: [
        { index: 1, language: 'en', title: 'Original', codec: 'aac', channels: 2, bitrateKbps: 100, isDefault: true, hasObjectAudio: false, reliableTag: true },
        { index: 2, language: 'fr', title: 'French', codec: 'aac', channels: 2, bitrateKbps: 100, isDefault: false, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.primaryAction).toBe('remove-audio-tracks')
    expect(result.trackRemoval.status).toBe('executable')
    expect(result.trackRemoval.estimatedSavingsBytes).toBe(100_000)
    expect(result.trackRemoval.evidenceStatus).toBe('estimated')
    expect(result.trackRemoval.confidence).toBe('medium')
    expect(result.trackRemoval.savingsBasis).toBe('audio_bitrate_estimate')
    expect(result.audioTranscode.estimatedSavingsBytes).toBe(1_000)
    expect(result.videoTranscode.estimatedSavingsBytes).toBe(2_000)
  })

  it('requires review when an audio language is unknown', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 8_000,
      videoSavingsBytes: 2_000,
      audioTranscodeSavingsBytes: null,
      audioTracks: [{ index: 1, language: undefined, codec: 'aac', channels: 2, bitrateKbps: 100, isDefault: true, hasObjectAudio: false }],
    })

    expect(result.trackRemoval.status).toBe('review-required')
    expect(result.primaryAction).toBe('review-language')
    expect(result.trackRemoval.estimatedSavingsBytes).toBe(null)
    expect(result.trackRemoval.evidenceStatus).toBe('insufficient')
    expect(result.trackRemoval.confidence).toBe('none')
  })

  it('estimates conversion savings for measured tracks while original language needs review', () => {
    const result = buildOptimizationDecision({
      originalLanguage: undefined,
      durationMs: 3600_000,
      videoSavingsBytes: 0,
      audioTranscodeSavingsBytes: null,
      audioTracks: [{ index: 1, language: 'en', codec: 'truehd', channels: 8, bitrateKbps: 4800, isDefault: true, hasObjectAudio: false, reliableTag: true }],
    })

    expect(result.trackRemoval.status).toBe('review-required')
    expect(result.audioTranscode.status).toBe('executable')
    expect(result.audioTranscode.estimatedSavingsBytes).toBeGreaterThan(0)
  })

  it('does not count a language-selected removal as an audio conversion during review', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3_600_000,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'fr', codec: 'truehd', channels: 8, bitrateKbps: 4800, isDefault: false, hasObjectAudio: false, reliableTag: true },
        { index: 2, codec: 'truehd', channels: 8, bitrateKbps: 4800, isDefault: false, hasObjectAudio: false },
      ],
    })

    expect(result.trackRemoval.status).toBe('review-required')
    expect(result.trackRemoval.removableTrackIndexes).toEqual([1])
    expect(result.audioTranscode.estimatedSavingsBytes).toBe(1_872_000_000)
  })

  it('protects commentary and object-audio tracks from removal', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 8_000,
      videoSavingsBytes: 0,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'en', codec: 'truehd', channels: 8, bitrateKbps: 500, isDefault: true, hasObjectAudio: true, reliableTag: true },
        { index: 2, language: 'fr', title: 'Commentary', codec: 'aac', channels: 2, bitrateKbps: 100, isDefault: false, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.trackRemoval.retainedTrackIndexes).toEqual([1, 2])
    expect(result.trackRemoval.removableTrackIndexes).toEqual([])
    expect(result.primaryAction).toBe('no-action')
  })

  it('suggests audio transcoding and computes savings for lossless TrueHD/DTS-HD audio', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3600_000,
      videoSavingsBytes: 0,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'en', codec: 'truehd', channels: 8, bitrateKbps: 4800, isDefault: true, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.audioTranscode.status).toBe('executable')
    expect(result.audioTranscode.estimatedSavingsBytes).toBeGreaterThan(0)
    expect(result.audioTranscode.reason).toContain('lossy conversion of lossless audio')
    expect(result.primaryAction).toBe('transcode-audio')
  })

  it('does not invent audio savings from codec or channel defaults when a stream bitrate is absent', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3600_000,
      videoSavingsBytes: null,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'en', codec: 'truehd', channels: 8, isDefault: true, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.audioTranscode.status).toBe('unavailable')
    expect(result.audioTranscode.evidenceStatus).toBe('insufficient')
    expect(result.audioTranscode.confidence).toBe('none')
    expect(result.audioTranscode.savingsBasis).toBe('insufficient_data')
    expect(result.audioTranscode.estimatedSavingsBytes).toBe(null)
  })

  it('preserves measured zero savings when eligible audio is already within target', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3_600_000,
      videoSavingsBytes: null,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'en', codec: 'aac', channels: 2, bitrateKbps: 128, isDefault: true, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.audioTranscode.status).toBe('unavailable')
    expect(result.audioTranscode.estimatedSavingsBytes).toBe(0)
    expect(result.audioTranscode.evidenceStatus).toBe('estimated')
  })

  it('marks video transcoding unavailable without an evidenced video savings value', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3600_000,
      videoSavingsBytes: null,
      audioTranscodeSavingsBytes: null,
      audioTracks: [],
    })

    expect(result.videoTranscode.status).toBe('unavailable')
    expect(result.videoTranscode.evidenceStatus).toBe('insufficient')
    expect(result.videoTranscode.confidence).toBe('none')
    expect(result.videoTranscode.savingsBasis).toBe('insufficient_data')
    expect(result.videoTranscode.estimatedSavingsBytes).toBe(null)
    expect(result.videoTranscode.reason).toContain('file-size savings cannot be estimated')
  })

  it('allows measured preflight when video is present and savings are unknown', () => {
    const result = buildOptimizationDecision({ originalLanguage: 'en', durationMs: 60_000, videoAvailable: true, videoSavingsBytes: null, audioTracks: [] })
    expect(result.videoTranscode.status).toBe('review-required')
    expect(result.videoTranscode.estimatedSavingsBytes).toBeNull()
    expect(result.videoTranscode.reason).toContain('measured encode samples')
  })

  it('keeps a positive storage estimate available for review', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en', fileSize: 50_000_000, durationMs: 3600_000,
      videoSavingsBytes: 12_000_000, audioTranscodeSavingsBytes: null, audioTracks: [],
    })

    expect(result.videoTranscode.status).toBe('review-required')
    expect(result.videoTranscode.evidenceStatus).toBe('estimated')
    expect(result.videoTranscode.estimatedSavingsBytes).toBe(12_000_000)
    expect(result.videoTranscode.savingsBasis).toBe('video_bitrate_estimate')
    expect(result.videoTranscode.reason).toContain('visual quality is not assessed')
  })

  it('uses video transcode as the primary action when it has estimated savings', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3600_000,
      videoSavingsBytes: 12_000_000,
      audioTranscodeSavingsBytes: null,
      audioTracks: [],
    })

    expect(result.primaryAction).toBe('transcode-video')
  })

  it('keeps zero codec-model savings visible with its assumed destination', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3600_000,
      videoSavingsBytes: 0,
      videoTargetCodec: 'av1',
      videoAvailable: true,
      audioTracks: [],
    })

    expect(result.videoTranscode.estimatedSavingsBytes).toBe(0)
    expect(result.videoTranscode.assumedTargetCodec).toBe('av1')
    expect(result.videoTranscode.confidence).toBe('low')
    expect(result.videoTranscode.reason).toContain('predicts no size reduction')
    expect(result.videoTranscode.status).toBe('review-required')
  })

  it('excludes removable tracks from audio-transcode savings', () => {
    const retainedTrack = { index: 1, language: 'en', codec: 'truehd', channels: 8, bitrateKbps: 4800, isDefault: true, hasObjectAudio: false, reliableTag: true }
    const removableTrack = { index: 2, language: 'fr', codec: 'truehd', channels: 8, bitrateKbps: 4800, isDefault: false, hasObjectAudio: false, reliableTag: true }

    const retainedOnly = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3600_000,
      videoSavingsBytes: 0,
      audioTranscodeSavingsBytes: null,
      audioTracks: [retainedTrack],
    })
    const mixed = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 3600_000,
      videoSavingsBytes: 0,
      audioTranscodeSavingsBytes: null,
      audioTracks: [retainedTrack, removableTrack],
    })

    expect(mixed.trackRemoval.removableTrackIndexes).toEqual([2])
    expect(mixed.audioTranscode.estimatedSavingsBytes).toBe(retainedOnly.audioTranscode.estimatedSavingsBytes)
  })

  it('uses video savings directly without subtracting estimated audio removal again', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      durationMs: 1_000_000,
      videoSavingsBytes: 200_000_000,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'en', codec: 'aac', channels: 2, bitrateKbps: 192, isDefault: true, hasObjectAudio: false, reliableTag: true },
        { index: 2, language: 'fr', codec: 'aac', channels: 2, bitrateKbps: 800, isDefault: false, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.trackRemoval.estimatedSavingsBytes).toBe(100_000_000)
    expect(result.videoTranscode.estimatedSavingsBytes).toBe(200_000_000)
    expect(result.primaryAction).toBe('remove-audio-tracks')
  })

  it('builds an unavailable optimization decision with reason and originalLanguage', () => {
    const result = buildUnavailableOptimizationDecision('Not authorized', 'ja')

    expect(result.primaryAction).toBe('no-action')
    expect(result.trackRemoval.status).toBe('unavailable')
    expect(result.trackRemoval.reason).toBe('Not authorized')
    expect(result.trackRemoval.originalLanguage).toBe('ja')
    expect(result.trackRemoval.evidenceStatus).toBe('insufficient')
    expect(result.trackRemoval.confidence).toBe('none')
    expect(result.audioTranscode.status).toBe('unavailable')
    expect(result.audioTranscode.reason).toBe('Not authorized')
    expect(result.videoTranscode.status).toBe('unavailable')
    expect(result.videoTranscode.reason).toBe('Not authorized')
  })
})
