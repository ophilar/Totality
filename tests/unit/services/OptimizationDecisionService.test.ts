import { describe, expect, it } from 'vitest'
import { buildOptimizationDecision } from '@main/services/OptimizationDecisionService'

describe('buildOptimizationDecision', () => {
  it('reports track removal before audio and video transcoding', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      fileSize: 10_000,
      durationSeconds: 8,
      videoStorageDebtBytes: 2_000,
      audioTranscodeSavingsBytes: 1_000,
      audioTracks: [
        { index: 1, language: 'en', title: 'Original', codec: 'aac', channels: 2, bitrate: 100, isDefault: true, hasObjectAudio: false, reliableTag: true },
        { index: 2, language: 'fr', title: 'French', codec: 'aac', channels: 2, bitrate: 100, isDefault: false, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.primaryAction).toBe('remove-audio-tracks')
    expect(result.trackRemoval.status).toBe('executable')
    expect(result.trackRemoval.estimatedSavingsBytes).toBe(100_000)
    expect(result.trackRemoval.evidence_status).toBe('measured')
    expect(result.trackRemoval.confidence).toBe('high')
    expect(result.trackRemoval.savings_basis).toBe('audio_stream_removal')
    expect(result.audioTranscode.estimatedSavingsBytes).toBe(1_000)
    expect(result.videoTranscode.estimatedSavingsBytes).toBe(2_000)
  })

  it('requires review when an audio language is unknown', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      fileSize: 10_000,
      durationSeconds: 8,
      videoStorageDebtBytes: 2_000,
      audioTranscodeSavingsBytes: null,
      audioTracks: [{ index: 1, language: undefined, codec: 'aac', channels: 2, bitrate: 100, isDefault: true, hasObjectAudio: false }],
    })

    expect(result.trackRemoval.status).toBe('review-required')
    expect(result.primaryAction).toBe('review-language')
    expect(result.trackRemoval.estimatedSavingsBytes).toBe(null)
    expect(result.trackRemoval.evidence_status).toBe('insufficient')
    expect(result.trackRemoval.confidence).toBe('none')
  })

  it('protects commentary and object-audio tracks from removal', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      fileSize: 10_000,
      durationSeconds: 8,
      videoStorageDebtBytes: 0,
      audioTranscodeSavingsBytes: null,
      videoStorageDebtBytes: 2_000,
      audioTracks: [
        { index: 1, language: 'en', codec: 'truehd', channels: 8, bitrate: 500, isDefault: true, hasObjectAudio: true, reliableTag: true },
        { index: 2, language: 'fr', title: 'Commentary', codec: 'aac', channels: 2, bitrate: 100, isDefault: false, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.trackRemoval.retainedTrackIndexes).toEqual([1, 2])
    expect(result.trackRemoval.removableTrackIndexes).toEqual([])
    expect(result.primaryAction).toBe('no-action')
  })

  it('suggests audio transcoding and computes savings for lossless TrueHD/DTS-HD audio', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      fileSize: 50_000_000,
      durationSeconds: 3600, // 1 hour
      videoStorageDebtBytes: 0,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'en', codec: 'truehd', channels: 8, bitrate: 4800, isDefault: true, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.audioTranscode.status).toBe('executable')
    expect(result.audioTranscode.estimatedSavingsBytes).toBeGreaterThan(0)
    expect(result.primaryAction).toBe('transcode-audio')
  })

  it('does not invent audio savings from codec or channel defaults when a stream bitrate is absent', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      fileSize: 50_000_000,
      durationSeconds: 3600,
      videoStorageDebtBytes: null,
      audioTranscodeSavingsBytes: null,
      audioTracks: [
        { index: 1, language: 'en', codec: 'truehd', channels: 8, isDefault: true, hasObjectAudio: false, reliableTag: true },
      ],
    })

    expect(result.audioTranscode.status).toBe('unavailable')
    expect(result.audioTranscode.evidence_status).toBe('insufficient')
    expect(result.audioTranscode.confidence).toBe('none')
    expect(result.audioTranscode.savings_basis).toBe('insufficient_data')
    expect(result.audioTranscode.estimatedSavingsBytes).toBe(null)
  })

  it('marks video transcoding unavailable without an evidenced video savings value', () => {
    const result = buildOptimizationDecision({
      originalLanguage: 'en',
      fileSize: 50_000_000,
      durationSeconds: 3600,
      videoStorageDebtBytes: null,
      audioTranscodeSavingsBytes: null,
      audioTracks: [],
    })

    expect(result.videoTranscode.status).toBe('unavailable')
    expect(result.videoTranscode.evidence_status).toBe('insufficient')
    expect(result.videoTranscode.confidence).toBe('none')
    expect(result.videoTranscode.savings_basis).toBe('insufficient_data')
    expect(result.videoTranscode.estimatedSavingsBytes).toBe(null)
  })
})
