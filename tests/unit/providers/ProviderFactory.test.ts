import { describe, it, expect } from 'vitest'
import {
  createProvider,
  isProviderSupported,
  getSupportedProviders,
  getProviderMetadata,
  getProviderDisplayName,
  getProviderIcon
} from '@main/providers/ProviderFactory'
import { ProviderType } from '@main/types/database'
import { SourceConfig } from '@main/providers/base/MediaProvider'

describe('ProviderFactory', () => {
  const dummyConfig: SourceConfig = {
    sourceId: 'src-1',
    displayName: 'Test Source',
    sourceType: ProviderType.Local,
    connectionConfig: { folderPath: 'C:\\Media' },
    isEnabled: true
  }

  it('should instantiate supported provider types', () => {
    const localProvider = createProvider(ProviderType.Local, dummyConfig)
    expect(localProvider).toBeDefined()
    expect(localProvider.providerType).toBe(ProviderType.Local)

    const plexProvider = createProvider(ProviderType.Plex, {
      ...dummyConfig,
      sourceType: ProviderType.Plex,
      connectionConfig: { serverUrl: 'http://localhost:32400', token: 'xyz' }
    })
    expect(plexProvider).toBeDefined()
    expect(plexProvider.providerType).toBe(ProviderType.Plex)
  })

  it('should throw loudly for unknown provider types', () => {
    expect(() => createProvider('unsupported_custom' as ProviderType, dummyConfig)).toThrow(
      'Unknown or unsupported provider type: "unsupported_custom"'
    )
  })

  it('should correctly report supported status', () => {
    expect(isProviderSupported(ProviderType.Plex)).toBe(true)
    expect(isProviderSupported(ProviderType.Local)).toBe(true)
    expect(isProviderSupported('unknown' as ProviderType)).toBe(false)
  })

  it('should return all supported provider types', () => {
    const supported = getSupportedProviders()
    expect(supported).toContain(ProviderType.Plex)
    expect(supported).toContain(ProviderType.Local)
    expect(supported).toContain(ProviderType.Jellyfin)
    expect(supported).toContain(ProviderType.Kodi)
  })

  it('should retrieve metadata, display name, and icon without fallback spoofing', () => {
    const meta = getProviderMetadata(ProviderType.Plex)
    expect(meta.name).toBe('Plex')
    expect(meta.icon).toBe('plex')

    expect(getProviderDisplayName(ProviderType.Local)).toBe('Local Folder')
    expect(getProviderIcon(ProviderType.Local)).toBe('folder')

    expect(() => getProviderMetadata('fake' as ProviderType)).toThrow('Unknown provider type: "fake"')
    expect(() => getProviderDisplayName('fake' as ProviderType)).toThrow('Unknown provider type: "fake"')
    expect(() => getProviderIcon('fake' as ProviderType)).toThrow('Unknown provider type: "fake"')
  })
})
