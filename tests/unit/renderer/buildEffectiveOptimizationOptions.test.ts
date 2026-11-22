import { describe, expect, it } from 'vitest'
import type { TranscodeOptions } from '../../../src/renderer/src/components/library/transcoding/types'
import { buildEffectiveOptimizationOptions } from '../../../src/renderer/src/components/library/transcoding/buildEffectiveOptimizationOptions'

const options: TranscodeOptions = {
  useGpu: false,
  gpuId: '',
  encoder: '',
  preset: '',
  customArgs: '',
  transcodingEngine: 'ffmpeg',
  targetSize: '',
  targetContainer: 'mkv',
  targetHdrFormat: 'HDR10',
  targetAudioCodec: 'eac3',
  streamSelection: { audio: 'original-and-protected', originalLanguage: 'eng', subtitle: 'all', defaultSubtitle: 'preserve' },
}

describe('buildEffectiveOptimizationOptions', () => {
  it('removes target-only settings when no playback target is selected', () => {
    const result = buildEffectiveOptimizationOptions(options, {
      targetProfileId: '',
      audioTranscodeEnabled: false,
      subtitleLanguageWhitelist: [],
    })

    expect(result.targetProfileId).toBeNull()
    expect(result.targetContainer).toBeUndefined()
    expect(result.targetHdrFormat).toBeUndefined()
    expect(result.targetAudioCodec).toBeUndefined()
    expect(result.streamSelection).toEqual({
      audio: 'original-and-protected',
      originalLanguage: 'eng',
      subtitle: 'all',
      defaultSubtitle: 'preserve',
      subtitleLanguageWhitelist: undefined,
    })
  })

  it('preserves selected target settings and applies the requested language whitelist', () => {
    const result = buildEffectiveOptimizationOptions(options, {
      targetProfileId: 'living-room-tv',
      targetContainer: 'mkv',
      audioTranscodeEnabled: true,
      subtitleLanguageWhitelist: ['eng', 'heb'],
    })

    expect(result.targetProfileId).toBe('living-room-tv')
    expect(result.targetContainer).toBe('mkv')
    expect(result.targetHdrFormat).toBe('HDR10')
    expect(result.targetAudioCodec).toBe('eac3')
    expect(result.streamSelection?.subtitleLanguageWhitelist).toEqual(['eng', 'heb'])
  })
})
