import { ProviderType } from '../types/database'

export interface ProviderMetadata {
  type: ProviderType
  name: string
  icon: string
  color: string
  description: string
  isLocal: boolean
}

export const PROVIDERS: Record<ProviderType, ProviderMetadata> = {
  [ProviderType.Plex]: {
    type: ProviderType.Plex,
    name: 'Plex',
    icon: 'plex',
    color: 'bg-[#e5a00d]',
    description: 'Connect to your Plex Media Server',
    isLocal: false
  },
  [ProviderType.Jellyfin]: {
    type: ProviderType.Jellyfin,
    name: 'Jellyfin',
    icon: 'jellyfin',
    color: 'bg-purple-600',
    description: 'Connect to your Jellyfin server',
    isLocal: false
  },
  [ProviderType.Emby]: {
    type: ProviderType.Emby,
    name: 'Emby',
    icon: 'emby',
    color: 'bg-green-600',
    description: 'Connect to your Emby server',
    isLocal: false
  },
  [ProviderType.Kodi]: {
    type: ProviderType.Kodi,
    name: 'Kodi',
    icon: 'kodi',
    color: 'bg-blue-600',
    description: 'Connect to a Kodi instance (JSON-RPC)',
    isLocal: false
  },
  [ProviderType.KodiLocal]: {
    type: ProviderType.KodiLocal,
    name: 'Kodi (Local)',
    icon: 'kodi',
    color: 'bg-blue-500',
    description: 'Directly read local Kodi SQLite databases',
    isLocal: true
  },
  [ProviderType.KodiMySQL]: {
    type: ProviderType.KodiMySQL,
    name: 'Kodi (MySQL)',
    icon: 'kodi',
    color: 'bg-blue-700',
    description: 'Connect to a shared Kodi MySQL database',
    isLocal: false
  },
  [ProviderType.Local]: {
    type: ProviderType.Local,
    name: 'Local Folder',
    icon: 'folder',
    color: 'bg-gray-600',
    description: 'Scan folders directly on your computer',
    isLocal: true
  },
  [ProviderType.MediaMonkey]: {
    type: ProviderType.MediaMonkey,
    name: 'MediaMonkey 5',
    icon: 'music',
    color: 'bg-orange-600',
    description: 'Read the MediaMonkey 5 database',
    isLocal: true
  }
}

export const SUPPORTED_PROVIDERS = Object.values(PROVIDERS)
