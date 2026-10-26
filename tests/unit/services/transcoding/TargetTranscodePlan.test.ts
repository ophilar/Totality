import { describe, expect, it } from 'vitest'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { TranscodeOptions } from '@main/services/TranscodingService'
import { buildTargetTranscodePlan, validateTargetTranscodeBitrate } from '@main/services/transcoding/TargetTranscodePlan'

describe('buildTargetTranscodePlan audio compatibility', () => {
  it('rejects measured output peaks above the target ceiling', () => {
    const plan = { maximumVideoBitrate: 8_000_000 } as Parameters<typeof validateTargetTranscodeBitrate>[0]
    const output = { deepAnalysis: { peakBitrate: 8_001 } } as FileAnalysisResult
    expect(() => validateTargetTranscodeBitrate(plan, output)).toThrow('exceeds the playback limit')
    output.deepAnalysis!.peakBitrate = 8_000
    expect(() => validateTargetTranscodeBitrate(plan, output)).not.toThrow()
    delete output.deepAnalysis!.peakBitrate
    expect(() => validateTargetTranscodeBitrate(plan, output)).toThrow('Measured peak video bitrate is required')
  })
  it('preserves DTS-HD MA when the target profile supports the normalized codec', () => {
    const analysis: FileAnalysisResult = {
      success: true,
      filePath: 'movie.mkv',
      container: 'matroska',
      durationMs: 3_600_000,
      fileSizeBytes: 1_000_000_000,
      overallBitrateKbps: 2_000,
      video: { index: 0, codec: 'hevc', width: 1920, height: 1080, bitDepth: 8, hdrFormat: 'SDR' },
      audioTracks: [{ index: 1, codec: 'dca', profile: 'DTS-HD MA', channels: 6, bitrateKbps: 2_000, isDefault: true, hasObjectAudio: false }],
      subtitleTracks: [],
    }
    const profile: PlaybackTargetProfile = {
      id: 'receiver',
      name: 'Receiver',
      definition: {
        containers: ['matroska'],
        video: { codecs: ['H.265'], profiles: ['Main'], levels: [40], maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60, bitDepths: [8] },
        hdr: { formats: ['SDR'], fallbackRequired: false },
        audio: { codecs: ['DTS-HD MA'], maxChannels: 8, objectAudio: false, outputPath: 'receiver' },
        subtitles: { formats: ['srt'], embedded: true, external: true, burnIn: false },
        network: { sustainableBitrate: 100_000_000 },
      },
      createdAt: '',
      updatedAt: '',
    }
    const options: TranscodeOptions = {
      targetCodec: 'hevc',
      targetContainer: 'mkv',
      optimizationMode: 'transcode',
      streamSelection: { audio: 'all', subtitle: 'all' },
    }

    const plan = buildTargetTranscodePlan(analysis, profile, options)

    expect(plan.audio).toEqual([{ sourceIndex: 1, codec: 'dca' }])
  })
})
