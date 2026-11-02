export type SavedServiceId = 'omdb' | 'tvdb' | 'musicbrainz' | 'sonarr' | 'radarr'

export type SavedServiceStatus =
  | 'not-configured'
  | 'checking'
  | 'valid'
  | 'invalid-credential'
  | 'permission-denied'
  | 'rate-limited'
  | 'unavailable'
  | 'timed-out'

export interface SavedServiceHealth {
  service: SavedServiceId
  status: SavedServiceStatus
  message: string | null
  testedAt: string | null
  revision: number
}

export type SavedServiceHealthSnapshot = Record<SavedServiceId, SavedServiceHealth>

export interface ProviderHealthResult {
  status: Exclude<SavedServiceStatus, 'checking'>
  message: string | null
}
