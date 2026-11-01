import { describe, expect, it } from 'vitest'
import { TranscodeCommandFactory } from '../../../../src/main/services/transcoding/TranscodeCommandFactory'
import type { FileAnalysisResult } from '../../../../src/main/services/MediaFileAnalyzer'

describe('TranscodeCommandFactory output safety', () => {
  it('honors explicit direct replacement for a lossy transcode', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'hevc_nvenc')).toBe('replace')
  })

  it('permits direct replacement only for the verified stream-copy encoder', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'copy')).toBe('replace')
  })

  it('honors explicit replacement for a custom-argument remux', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'copy', true)).toBe('replace')
  })
})

describe('TranscodeCommandFactory builder resolution', () => {
  it.skipIf(!['win32', 'linux'].includes(process.platform))('uploads software-decoded FFV1 samples for QSV without altering production hardware decoding', () => {
    const device = process.platform === 'win32'
      ? { kind: 'directx' as const, index: 0 }
      : { kind: 'drm' as const, path: '/dev/dri/renderD128' }
    const analysis = {
      success: true, filePath: 'reference.mkv',
      video: { index: 0, codec: 'ffv1', width: 160, height: 96, bitDepth: 8, hdrFormat: 'SDR' },
      audioTracks: [], subtitleTracks: [],
    } as FileAnalysisResult
    const base = {
      useGpu: true, encoder: 'hevc_qsv', targetCodec: 'hevc' as const, gpuDeviceSelector: device,
      streamSelection: { audio: 'all', subtitle: 'all' },
    }
    const builder = TranscodeCommandFactory.getBuilder('Intel', base)
    const measured = builder.buildFFmpegArgs('reference.mkv', 'sample.mkv', { ...base, measurementReferenceInput: true }, analysis)
    const production = builder.buildFFmpegArgs('episode.mkv', 'episode-out.mkv', base, analysis)
    expect(measured).not.toContain('-hwaccel')
    expect(measured).toContain('format=nv12,hwupload=extra_hw_frames=64,vpp_qsv=format=nv12')
    expect(production).toContain('-hwaccel')
    expect(production).toContain('vpp_qsv=format=nv12')
  })

  it('returns NvidiaCommandBuilder for NVIDIA vendor', () => {
    const builder = TranscodeCommandFactory.getBuilder('NVIDIA', { useGpu: true })
    expect(builder.constructor.name).toBe('NvidiaCommandBuilder')
  })

  it('returns IntelCommandBuilder for Intel vendor', () => {
    const builder = TranscodeCommandFactory.getBuilder('Intel', { useGpu: true })
    expect(builder.constructor.name).toBe('IntelCommandBuilder')
  })

  it('returns SoftwareCommandBuilder when GPU is not requested', () => {
    const builder = TranscodeCommandFactory.getBuilder(undefined, { useGpu: false })
    expect(builder.constructor.name).toBe('SoftwareCommandBuilder')
  })

  it('returns StreamRemuxCommandBuilder for remux_only mode', () => {
    const builder = TranscodeCommandFactory.getBuilder('NVIDIA', { optimizationMode: 'remux_only' })
    expect(builder.constructor.name).toBe('StreamRemuxCommandBuilder')
  })

  it('returns AmdCommandBuilder for AMD vendor', () => {
    expect(TranscodeCommandFactory.getBuilder('AMD', { useGpu: true }).constructor.name).toBe('AmdCommandBuilder')
  })

  it('returns AppleCommandBuilder for Apple vendor', () => {
    expect(TranscodeCommandFactory.getBuilder('Apple', { useGpu: true }).constructor.name).toBe('AppleCommandBuilder')
  })

  it('throws when GPU is requested without a valid vendor', () => {
    expect(() => TranscodeCommandFactory.getBuilder(undefined, { useGpu: true })).toThrow(/GPU transcoding was requested, but no valid GPU vendor was provided/)
  })
})
