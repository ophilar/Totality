import { describe, expect, it } from 'vitest'
import { PlaybackCompatibilityService, type ProviderPlaybackDecision } from '@main/services/PlaybackCompatibilityService'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'

const profile: PlaybackTargetProfile = {
  id: 'lg', name: 'LG TV', createdAt: '', updatedAt: '',
  definition: {
    containers: ['matroska'],
    video: { codecs: ['h264'], profiles: ['High'], levels: [52], maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, bitDepths: [8] },
    hdr: { formats: ['HDR10'], fallbackRequired: false },
    audio: { codecs: ['aac'], maxChannels: 2, objectAudio: false, outputPath: 'device' },
    subtitles: { formats: ['srt'], embedded: true, external: false, burnIn: false },
    network: { sustainableBitrate: 100_000_000 },
    client: { product: 'Plex for LG', platform: 'webOS', version: '1' },
  },
}
const analysis: FileAnalysisResult = {
  success: true,
  filePath: '/media/movie.mkv',
  container: 'matroska',
  overallBitrateKbps: 10_000,
  video: { index: 0, codec: 'hevc', profile: 'Main 10', level: 120, width: 1920, height: 1080, bitDepth: 10 },
  audioTracks: [{ index: 1, codec: 'dts', channels: 6, language: 'jpn', isDefault: true, hasObjectAudio: false }],
  subtitleTracks: [],
}
const item = {
  id: 1, file_path: analysis.filePath, source_type: 'plex',
  source_id: 'plex', plex_id: '123', deep_analysis: JSON.stringify(analysis),
}
const db = {
  media: { getItemById: async () => item },
  playbackTargetProfiles: { get: async () => profile },
}
function service(decision: ProviderPlaybackDecision) {
  return new PlaybackCompatibilityService(db, { plex: { getDecision: async () => decision } })
}

describe('PlaybackCompatibilityService', () => {
  it('reports server transcoding separately from incompatible direct play', async () => {
    const result = await service({
      provider: 'plex', overall: 'transcode', video: 'transcode', audio: 'transcode',
      subtitle: 'not-applicable', evidence: 'Conversion OK',
    }).evaluate(1, 'lg')
    expect(result.evaluation.overall).toBe('incompatible')
    expect(result.presentation).toBe('server-transcode')
    expect(result.providerDecision?.video).toBe('transcode')
  })

  it('reports Plex direct stream even when local container support is limited', async () => {
    const result = await service({
      provider: 'plex', overall: 'direct-stream', video: 'copy', audio: 'transcode',
      subtitle: 'not-applicable', evidence: 'Direct stream',
    }).evaluate(1, 'lg')
    expect(result.presentation).toBe('direct-stream')
  })

  it('distinguishes an unevaluated server from confirmed incompatibility', async () => {
    const withoutClient = { ...profile, definition: { ...profile.definition, client: undefined } }
    const isolated = new PlaybackCompatibilityService({
      ...db,
      playbackTargetProfiles: { get: async () => withoutClient },
    })
    const result = await isolated.evaluate(1, 'lg')
    expect(result.presentation).toBe('direct-play-unsupported')
    expect(result.providerDecision).toBeUndefined()
  })

  it('distinguishes unspecified Plex server conversion from an actual stream transcode', async () => {
    const result = await service({
      provider: 'plex', overall: 'conversion', video: 'unknown', audio: 'unknown',
      subtitle: 'unknown', evidence: 'Conversion OK',
    }).evaluate(1, 'lg')
    expect(result.evaluation.overall).toBe('incompatible')
    expect(result.presentation).toBe('server-conversion')
  })

  it('reports a provider prediction failure explicitly', async () => {
    const failed = new PlaybackCompatibilityService(db, {
      plex: { getDecision: async () => { throw new Error('Plex cannot convert') } },
    })
    const result = await failed.evaluate(1, 'lg')
    expect(result.presentation).toBe('provider-decision-unavailable')
    expect(result.providerDecisionError).toContain('Plex cannot convert')
  })
})
