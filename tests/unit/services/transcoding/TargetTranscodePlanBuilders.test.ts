import { describe, expect, it } from 'vitest'
import type { FileAnalysisResult } from '../../../../src/main/services/MediaFileAnalyzer'
import { AmdCommandBuilder } from '../../../../src/main/services/transcoding/AmdCommandBuilder'
import { AppleCommandBuilder } from '../../../../src/main/services/transcoding/AppleCommandBuilder'
import { IntelCommandBuilder } from '../../../../src/main/services/transcoding/IntelCommandBuilder'
import { NvidiaCommandBuilder } from '../../../../src/main/services/transcoding/NvidiaCommandBuilder'
import { SoftwareCommandBuilder } from '../../../../src/main/services/transcoding/SoftwareCommandBuilder'
import type { TargetTranscodePlan } from '../../../../src/main/services/transcoding/TargetTranscodePlan'
import type { TranscodeOptions, ITranscodeCommandBuilder } from '../../../../src/main/services/transcoding/types'
import { buildTargetTranscodePlan } from '../../../../src/main/services/transcoding/TargetTranscodePlan'
import type { PlaybackTargetProfile } from '../../../../src/main/types/playbackTarget'

const analysis: FileAnalysisResult = {
  success: true,
  filePath: 'movie.mkv',
  fileSize: 1_000_000_000,
  duration: 3_600_000,
  containerFormat: 'matroska',
  video: { index: 0, codec: 'hevc', width: 3840, height: 2160, bitDepth: 10, pixelFormat: 'yuv420p10le' },
  audioTracks: [{ index: 1, codec: 'truehd', language: 'eng', channels: 8, isDefault: true, hasObjectAudio: false }],
  subtitleTracks: []
}

const targetConversion: TargetTranscodePlan = {
  container: 'mp4',
  width: 1920,
  height: 1080,
  bitDepth: 10,
  profile: 'Main 10',
  level: 41,
  hdrFormat: 'SDR',
  videoFilter: 'scale=1920:1080,format=yuv420p10le',
  inputArgs: [],
  maximumVideoBitrate: 8_000_000,
  audio: [{ sourceIndex: 1, codec: 'aac', bitrateKbps: 640 }],
  changes: []
}

const builders: Array<[string, ITranscodeCommandBuilder, string, TranscodeOptions['gpuDeviceSelector']?]> = [
  ...(process.platform === 'win32' || process.platform === 'linux' ? [[
    'NVIDIA', new NvidiaCommandBuilder(), 'nvenc_h265', process.platform === 'win32' ? { kind: 'directx' as const, index: 0 } : { kind: 'nvenc' as const, index: 0 }
  ] as [string, ITranscodeCommandBuilder, string, NonNullable<TranscodeOptions['gpuDeviceSelector']>]] : []),
  ...(process.platform === 'win32' || process.platform === 'linux' ? [[
    'Intel', new IntelCommandBuilder(), 'qsv_h265', process.platform === 'win32' ? { kind: 'directx' as const, index: 0 } : { kind: 'drm' as const, path: '/dev/dri/renderD128' }
  ] as [string, ITranscodeCommandBuilder, string, NonNullable<TranscodeOptions['gpuDeviceSelector']>]] : []),
  ...(process.platform === 'win32' ? [['AMD', new AmdCommandBuilder(), 'hevc_amf', { kind: 'directx', index: 0 }] as [string, ITranscodeCommandBuilder, string, NonNullable<TranscodeOptions['gpuDeviceSelector']>]] : []),
  ['software', new SoftwareCommandBuilder(), 'x265']
]

describe('target conversion command parity', () => {
  it.each(builders)('%s applies the measured target plan to its output command', (_vendor, builder, encoder, gpuDeviceSelector) => {
    const args = builder.buildFFmpegArgs('movie.mkv', 'movie.mp4', {
      targetCodec: 'hevc',
      targetConversion,
      encoder,
      gpuDeviceSelector,
      crf: 22,
      preset: 'quality',
      streamSelection: { audio: 'all', subtitle: 'all' }
    }, analysis)

    expect(args.filter(argument => argument === '-vf')).toHaveLength(1)
    expect(args).toContain(targetConversion.videoFilter)
    if (encoder.startsWith('qsv')) {
      expect(args).not.toContain('-maxrate')
      expect(args).not.toContain('-bufsize')
      expect(args).not.toContain('-rc_mode')
      expect(args).not.toContain('-hwaccel_device')
      expect(args).toContain('-global_quality')
      expect(args).toContain('-init_hw_device')
    } else {
      expect(args).toContain('-maxrate')
      expect(args).toContain(String(targetConversion.maximumVideoBitrate))
    }
    expect(args).toContain('-profile:v')
    expect(args).toContain('main10')
    expect(args).toContain('-c:a:0')
    expect(args).toContain('aac')
    expect(args).toContain('640k')
    expect(args).toContain('-movflags')
    expect(args.at(-1)).toBe('movie.mp4')
  })

  it('rejects AV1 hardware encoding on Apple VideoToolbox', () => {
    expect(() => new AppleCommandBuilder().buildFFmpegArgs('movie.mkv', 'movie.mp4', {
      targetCodec: 'av1', crf: 22, preset: 'quality'
    }, analysis)).toThrow(/supports HEVC/)
  })

  it('rejects per-GPU Apple VideoToolbox encoding until the selected GPU can be pinned', () => {
    expect(() => new AppleCommandBuilder().buildFFmpegArgs('movie.mkv', 'movie.mp4', {
      targetCodec: 'hevc', crf: 22, preset: 'quality'
    }, analysis)).toThrow(/selected GPU registry ID/)
  })

  it('identifies the subtitle stream codec and supported corrections when the target cannot preserve it', () => {
    const source = {
      ...analysis,
      durationMs: 3_600_000,
      fileSizeBytes: 1_000_000_000,
      video: { ...analysis.video!, frameRate: 24 },
      subtitleTracks: [{ index: 2, codec: 'ass', language: 'eng', title: 'English', isForced: false }],
    }
    const profile: PlaybackTargetProfile = {
      id: 'target', name: 'Test playback target', createdAt: '', updatedAt: '',
      definition: {
        containers: ['mp4'],
        video: { codecs: ['hevc'], profiles: ['Main 10'], levels: [41], maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, bitDepths: [10] },
        hdr: { formats: ['SDR'], fallbackRequired: false },
        audio: { codecs: ['truehd'], maxChannels: 8, objectAudio: true, outputPath: 'passthrough' },
        subtitles: { formats: ['mov_text'], embedded: true, external: false, burnIn: false },
        network: { sustainableBitrate: 100_000_000 },
      },
    }

    expect(() => buildTargetTranscodePlan(source, profile, {
      targetCodec: 'hevc', targetContainer: 'mp4', maxOutputBytes: 1_000_000_000,
      streamSelection: { audio: 'all', subtitle: 'all' },
    })).toThrow(/Subtitle stream 2 \(ass\).*Test playback target.*mp4.*remove it with the subtitle policy or choose a target profile\/container that supports ass/)
  })
})
