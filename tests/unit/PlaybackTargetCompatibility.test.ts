import { describe, expect, it } from 'vitest'
import { evaluatePlaybackTarget, type PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'

const profile: PlaybackTargetProfile = {
  id: 'lg', name: 'LG target', createdAt: '', updatedAt: '',
  definition: {
    containers: ['matroska'],
    video: { codecs: ['hevc'], profiles: ['Main 10'], levels: [52], maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, bitDepths: [10] },
    hdr: { formats: ['HDR10'], fallbackRequired: false },
    audio: { codecs: ['aac'], maxChannels: 2, objectAudio: false, outputPath: 'device' },
    subtitles: { formats: ['pgs'], embedded: true, external: false, burnIn: false },
    network: { sustainableBitrate: 100_000_000 },
  },
}

describe('evaluatePlaybackTarget', () => {
  it('compares HEVC FFprobe level 120 as level 4.0 against profile level 5.2', () => {
    const analysis: FileAnalysisResult = {
      success: true,
      filePath: 'episode.mkv',
      container: 'matroska',
      overallBitrateKbps: 7_435,
      video: { index: 0, codec: 'hevc', profile: 'Main 10', level: 120, width: 1440, height: 1080, bitDepth: 10 },
      audioTracks: [],
      subtitleTracks: [],
    }

    const result = evaluatePlaybackTarget(profile, analysis)

    expect(result.findings.video.status).toBe('compatible')
    expect(JSON.parse(result.findings.video.evidence)).toMatchObject({ level: 40, ffprobeLevel: 120 })
  })

  it('does not treat unselected embedded subtitles as direct-play incompatibility', () => {
    const analysis: FileAnalysisResult = {
      success: true,
      filePath: 'episode.mkv',
      container: 'matroska',
      overallBitrateKbps: 7_435,
      video: { index: 0, codec: 'hevc', profile: 'Main 10', level: 120, width: 1440, height: 1080, bitDepth: 10 },
      audioTracks: [],
      subtitleTracks: [{ index: 4, codec: 'hdmv_pgs_subtitle', isDefault: false, isForced: false }],
    }

    expect(evaluatePlaybackTarget(profile, analysis).findings.subtitle.status).toBe('not-applicable')
  })
  it('does not reject direct play because an optional alternate audio language uses an unsupported codec', () => {
    const analysis: FileAnalysisResult = {
      success: true,
      filePath: 'episode.mkv',
      container: 'matroska',
      overallBitrateKbps: 7_435,
      video: { index: 0, codec: 'hevc', profile: 'Main 10', level: 120, width: 1440, height: 1080, bitDepth: 10 },
      audioTracks: [
        { index: 1, codec: 'aac', channels: 2, language: 'jpn', isDefault: true, hasObjectAudio: false },
        { index: 2, codec: 'truehd', channels: 8, language: 'eng', isDefault: false, hasObjectAudio: true },
      ],
      subtitleTracks: [{ index: 3, codec: 'hdmv_pgs_subtitle', isDefault: false, isForced: false }],
    }
    const result = evaluatePlaybackTarget(profile, analysis)
    expect(result.findings.audio.status).toBe('compatible')
    expect(result.findings.subtitle.status).toBe('not-applicable')
    expect(result.overall).toBe('compatible')
  })

})
