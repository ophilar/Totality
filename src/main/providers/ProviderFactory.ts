import { MediaProvider, SourceConfig } from '@main/providers/base/MediaProvider'
import { ProviderType } from '@main/types/database'
import { PROVIDERS, ProviderMetadata, SUPPORTED_PROVIDERS } from '@main/constants/providers'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { KodiProvider } from '@main/providers/kodi/KodiProvider'
import { KodiLocalProvider } from '@main/providers/kodi/KodiLocalProvider'
import { KodiMySQLProvider } from '@main/providers/kodi/KodiMySQLProvider'
import { LocalFolderProvider } from '@main/providers/local/LocalFolderProvider'
import { MediaMonkeyProvider } from '@main/providers/mediamonkey/MediaMonkeyProvider'

type ProviderConstructor = (config: SourceConfig) => MediaProvider

const PROVIDER_CONSTRUCTORS: Record<ProviderType, ProviderConstructor> = {
  [ProviderType.Plex]: (config) => new PlexProvider(config),
  [ProviderType.Jellyfin]: (config) => {
    const { JellyfinProvider } = require('@main/providers/jellyfin-emby/JellyfinProvider')
    return new JellyfinProvider(config)
  },
  [ProviderType.Emby]: (config) => {
    const { EmbyProvider } = require('@main/providers/jellyfin-emby/EmbyProvider')
    return new EmbyProvider(config)
  },
  [ProviderType.Kodi]: (config) => new KodiProvider(config),
  [ProviderType.KodiLocal]: (config) => new KodiLocalProvider(config),
  [ProviderType.KodiMySQL]: (config) => new KodiMySQLProvider(config),
  [ProviderType.Local]: (config) => new LocalFolderProvider(config),
  [ProviderType.MediaMonkey]: (config) => new MediaMonkeyProvider(config),
}

/**
 * Create a MediaProvider instance based on the provider type
 */
export function createProvider(type: ProviderType, config: SourceConfig): MediaProvider {
  const ctor = PROVIDER_CONSTRUCTORS[type]
  if (!ctor) {
    throw new Error(`Unknown or unsupported provider type: "${type}"`)
  }
  return ctor(config)
}

/**
 * Check if a provider type is supported
 */
export function isProviderSupported(type: ProviderType): boolean {
  return type in PROVIDERS && type in PROVIDER_CONSTRUCTORS
}

/**
 * Get list of all supported provider types
 */
export function getSupportedProviders(): ProviderType[] {
  return SUPPORTED_PROVIDERS.map(p => p.type)
}

/**
 * Get metadata for a provider type
 */
export function getProviderMetadata(type: ProviderType): ProviderMetadata {
  const metadata = PROVIDERS[type]
  if (!metadata) {
    throw new Error(`Unknown provider type: "${type}"`)
  }
  return metadata
}

/**
 * Get display name for a provider type
 */
export function getProviderDisplayName(type: ProviderType): string {
  return getProviderMetadata(type).name
}

/**
 * Get icon name for a provider type (for UI)
 */
export function getProviderIcon(type: ProviderType): string {
  return getProviderMetadata(type).icon
}
