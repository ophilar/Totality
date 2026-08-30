import { describe, expect, it } from 'vitest'
import { TranscodeCommandFactory } from '../../../../src/main/services/transcoding/TranscodeCommandFactory'

describe('TranscodeCommandFactory output safety', () => {
  it('routes a lossy transcode request for direct replacement through quarantine', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'hevc_nvenc')).toBe('quarantine-replace')
  })

  it('permits direct replacement only for the verified stream-copy encoder', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'copy')).toBe('replace')
  })

  it('routes a custom-argument remux request through quarantine because its stream copy cannot be verified', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'copy', true)).toBe('quarantine-replace')
  })
})

describe('TranscodeCommandFactory builder resolution', () => {
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

  it('throws when GPU is requested with unsupported AMD vendor', () => {
    expect(() => TranscodeCommandFactory.getBuilder('AMD', { useGpu: true })).toThrow(/GPU transcoding is not supported for vendor: "AMD"/)
  })

  it('throws when GPU is requested with unsupported Apple vendor', () => {
    expect(() => TranscodeCommandFactory.getBuilder('Apple', { useGpu: true })).toThrow(/GPU transcoding is not supported for vendor: "Apple"/)
  })

  it('throws when GPU is requested without a valid vendor', () => {
    expect(() => TranscodeCommandFactory.getBuilder(undefined, { useGpu: true })).toThrow(/GPU transcoding was requested, but no valid GPU vendor was provided/)
  })
})
