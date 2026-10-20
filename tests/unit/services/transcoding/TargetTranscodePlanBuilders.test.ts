import { describe, expect, it } from 'vitest'
import type { FileAnalysisResult } from '../../../../src/main/services/MediaFileAnalyzer'
import { AmdCommandBuilder } from '../../../../src/main/services/transcoding/AmdCommandBuilder'
import { AppleCommandBuilder } from '../../../../src/main/services/transcoding/AppleCommandBuilder'
import { IntelCommandBuilder } from '../../../../src/main/services/transcoding/IntelCommandBuilder'
import { NvidiaCommandBuilder } from '../../../../src/main/services/transcoding/NvidiaCommandBuilder'
import { SoftwareCommandBuilder } from '../../../../src/main/services/transcoding/SoftwareCommandBuilder'
import type { TargetTranscodePlan } from '../../../../src/main/services/transcoding/TargetTranscodePlan'

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

const builders = [
  ['NVIDIA', new NvidiaCommandBuilder(), 'nvenc_h265'],
  ['Intel', new IntelCommandBuilder(), 'qsv_h265'],
  ['AMD', new AmdCommandBuilder(), 'hevc_amf'],
  ['Apple', new AppleCommandBuilder(), 'vt_h265'],
  ['software', new SoftwareCommandBuilder(), 'x265']
] as const

describe('target conversion command parity', () => {
  it.each(builders)('%s applies the measured target plan to its output command', (_vendor, builder, encoder) => {
    const args = builder.buildFFmpegArgs('movie.mkv', 'movie.mp4', {
      targetCodec: 'hevc',
      targetConversion,
      encoder,
      crf: 22,
      preset: 'quality',
      streamSelection: { audio: 'all', subtitle: 'all' }
    }, analysis)

    expect(args.filter(argument => argument === '-vf')).toHaveLength(1)
    expect(args).toContain(targetConversion.videoFilter)
    expect(args).toContain('-maxrate')
    expect(args).toContain(String(targetConversion.maximumVideoBitrate))
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
})
