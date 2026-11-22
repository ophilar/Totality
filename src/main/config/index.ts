import defaults from '@main/config/defaults.json'

/**
 * Application Configuration
 *
 * Provides centralized access to all application defaults and fixed settings.
 * Most settings are loaded from defaults.json.
 */

export const APP_CONFIG = {
  audioCodecs: defaults.audioCodecs,
  tmdb: defaults.tmdb,
  musicBrainz: defaults.musicBrainz,
  logging: defaults.logging,
  workers: defaults.workers,
  monitoring: defaults.monitoring,
  quality: defaults.quality,
  transcoding: defaults.transcoding
}

export default APP_CONFIG
