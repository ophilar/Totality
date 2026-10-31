import { describe, expect, it, vi } from 'vitest'
import type { MediaItem } from '@main/types/database'
import { OptimizationCandidateService } from '@main/services/OptimizationCandidateService'

vi.mock('@main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: () => ({
    getRemovableAudioTrackIndexes: () => [],
    getOptimizationSavingsBreakdown: (_item: unknown, _analysis: unknown, codec: string | undefined) => ({
      videoSavingsBytes: codec ? 1000 : null,
      audioPruningBytes: null,
      subtitlePruningBytes: null,
    }),
  }),
}))

const item = (codec: string): MediaItem => ({
  video_codec: codec,
  container: 'mkv',
  subtitle_tracks: '[]',
  file_size_bytes: 10_000,
} as MediaItem)

const policy = (targetCodec: 'hevc' | 'av1') => ({
  targetCodec,
  av1HardwareEncodingAvailable: true,
  audioPruningEnabled: false,
  subtitleLanguageWhitelist: [],
})

describe('OptimizationCandidateService respects target codec', () => {
  const discover = (codec: string, target: 'hevc' | 'av1') =>
    new OptimizationCandidateService().discover(item(codec), policy(target))

  it('never suggests HEVC-to-AV1 when HEVC is selected, even with AV1 hardware', () => {
    expect(discover('HEVC', 'hevc').reasons).toEqual([])
    expect(discover('HEVC', 'hevc').targetCodec).toBeUndefined()
  })

  it('suggests only the selected codec when converting H.264', () => {
    expect(discover('H.264', 'hevc')).toMatchObject({
      reasons: ['h264_video_transcode'],
      targetCodec: 'hevc',
    })
    expect(discover('h264', 'av1')).toMatchObject({
      reasons: ['h264_video_transcode'],
      targetCodec: 'av1',
    })
  })

  it('only offers HEVC-to-AV1 when AV1 is explicitly selected and executable', () => {
    expect(discover('HEVC', 'av1')).toMatchObject({
      reasons: ['hevc_to_av1'],
      targetCodec: 'av1',
    })
    expect(new OptimizationCandidateService().discover(item('HEVC'), {
      ...policy('av1'),
      av1HardwareEncodingAvailable: false,
    }).reasons).toEqual([])
  })

  it('never offers an AV1-to-HEVC downgrade', () => {
    expect(discover('AV1', 'hevc').reasons).toEqual([])
  })
})
