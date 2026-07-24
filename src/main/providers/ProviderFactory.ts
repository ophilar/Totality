/**
 * ProviderFactory
 *
 * Factory for creating MediaProvider instances based on provider type.
 */

import { MediaProvider, SourceConfig } from '@main/providers/base/MediaProvider'
import { ProviderType } from '@main/types/database'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { KodiProvider } from '@main/providers/kodi/KodiProvider'
import { KodiLocalProvider } from '@main/providers/kodi/KodiLocalProvider'
import { KodiMySQLProvider } from '@main/providers/kodi/KodiMySQLProvider'
import { LocalFolderProvider } from '@main/providers/local/LocalFolderProvider'
import { MediaMonkeyProvider } from '@main/providers/mediamonkey/MediaMonkeyProvider'

/**
 * Create a MediaProvider instance based on the provider type
 */
export function createProvider(type: ProviderType, config: SourceConfig): MediaProvider {
  switch (type) {
    case ProviderType.Plex:
      return new PlexProvider(config)

    case ProviderType.Jellyfin: {
      const { JellyfinProvider } = require('@main/providers/jellyfin-emby/JellyfinProvider')
      return new JellyfinProvider(config)
    }

    case ProviderType.Emby: {
      const { EmbyProvider } = require('@main/providers/jellyfin-emby/EmbyProvider')
      return new EmbyProvider(config)
    }

    case ProviderType.Kodi:
      return new KodiProvider(config)

    case ProviderType.KodiLocal:
      return new KodiLocalProvider(config)

    case ProviderType.KodiMySQL:
      return new KodiMySQLProvider(config)

    case ProviderType.Local:
      return new LocalFolderProvider(config)

    case ProviderType.MediaMonkey:
      return new MediaMonkeyProvider(config)

    default:
      throw new Error(`Unknown provider type: ${type}`)
  }
}

import { PROVIDERS, SUPPORTED_PROVIDERS } from '@main/constants/providers'

/**
 * Check if a provider type is supported
 */
export function isProviderSupported(type: ProviderType): boolean {
  return !!PROVIDERS[type]
}

/**
 * Get list of all supported provider types
 */
export function getSupportedProviders(): ProviderType[] {
  return SUPPORTED_PROVIDERS.map(p => p.type)
}

/**
 * Get display name for a provider type
 */
export function getProviderDisplayName(type: ProviderType): string {
  return PROVIDERS[type]?.name || (type as string)
}

/**
 * Get icon name for a provider type (for UI)
 */
export function getProviderIcon(type: ProviderType): string {
  return PROVIDERS[type]?.icon || 'server'
}
