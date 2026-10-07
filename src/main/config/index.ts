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
  monitoring: defaults.monitoring,
  gemini: defaults.gemini,
  quality: defaults.quality,
  transcoding: defaults.transcoding,
  ai: aiPrompts
}

export default APP_CONFIG
