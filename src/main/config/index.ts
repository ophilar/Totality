import defaults from '@main/config/defaults.json'
import aiPrompts from '@main/config/ai_prompts.json'

/**
 * Application Configuration
 * 
 * Provides centralized access to all application defaults and fixed settings.
 * Most settings are loaded from defaults.json and ai_prompts.json.
 */

export const APP_CONFIG = {
  initialSettings: defaults.initialSettings as [string, string][],
  audioCodecs: defaults.audioCodecs,
  tmdb: defaults.tmdb,
  logging: defaults.logging,
  workers: defaults.workers,
  monitoring: {
    batchWindowMs: defaults.monitoring.batchWindowMs,
    maxIndividualNotifications: defaults.monitoring.maxIndividualNotifications,
    maxStoredNotifications: defaults.monitoring.maxStoredNotifications,
    pollingIntervals: {
      plex: 300000,
      jellyfin: 300000,
      emby: 300000,
      kodi: 300000,
      'kodi-local': 60000,
      'kodi-mysql': 60000,
      local: 60000,
      mediamonkey: 60000,
    }
  },
  gemini: defaults.gemini,
  quality: defaults.quality,
  ai: aiPrompts
}

export default APP_CONFIG
