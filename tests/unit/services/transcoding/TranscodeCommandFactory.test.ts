import { describe, expect, it } from 'vitest'
import { TranscodeCommandFactory } from '../../../../src/main/services/transcoding/TranscodeCommandFactory'

describe('TranscodeCommandFactory output safety', () => {
  it('routes a lossy transcode request for direct replacement through quarantine', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'hevc_nvenc')).toBe('quarantine-replace')
  })

  it('permits direct replacement only for the verified stream-copy encoder', () => {
    expect(TranscodeCommandFactory.resolveOutputMode('replace', 'copy')).toBe('replace')
  })
})
