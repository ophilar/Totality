/**
 * ProviderFactory
 *
 * Factory for creating MediaProvider instances based on provider type.
 */

import type { MediaProvider, ProviderType, SourceConfig } from './base/MediaProvider'
import { PlexProvider } from './plex/PlexProvider'
import { JellyfinProvider } from './jellyfin-emby/JellyfinProvider'
import { EmbyProvider } from './jellyfin-emby/EmbyProvider'
import { KodiProvider } from './kodi/KodiProvider'
import { KodiLocalProvider } from './kodi/KodiLocalProvider'
import { KodiMySQLProvider } from './kodi/KodiMySQLProvider'
import { LocalFolderProvider } from './local/LocalFolderProvider'
import { MediaMonkeyProvider } from './mediamonkey/MediaMonkeyProvider'

type ProviderCreator = (config: SourceConfig) => MediaProvider

const providerCreators: Record<ProviderType, ProviderCreator> = {
  plex: config => new PlexProvider(config),
  jellyfin: config => new JellyfinProvider(config),
  emby: config => new EmbyProvider(config),
  kodi: config => new KodiProvider(config),
  'kodi-local': config => new KodiLocalProvider(config),
  'kodi-mysql': config => new KodiMySQLProvider(config),
  local: config => new LocalFolderProvider(config),
  mediamonkey: config => new MediaMonkeyProvider(config),
}

/**
 * Create a MediaProvider instance based on the provider type
 */
export function createProvider(type: ProviderType, config: SourceConfig): MediaProvider {
  const create = providerCreators[type]
  if (!create) throw new Error(`Unknown provider type: ${type}`)
  return create(config)
}

/**
 * Get list of all supported provider types
 */
export function getSupportedProviders(): ProviderType[] {
  return Object.keys(providerCreators) as ProviderType[]
}

export function isProviderSupported(type: string): type is ProviderType {
  return Object.prototype.hasOwnProperty.call(providerCreators, type)
}

/**
 * Get display name for a provider type
 */
export function getProviderDisplayName(type: ProviderType): string {
  const names: Record<ProviderType, string> = {
    plex: 'Plex',
    jellyfin: 'Jellyfin',
    emby: 'Emby',
    kodi: 'Kodi',
    'kodi-local': 'Kodi (Local)',
    'kodi-mysql': 'Kodi (MySQL)',
    local: 'Local Folder',
    mediamonkey: 'MediaMonkey',
  }
  return names[type] || type
}

/**
 * Get icon name for a provider type (for UI)
 */
export function getProviderIcon(type: ProviderType): string {
  const icons: Record<ProviderType, string> = {
    plex: 'plex',
    jellyfin: 'jellyfin',
    emby: 'emby',
    kodi: 'kodi',
    'kodi-local': 'kodi',
    'kodi-mysql': 'kodi',
    local: 'folder',
    mediamonkey: 'music',
  }
  return icons[type] || 'server'
}

export { PlexProvider }
