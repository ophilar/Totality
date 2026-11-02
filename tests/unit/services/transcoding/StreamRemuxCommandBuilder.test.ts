import { describe, it, expect } from 'vitest'
import { StreamRemuxCommandBuilder } from '../../../../src/main/services/transcoding/StreamRemuxCommandBuilder'
import { TranscodeCommandFactory } from '../../../../src/main/services/transcoding/TranscodeCommandFactory'
import type { FileAnalysisResult } from '../../../../src/main/services/MediaFileAnalyzer'
import type { TranscodeOptions } from '../../../../src/main/services/TranscodingService'

const mockAnalysis: FileAnalysisResult = {
  success: true,
  filePath: '/media/movie.mkv',
  fileSize: 10_000_000_000,
  duration: 7200,
  containerFormat: 'matroska',
  video: {
    index: 0,
    codec: 'hevc',
    width: 3840,
    height: 2160,
    bitDepth: 10,
    pixelFormat: 'yuv420p10le'
  },
  audioTracks: [
    { index: 1, codec: 'truehd', language: 'eng', channels: 8, isDefault: true, hasObjectAudio: true },
    { index: 2, codec: 'ac3', language: 'spa', channels: 6, isDefault: false, hasObjectAudio: false },
    { index: 3, codec: 'ac3', language: 'fra', channels: 6, isDefault: false, hasObjectAudio: false }
  ],
  subtitleTracks: [
    { index: 4, codec: 'subrip', language: 'eng', isDefault: true, isForced: false },
    { index: 5, codec: 'subrip', language: 'spa', isDefault: false, isForced: false },
    { index: 6, codec: 'subrip', language: 'ger', isDefault: false, isForced: true }
  ]
}

describe('StreamRemuxCommandBuilder', () => {
  it('builds FFmpeg args with -c:v copy and stream mapping without re-encoding video', () => {
    const builder = new StreamRemuxCommandBuilder()
    const options: TranscodeOptions = {
      optimizationMode: 'remux_only',
      streamSelection: {
        audio: 'original-and-protected',
        originalLanguage: 'en',
        subtitle: 'all',
        subtitleLanguageWhitelist: ['en']
      }
    }

    const args = builder.buildFFmpegArgs('/media/movie.mkv', '/media/movie_remux.mkv', options, mockAnalysis)

    expect(args[0]).toBe('-y')
    expect(args[1]).toBe('-i')
    expect(args[2]).toBe('/media/movie.mkv')
    expect(args[3]).toBe('-c:v')
    expect(args[4]).toBe('copy')

    // Maps video stream
    expect(args).toContain('-map')
    expect(args).toContain('0:0')

    // Maps English/protected audio (index 1), drops Spanish (2) and French (3)
    expect(args).toContain('0:1')
    expect(args).not.toContain('0:2')
    expect(args).not.toContain('0:3')
    expect(args).toContain('-c:a')
    expect(args).toContain('copy')

    // Maps whitelisted English sub (4) and forced German sub (6), drops Spanish sub (5)
    expect(args).toContain('0:4')
    expect(args).not.toContain('0:5')
    expect(args).toContain('0:6')
    expect(args).toContain('-c:s')

    // Output target at the end
    expect(args[args.length - 1]).toBe('/media/movie_remux.mkv')
  })

  it('preserves all streams when no selective stream policy is passed', () => {
    const builder = new StreamRemuxCommandBuilder()
    const options: TranscodeOptions = {
      optimizationMode: 'remux_only'
    }

    const args = builder.buildFFmpegArgs('in.mkv', 'out.mkv', options, mockAnalysis)

    expect(args.slice(0, 5)).toEqual(['-y', '-i', 'in.mkv', '-c:v', 'copy'])
    expect(args).toContain('0:0')
    expect(args).toContain('0:1')
    expect(args).toContain('0:2')
    expect(args).toContain('0:3')
    expect(args).toContain('0:4')
    expect(args).toContain('0:5')
    expect(args).toContain('0:6')
    expect(args[args.length - 1]).toBe('out.mkv')
  })
})

describe('TranscodeCommandFactory with remux options', () => {
  it('returns StreamRemuxCommandBuilder when optimizationMode is remux_only', () => {
    const builder = TranscodeCommandFactory.getBuilder('NVIDIA', {
      useGpu: true,
      optimizationMode: 'remux_only'
    })
    expect(builder).toBeInstanceOf(StreamRemuxCommandBuilder)
  })

  it('returns StreamRemuxCommandBuilder when encoder is remux or copy', () => {
    const builderRemux = TranscodeCommandFactory.getBuilder('NVIDIA', {
      useGpu: true,
      encoder: 'remux'
    })
    expect(builderRemux).toBeInstanceOf(StreamRemuxCommandBuilder)

    const builderCopy = TranscodeCommandFactory.getBuilder('Intel', {
      useGpu: true,
      encoder: 'copy'
    })
    expect(builderCopy).toBeInstanceOf(StreamRemuxCommandBuilder)
  })
})
