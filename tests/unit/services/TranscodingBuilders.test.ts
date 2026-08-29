import { describe, it, expect } from 'vitest'
import { NvidiaCommandBuilder } from '../../../src/main/services/transcoding/NvidiaCommandBuilder'
import { IntelCommandBuilder } from '../../../src/main/services/transcoding/IntelCommandBuilder'
import { SoftwareCommandBuilder } from '../../../src/main/services/transcoding/SoftwareCommandBuilder'
import { TranscodeCommandFactory } from '../../../src/main/services/transcoding/TranscodeCommandFactory'
import { TranscodeOptions } from '../../../src/main/services/TranscodingService'
import { FileAnalysisResult } from '../../../src/main/services/MediaFileAnalyzer'

const minimalAnalysis = {
  success: true,
  filePath: 'input.mkv',
  video: { index: 0, codec: 'hevc', width: 1920, height: 1080 },
  audioTracks: [],
  subtitleTracks: []
} as FileAnalysisResult

describe('NvidiaCommandBuilder', () => {
  it('preserves HDR10 color metadata in FFmpeg output arguments', () => {
    const args = new NvidiaCommandBuilder().buildFFmpegArgs('input.mkv', 'output.mkv', { targetCodec: 'hevc' }, {
      video: { hdrFormat: 'HDR10', colorSpace: 'bt2020nc', colorPrimaries: 'bt2020', colorTransfer: 'smpte2084' },
      audioTracks: [], subtitleTracks: []
    } as FileAnalysisResult)
    expect(args).toEqual(expect.arrayContaining(['-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084']))
  })

  it('rejects Dolby Vision instead of silently dropping dynamic metadata', () => {
    expect(() => new NvidiaCommandBuilder().buildFFmpegArgs('input.mkv', 'output.mkv', { targetCodec: 'hevc' }, {
      video: { hdrFormat: 'Dolby Vision' }
    } as FileAnalysisResult)).toThrow(/Dolby Vision.*dynamic HDR metadata/i)
  })

  it('rejects HLG until explicit output preservation is supported', () => {
    expect(() => new SoftwareCommandBuilder().buildFFmpegArgs('in', 'out', { targetCodec: 'hevc' }, {
      success: true,
      video: { hdrFormat: 'HLG' }
    } as FileAnalysisResult)).toThrow(/HLG.*not supported/i)
  })

  it('places fps_mode after the input because it is an output option', () => {
    const args = new NvidiaCommandBuilder().buildFFmpegArgs(
      'input.mkv',
      'output.mkv',
      { targetCodec: 'hevc', useGpu: true },
      minimalAnalysis
    )

    expect(args.indexOf('-fps_mode')).toBeGreaterThan(args.indexOf('input.mkv'))
  })

  it('builds zero-copy CUDA VRAM NVENC HEVC arguments with -fps_mode passthrough', () => {
    const builder = new NvidiaCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'hevc',
      crf: 20,
      preset: 'p6',
      useGpu: true,
      streamSelection: { audio: 'all', subtitle: 'all', defaultSubtitle: 'preserve' }
    }
    const analysis: Partial<FileAnalysisResult> = {
      filePath: 'input.mkv',
      video: {
        index: 0,
        codec: 'h264',
        width: 1920,
        height: 1080,
        pixelFormat: 'yuv420p10le'
      } as FileAnalysisResult['video'],
      audioTracks: [],
      subtitleTracks: []
    }
    const args = builder.buildFFmpegArgs('input.mkv', 'output.mkv', options, analysis as FileAnalysisResult)

    expect(args).toContain('-hwaccel')
    expect(args).toContain('cuda')
    expect(args).toContain('-hwaccel_output_format')
    expect(args).toContain('cuda')
    expect(args).toContain('-fps_mode')
    expect(args).toContain('passthrough')
    expect(args).toContain('-c:v')
    expect(args).toContain('hevc_nvenc')
    expect(args).toContain('-rc')
    expect(args).toContain('vbr')
    expect(args).toContain('-cq')
    expect(args).toContain('20')
    expect(args).toContain('-temporal-aq')
    expect(args).toContain('1')
    expect(args).toContain('-b_ref_mode')
    expect(args).toContain('middle')
    expect(args).toContain('-vf')
    expect(args).toContain('scale_cuda=format=p010le')
    expect(args[args.length - 1]).toBe('output.mkv')
  })

  it('maps selected streams and assigns the requested subtitle default', () => {
    const args = new NvidiaCommandBuilder().buildFFmpegArgs('input.mkv', 'output.mkv', {
      targetCodec: 'hevc',
      streamSelection: { audio: 'all', subtitle: 'all', defaultSubtitle: { language: 'heb' } }
    }, {
      ...minimalAnalysis,
      audioTracks: [{ index: 1, codec: 'aac', channels: 2, isDefault: true, hasObjectAudio: false }],
      subtitleTracks: [
        { index: 3, codec: 'subrip', language: 'eng', isDefault: true, isForced: false },
        { index: 4, codec: 'subrip', language: 'heb', isDefault: false, isForced: false }
      ]
    })
    expect(args).toEqual(expect.arrayContaining(['-map', '0:0', '-map', '0:1', '-map', '0:3', '-map', '0:4']))
    expect(args).toEqual(expect.arrayContaining(['-disposition:s:0', '0', '-disposition:s:1', 'default']))
  })

  it('builds NVENC AV1 arguments', () => {
    const builder = new NvidiaCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'av1',
      crf: 18,
      preset: 'p7'
    }
    const analysis: Partial<FileAnalysisResult> = {
      filePath: 'input.mp4',
      video: {
        index: 0,
        codec: 'h264',
        width: 3840,
        height: 2160,
        pixelFormat: 'yuv420p'
      } as FileAnalysisResult['video'],
      audioTracks: [],
      subtitleTracks: []
    }
    const ffmpegArgs = builder.buildFFmpegArgs('input.mp4', 'output.mkv', options, analysis as FileAnalysisResult)
    expect(ffmpegArgs).toContain('av1_nvenc')
    expect(ffmpegArgs).toContain('-vf')
    expect(ffmpegArgs).toContain('scale_cuda=format=p010le')

  })
})

describe('IntelCommandBuilder', () => {
  it('places fps_mode after the input because it is an output option', () => {
    const args = new IntelCommandBuilder().buildFFmpegArgs(
      'input.mkv',
      'output.mkv',
      { targetCodec: 'hevc', useGpu: true },
      minimalAnalysis
    )

    expect(args.indexOf('-fps_mode')).toBeGreaterThan(args.indexOf('input.mkv'))
  })

  it('builds Intel QSV hardware acceleration arguments', () => {
    const builder = new IntelCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'hevc',
      crf: 23,
      preset: 'slow'
    }
    const analysis: Partial<FileAnalysisResult> = {
      filePath: 'input.mkv',
      video: { index: 0, codec: 'hevc', width: 1920, height: 1080 } as FileAnalysisResult['video'],
      audioTracks: [],
      subtitleTracks: []
    }
    const ffmpegArgs = builder.buildFFmpegArgs('input.mkv', 'output.mkv', options, analysis as FileAnalysisResult)
    expect(ffmpegArgs).toContain('-hwaccel')
    expect(ffmpegArgs).toContain('qsv')
    expect(ffmpegArgs).toContain('-hwaccel_output_format')
    expect(ffmpegArgs).toContain('qsv')
    expect(ffmpegArgs).toContain('-c:v')
    expect(ffmpegArgs).toContain('hevc_qsv')
    expect(ffmpegArgs).toContain('-global_quality')
    expect(ffmpegArgs).toContain('23')
    expect(ffmpegArgs).toContain('-vf')
    expect(ffmpegArgs).toContain('vpp_qsv=format=p010le')

  })
})

describe('SoftwareCommandBuilder', () => {
  it('places fps_mode after the input because it is an output option', () => {
    const args = new SoftwareCommandBuilder().buildFFmpegArgs(
      'input.mkv',
      'output.mkv',
      { targetCodec: 'hevc' },
      minimalAnalysis
    )

    expect(args.indexOf('-fps_mode')).toBeGreaterThan(args.indexOf('input.mkv'))
  })

  it('builds software encoding arguments for SVT-AV1 and x265', () => {
    const builder = new SoftwareCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'av1',
      crf: 24,
      preset: 'medium'
    }
    const analysis: Partial<FileAnalysisResult> = {
      filePath: 'input.mkv',
      video: { index: 0, codec: 'h264', width: 1920, height: 1080 } as FileAnalysisResult['video'],
      audioTracks: [],
      subtitleTracks: []
    }
    const ffmpegArgs = builder.buildFFmpegArgs('input.mkv', 'output.mkv', options, analysis as FileAnalysisResult)
    expect(ffmpegArgs).toContain('-c:v')
    expect(ffmpegArgs).toContain('libsvtav1')
    expect(ffmpegArgs).toContain('-crf')
    expect(ffmpegArgs).toContain('24')
    expect(ffmpegArgs).toContain('-pix_fmt')
    expect(ffmpegArgs).toContain('yuv420p10le')

  })
})

describe('TranscodeCommandFactory', () => {
  it('returns NvidiaCommandBuilder for NVIDIA vendor with GPU enabled', () => {
    const builder = TranscodeCommandFactory.getBuilder('NVIDIA', { useGpu: true })
    expect(builder).toBeInstanceOf(NvidiaCommandBuilder)
  })

  it('returns IntelCommandBuilder for Intel vendor with GPU enabled', () => {
    const builder = TranscodeCommandFactory.getBuilder('Intel', { useGpu: true })
    expect(builder).toBeInstanceOf(IntelCommandBuilder)
  })

  it('returns SoftwareCommandBuilder when useGpu is false or vendor is unsupported', () => {
    expect(TranscodeCommandFactory.getBuilder('NVIDIA', { useGpu: false })).toBeInstanceOf(SoftwareCommandBuilder)
    expect(TranscodeCommandFactory.getBuilder('AMD', { useGpu: true })).toBeInstanceOf(SoftwareCommandBuilder)
    expect(TranscodeCommandFactory.getBuilder(undefined, {})).toBeInstanceOf(SoftwareCommandBuilder)
  })
})
