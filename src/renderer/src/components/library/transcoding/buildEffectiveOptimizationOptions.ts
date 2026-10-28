import type { TranscodeOptions } from '@main/services/TranscodingService'

export function buildEffectiveOptimizationOptions(
  options: TranscodeOptions,
  context: {
    targetProfileId: string
    targetContainer?: TranscodeOptions['targetContainer']
    audioTranscodeEnabled: boolean
    subtitleLanguageWhitelist: string[]
  },
): TranscodeOptions {
  const targetProfileId = context.targetProfileId || null
  const streamSelection = options.streamSelection ?? { audio: 'all' as const }
  return {
    ...options,
    targetProfileId,
    targetContainer: targetProfileId ? context.targetContainer : undefined,
    targetHdrFormat: targetProfileId ? options.targetHdrFormat : undefined,
    targetAudioCodec: context.audioTranscodeEnabled ? options.targetAudioCodec : undefined,
    streamSelection: {
      ...streamSelection,
      subtitle: 'all',
      subtitleLanguageWhitelist: context.subtitleLanguageWhitelist.length > 0 ? context.subtitleLanguageWhitelist : undefined,
    },
  }
}
