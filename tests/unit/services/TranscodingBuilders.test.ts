import { describe, it, expect } from 'vitest'
import { NvidiaCommandBuilder } from '../../../src/main/services/transcoding/NvidiaCommandBuilder'
import { IntelCommandBuilder } from '../../../src/main/services/transcoding/IntelCommandBuilder'
import { SoftwareCommandBuilder } from '../../../src/main/services/transcoding/SoftwareCommandBuilder'
import { TranscodeCommandFactory } from '../../../src/main/services/transcoding/TranscodeCommandFactory'
import { TranscodeOptions } from '../../../src/main/services/TranscodingService'
import { FileAnalysisResult } from '../../../src/main/services/MediaFileAnalyzer'

describe('NvidiaCommandBuilder', () => {
  it('builds zero-copy CUDA VRAM NVENC HEVC arguments with -fps_mode passthrough', () => {
    const builder = new NvidiaCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'hevc',
      crf: 20,
      preset: 'p6',
      useGpu: true,
      preserveAllAudio: true,
      preserveSubtitles: true
    }
    const analysis: Partial<FileAnalysisResult> = {
      filePath: 'input.mkv',
      video: {
        index: 0,
        codec: 'h264',
        width: 1920,
        height: 1080,
        pix_fmt: 'yuv420p10le'
      } as any,
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
    expect(args).toContain('-spatial-aq')
    expect(args).toContain('1')
    expect(args).toContain('-temporal-aq')
    expect(args).toContain('1')
    expect(args).toContain('-b_ref_mode')
    expect(args).toContain('middle')
    expect(args).toContain('-vf')
    expect(args).toContain('scale_cuda=format=p010le')
    expect(args[args.length - 1]).toBe('output.mkv')
  })

  it('builds NVENC AV1 arguments and HandBrake CLI arguments', () => {
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
        pix_fmt: 'yuv420p'
      } as any,
      audioTracks: [],
      subtitleTracks: []
    }
    const ffmpegArgs = builder.buildFFmpegArgs('input.mp4', 'output.mkv', options, analysis as FileAnalysisResult)
    expect(ffmpegArgs).toContain('av1_nvenc')
    expect(ffmpegArgs).toContain('-vf')
    expect(ffmpegArgs).toContain('scale_cuda=format=p010le')

    const hbArgs = builder.buildHandbrakeArgs('input.mp4', 'output.mkv', options, analysis as FileAnalysisResult)
    expect(hbArgs).toContain('--encoder')
    expect(hbArgs).toContain('nvenc_av1_10bit')
    expect(hbArgs).toContain('--quality')
    expect(hbArgs).toContain('18')
    expect(hbArgs).toContain('--encopts')
    expect(hbArgs).toContain('spatial-aq=1:temporal-aq=1:b-ref-mode=middle')
  })
})

describe('IntelCommandBuilder', () => {
  it('builds Intel QSV hardware acceleration arguments', () => {
    const builder = new IntelCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'hevc',
      crf: 23,
      preset: 'slow'
    }
    const analysis: Partial<FileAnalysisResult> = {
      filePath: 'input.mkv',
      video: { index: 0, codec: 'hevc', width: 1920, height: 1080 } as any,
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

    const hbArgs = builder.buildHandbrakeArgs('input.mkv', 'output.mkv', options, analysis as FileAnalysisResult)
    expect(hbArgs).toContain('--encoder')
    expect(hbArgs).toContain('qsv_h265_10bit')
  })
})

describe('SoftwareCommandBuilder', () => {
  it('builds software encoding arguments for SVT-AV1 and x265', () => {
    const builder = new SoftwareCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'av1',
      crf: 24,
      preset: 'medium'
    }
    const analysis: Partial<FileAnalysisResult> = {
      filePath: 'input.mkv',
      video: { index: 0, codec: 'h264', width: 1920, height: 1080 } as any,
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

    const hbArgs = builder.buildHandbrakeArgs('input.mkv', 'output.mkv', options, analysis as FileAnalysisResult)
    expect(hbArgs).toContain('--encoder')
    expect(hbArgs).toContain('svt_av1_10bit')
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
