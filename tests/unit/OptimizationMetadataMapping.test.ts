import { describe, expect, it } from 'vitest'
import { mapAudioTracksForOptimization } from '@main/services/utils/audioTrackUtils'
import { buildOptimizationDecision } from '@main/services/OptimizationDecisionService'
import type { AudioTrack } from '@main/types/database'
import type { AnalyzedAudioStream } from '@main/services/MediaFileAnalyzer'

const providerTracks: AudioTrack[] = [
  { index: 0, codec: 'AAC', channels: 2, bitrate: 192, language: 'jpn', title: 'Japanese', isDefault: true, hasObjectAudio: false },
  { index: 1, codec: 'AC3', channels: 6, bitrate: 448, language: 'eng', title: 'English', isDefault: false, hasObjectAudio: false },
]
const analyzedTracks: AnalyzedAudioStream[] = [
  { index: 2, codec: 'aac', channels: 2, bitrateKbps: 190, language: 'und', isDefault: true, hasObjectAudio: false },
  { index: 3, codec: 'ac3', channels: 6, bitrateKbps: 440, isDefault: false, hasObjectAudio: false },
]

describe('optimization audio evidence mapping', () => {
  it('preserves provider language when FFprobe omits the tag for the same stream', () => {
    const tracks = mapAudioTracksForOptimization(providerTracks, analyzedTracks)
    expect(tracks.map(track => [track.index, track.language])).toEqual([[2, 'ja'], [3, 'en']])
    expect(tracks.map(track => track.bitrateKbps)).toEqual([190, 440])
    expect(tracks.every(track => track.reliableTag)).toBe(true)
  })

  it('recognizes a Hebrew metadata label and the equivalent ISO tag on a probed stream', () => {
    const tracks = mapAudioTracksForOptimization(
      [{ index: 0, streamIndex: 2, codec: 'aac', channels: 2, bitrate: 192, language: 'עברית' }],
      [{ index: 2, codec: 'aac', channels: 2, language: 'heb', isDefault: true, hasObjectAudio: false }],
    )
    expect(tracks[0].language).toBe('he')
    expect(tracks[0].reliableTag).toBe(true)
  })

  it('preserves metadata-only languages and bitrate fields without trusting ordinal indexes for pruning', () => {
    const tracks = mapAudioTracksForOptimization(providerTracks)
    expect(tracks.map(track => track.language)).toEqual(['ja', 'en'])
    expect(tracks.map(track => track.bitrateKbps)).toEqual([192, 448])
    expect(tracks.map(track => track.reliableTag)).toEqual([false, false])
    const decision = buildOptimizationDecision({ originalLanguage: null, audioTracks: tracks })
    expect(decision.trackRemoval.reason).toContain('Japanese')
    expect(decision.trackRemoval.reason).not.toContain('audio track languages are unknown')
    expect(decision.trackRemoval.removableTrackIndexes).toEqual([])
  })

  it('does not misassign language tags when provider and probe stream inventories differ', () => {
    const changed = [{ ...analyzedTracks[0], codec: 'flac' }, analyzedTracks[1]]
    const tracks = mapAudioTracksForOptimization(providerTracks, changed)
    expect(tracks[0].language).toBeUndefined()
    expect(tracks[0].reliableTag).toBe(false)
    expect(tracks[1].language).toBe('en')
  })

  it('retains an independently probed language without guessing a provider identity', () => {
    const changed = [{ ...analyzedTracks[0], language: 'fra' }, analyzedTracks[1]]
    const tracks = mapAudioTracksForOptimization(providerTracks, changed)
    expect(tracks[0].language).toBe('fr')
    expect(tracks[0].reliableTag).toBe(true)
  })
  it('reconciles reordered same-codec streams by their native indices', () => {
    const repeated: AnalyzedAudioStream[] = [
      { index: 3, codec: 'aac', channels: 2, isDefault: false, hasObjectAudio: false },
      { index: 4, codec: 'aac', channels: 2, isDefault: true, hasObjectAudio: false },
    ]
    const tagged: AudioTrack[] = [
      { index: 0, streamIndex: 4, codec: 'aac', channels: 2, bitrate: 192, language: 'jpn' },
      { index: 1, streamIndex: 3, codec: 'aac', channels: 2, bitrate: 192, language: 'eng' },
    ]
    expect(mapAudioTracksForOptimization(tagged, repeated).map(track => track.language)).toEqual(['en', 'ja'])
  })

  it('reconciles reordered same-codec streams using uniquely matching languages', () => {
    const repeated: AnalyzedAudioStream[] = [
      { index: 3, codec: 'aac', channels: 2, language: 'eng', isDefault: false, hasObjectAudio: false },
      { index: 4, codec: 'aac', channels: 2, language: 'jpn', isDefault: true, hasObjectAudio: false },
    ]
    const tagged: AudioTrack[] = [
      { index: 0, codec: 'aac', channels: 2, bitrate: 192, language: 'jpn' },
      { index: 1, codec: 'aac', channels: 2, bitrate: 192, language: 'eng' },
    ]
    expect(mapAudioTracksForOptimization(tagged, repeated).map(track => track.language)).toEqual(['en', 'ja'])
  })

  it('uses distinguishing sample rates rather than stream order when language is missing', () => {
    const repeated: AnalyzedAudioStream[] = [
      { index: 3, codec: 'aac', channels: 2, sampleRate: 44100, isDefault: false, hasObjectAudio: false },
      { index: 4, codec: 'aac', channels: 2, sampleRate: 48000, isDefault: true, hasObjectAudio: false },
    ]
    const tagged: AudioTrack[] = [
      { index: 0, codec: 'aac', channels: 2, sampleRate: 48000, bitrate: 192, language: 'jpn' },
      { index: 1, codec: 'aac', channels: 2, sampleRate: 44100, bitrate: 192, language: 'eng' },
    ]
    expect(mapAudioTracksForOptimization(tagged, repeated).map(track => track.language)).toEqual(['en', 'ja'])
  })

  it('does not attach languages to indistinguishable tracks by position', () => {
    const repeated: AnalyzedAudioStream[] = [
      { index: 3, codec: 'aac', channels: 2, isDefault: false, hasObjectAudio: false },
      { index: 4, codec: 'aac', channels: 2, isDefault: false, hasObjectAudio: false },
    ]
    const tagged: AudioTrack[] = [
      { index: 0, codec: 'aac', channels: 2, bitrate: 192, language: 'jpn' },
      { index: 1, codec: 'aac', channels: 2, bitrate: 192, language: 'eng' },
    ]
    expect(mapAudioTracksForOptimization(tagged, repeated).map(track => track.language)).toEqual([undefined, undefined])
  })

  it('does not override conflicting native stream language metadata', () => {
    const tracks = mapAudioTracksForOptimization(
      [{ ...providerTracks[0], streamIndex: 2 }],
      [{ ...analyzedTracks[0], language: 'fra' }],
    )
    expect(tracks[0].language).toBeUndefined()
    expect(tracks[0].reliableTag).toBe(false)
  })

})
