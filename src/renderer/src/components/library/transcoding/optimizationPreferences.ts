import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import { SETTING_KEYS } from '@shared/settingKeys'
import { unavailablePlaybackTargetMessage } from './optimizationConfiguration'

const OUTPUT_MODES = ['copy', 'quarantine-replace', 'replace'] as const

export type NormalizedOptimizationPreferences = {
  targetProfileId: string
  targetProfileError: string | null
  subtitleWhitelist: string
  outputMode: typeof OUTPUT_MODES[number] | ''
  outputModeError: string | null
}

export type OptimizationPreferences = NormalizedOptimizationPreferences & { targetProfiles: PlaybackTargetProfile[] }

export function normalizeOptimizationPreferences({
  targetProfileIds,
  targetProfileId,
  subtitleWhitelist,
  outputMode,
}: {
  targetProfileIds: readonly string[]
  targetProfileId?: string | null
  subtitleWhitelist?: string | null
  outputMode?: string | null
}): NormalizedOptimizationPreferences {
  const selectedOutputMode = OUTPUT_MODES.find(mode => mode === outputMode) ?? ''
  return {
    targetProfileId: targetProfileId ?? '',
    targetProfileError: unavailablePlaybackTargetMessage(targetProfileId, targetProfileIds),
    subtitleWhitelist: subtitleWhitelist ?? '',
    outputMode: selectedOutputMode,
    outputModeError: outputMode && !selectedOutputMode ? 'Saved output choice is unavailable. Choose another option.' : null,
  }
}

export async function loadOptimizationPreferences(): Promise<OptimizationPreferences> {
  const [targetProfiles, targetProfileId, subtitleWhitelist, outputMode] = await Promise.all([
    window.electronAPI.listPlaybackTargetProfiles(),
    window.electronAPI.getSetting('optimization_default_target_profile_id'),
    window.electronAPI.getSetting(SETTING_KEYS.subtitle_preferred_languages),
    window.electronAPI.getSetting(SETTING_KEYS.transcoding_default_output_mode),
  ])
  return { ...normalizeOptimizationPreferences({ targetProfileIds: targetProfiles.map(profile => profile.id), targetProfileId, subtitleWhitelist, outputMode }), targetProfiles }
}
