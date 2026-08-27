import { describe, expect, it } from 'vitest'
import { buildStreamSelectionPlan } from '../../../../src/main/services/transcoding/StreamSelectionPlan'
import type { FileAnalysisResult } from '../../../../src/main/services/MediaFileAnalyzer'

const analysis = {
  success: true,
  filePath: 'episode.mkv',
  video: { index: 0, codec: 'hevc', width: 1920, height: 1080 },
  audioTracks: [
    { index: 1, codec: 'truehd', language: 'jpn', channels: 8, isDefault: true, hasObjectAudio: true },
    { index: 2, codec: 'ac3', language: 'eng', channels: 6, isDefault: false, hasObjectAudio: false },
    { index: 3, codec: 'ac3', language: 'spa', channels: 6, isDefault: false, hasObjectAudio: false }
  ],
  subtitleTracks: [
    { index: 4, codec: 'subrip', language: 'eng', isDefault: true, isForced: false },
    { index: 5, codec: 'subrip', language: 'heb', isDefault: false, isForced: false },
    { index: 6, codec: 'subrip', language: 'fre', isDefault: false, isForced: false },
    { index: 7, codec: 'subrip', language: 'jpn', isDefault: false, isForced: true }
  ]
} as FileAnalysisResult

describe('buildStreamSelectionPlan', () => {
  it('copies every detected audio and subtitle stream by default', () => {
    expect(buildStreamSelectionPlan(analysis, {})).toEqual({
      audioStreamIndexes: [1, 2, 3],
      subtitleStreamIndexes: [4, 5, 6, 7],
      defaultSubtitle: 'preserve'
    })
  })

  it('sets one selected subtitle as the output default', () => {
    expect(buildStreamSelectionPlan(analysis, {
      streamSelection: { audio: 'all', subtitle: 'all', defaultSubtitle: { language: 'heb' } }
    }).defaultSubtitle).toBe(5)
  })

  it('rejects a requested audio stream that does not exist in the analyzed inventory', () => {
    const noProtectedAnalysis: FileAnalysisResult = {
      ...analysis,
      audioTracks: [
        { index: 1, codec: 'ac3', language: 'jpn', channels: 6, isDefault: true, hasObjectAudio: false },
        { index: 2, codec: 'ac3', language: 'eng', channels: 6, isDefault: false, hasObjectAudio: false }
      ]
    }
    expect(() => buildStreamSelectionPlan(noProtectedAnalysis, {
      streamSelection: { audio: 'original-and-protected', originalLanguage: 'xx', subtitle: 'all' }
    })).toThrow('No audio stream matches original language xx')
  })

  it('rejects default subtitle if it points to a stream excluded by subtitleLanguageWhitelist', () => {
    expect(() => buildStreamSelectionPlan(analysis, {
      streamSelection: {
        audio: 'all',
        subtitle: 'all',
        subtitleLanguageWhitelist: ['eng'],
        defaultSubtitle: { language: 'heb' }
      }
    })).toThrow('Subtitle policy resolved to 0 tracks; exactly one is required')
  })

  it('filters subtitle tracks according to subtitleLanguageWhitelist independently of audio tracks', () => {
    const plan = buildStreamSelectionPlan(analysis, {
      streamSelection: {
        audio: 'original-and-protected',
        originalLanguage: 'jpn',
        subtitle: 'all',
        subtitleLanguageWhitelist: ['en', 'he']
      }
    })

    // Audio: Japanese audio (1) matches original, audio description / object audio if any
    expect(plan.audioStreamIndexes).toEqual([1])

    // Subtitles: eng (4) and heb (5) match whitelist; jpn (7) is forced so it is included; fre (6) is dropped
    expect(plan.subtitleStreamIndexes).toEqual([4, 5, 7])
  })

  it('normalizes 2-letter and 3-letter language codes in subtitle whitelist', () => {
    const plan = buildStreamSelectionPlan(analysis, {
      streamSelection: {
        audio: 'all',
        subtitle: 'all',
        subtitleLanguageWhitelist: ['FRA']
      }
    })

    // fre (6) matches FRA, jpn (7) is forced
    expect(plan.subtitleStreamIndexes).toEqual([6, 7])
  })

  it('includes forced subtitle tracks even when their language is not in the whitelist', () => {
    const plan = buildStreamSelectionPlan(analysis, {
      streamSelection: {
        audio: 'all',
        subtitle: 'all',
        subtitleLanguageWhitelist: ['heb']
      }
    })

    // heb (5) is whitelisted, jpn (7) is forced (even though Japanese is not in whitelist)
    expect(plan.subtitleStreamIndexes).toEqual([5, 7])
  })

  it('handles empty subtitle tracks matching whitelist when none match and none are forced', () => {
    const analysisNoForced: FileAnalysisResult = {
      ...analysis,
      subtitleTracks: [
        { index: 4, codec: 'subrip', language: 'spa', isDefault: false, isForced: false }
      ]
    }

    const plan = buildStreamSelectionPlan(analysisNoForced, {
      streamSelection: {
        audio: 'all',
        subtitle: 'all',
        subtitleLanguageWhitelist: ['eng']
      }
    })

    expect(plan.subtitleStreamIndexes).toEqual([])
  })
})
