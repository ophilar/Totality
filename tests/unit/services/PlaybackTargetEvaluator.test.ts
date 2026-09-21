import { describe, expect, it } from 'vitest'
import { evaluatePlaybackTarget, type PlaybackTargetProfile } from '@main/types/playbackTarget'

const profile: PlaybackTargetProfile = { id: 'p1', name: 'test', isBuiltin: false, createdAt: '', updatedAt: '', definition: { containers: ['matroska'], video: { codecs: ['hevc'], profiles: ['Main 10'], levels: [51], maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, bitDepths: [10] }, hdr: { formats: ['HDR10'], fallbackRequired: false }, audio: { codecs: ['eac3'], maxChannels: 8, objectAudio: false, outputPath: 'device' }, subtitles: { formats: ['srt'], embedded: true, external: true, burnIn: false }, network: { sustainableBitrate: 100000000 } } }
const analysis = (overrides = {}) => ({ success: true, filePath: 'x', container: 'matroska', overallBitrate: 50000000, video: { index: 0, codec: 'hevc', profile: 'Main 10', level: 51, width: 3840, height: 2160, frameRate: 24, bitDepth: 10, hdrFormat: 'HDR10' as const }, audioTracks: [{ index: 1, codec: 'eac3', channels: 8, hasObjectAudio: false, isDefault: true }], subtitleTracks: [], ...overrides })

describe('evaluatePlaybackTarget', () => {
  it('returns compatible findings with local-analysis provenance', () => { const result = evaluatePlaybackTarget(profile, analysis()); expect(result.overall).toBe('compatible'); expect(result.findings.video.source).toBe('local-analysis') })
  it('reports incompatible dimensions independently', () => { const result = evaluatePlaybackTarget(profile, analysis({ container: 'mp4' })); expect(result.overall).toBe('incompatible'); expect(result.findings.container.status).toBe('incompatible'); expect(result.findings.video.status).toBe('compatible') })
  it('applies a conditional container rule only to matching video properties', () => {
    const conditionalProfile = { ...profile, definition: { ...profile.definition, containers: ['matroska', 'mp4'], video: { ...profile.definition.video, containerRules: [{ containers: ['mp4'], profiles: ['dvhe.05'], hdrFormats: ['Dolby Vision'] }] } } }
    const dolbyVision = analysis({ container: 'matroska', video: { ...analysis().video, profile: 'dvhe.05.06', hdrFormat: 'Dolby Vision' } })
    const regularHevc = analysis({ container: 'matroska' })
    expect(evaluatePlaybackTarget(conditionalProfile, dolbyVision).findings.container.status).toBe('incompatible')
    expect(evaluatePlaybackTarget(conditionalProfile, regularHevc).findings.container.status).toBe('compatible')
  })
})
