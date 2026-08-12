import { describe, expect, it } from 'vitest'
import { buildStreamSelectionPlan } from '../../../src/main/services/transcoding/StreamSelectionPlan'
import type { FileAnalysisResult } from '../../../src/main/services/MediaFileAnalyzer'

const analysis = {
  success: true,
  filePath: 'episode.mkv',
  video: { index: 0, codec: 'hevc', width: 1920, height: 1080 },
  audioTracks: [
    { index: 1, codec: 'truehd', channels: 8, isDefault: true, hasObjectAudio: true },
    { index: 2, codec: 'ac3', channels: 6, isDefault: false, hasObjectAudio: false }
  ],
  subtitleTracks: [
    { index: 3, codec: 'subrip', language: 'eng', isDefault: true, isForced: false },
    { index: 4, codec: 'subrip', language: 'heb', isDefault: false, isForced: false }
  ]
} as FileAnalysisResult

describe('buildStreamSelectionPlan', () => {
  it('copies every detected audio and subtitle stream by default', () => {
    expect(buildStreamSelectionPlan(analysis, {})).toEqual({
      audioStreamIndexes: [1, 2],
      subtitleStreamIndexes: [3, 4],
      defaultSubtitle: 'preserve'
    })
  })

  it('sets one selected subtitle as the output default', () => {
    expect(buildStreamSelectionPlan(analysis, {
      streamSelection: { audio: 'all', subtitle: 'all', defaultSubtitle: { language: 'heb' } }
    }).defaultSubtitle).toBe(4)
  })

  it('rejects a requested stream that does not exist in the analyzed inventory', () => {
    expect(() => buildStreamSelectionPlan(analysis, { streamSelection: { audio: 'original-and-protected', originalLanguage: 'xx', subtitle: 'all' } }))
      .toThrow('has no reliable language tag')
  })
})
