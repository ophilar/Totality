import { CompositeMetadataProvider } from './CompositeMetadataProvider'
import { TMDBMetadataProvider } from './providers/TMDBMetadataProvider'
import { AniListMetadataProvider } from './providers/AniListMetadataProvider'
import { OMDbMetadataProvider } from './providers/OMDbMetadataProvider'
import { TVMazeMetadataProvider } from './providers/TVMazeMetadataProvider'
import { TVDBMetadataProvider } from './providers/TVDBMetadataProvider'
import { MusicBrainzMetadataProvider } from './providers/MusicBrainzMetadataProvider'
import { MetadataMatchingService } from './MetadataMatchingService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import type { ProviderHealthResult } from '@shared/serviceHealth'
import type { IMetadataProvider } from './IMetadataProvider'

/**
 * MetadataRegistryService - Singleton orchestrator for metadata provider strategies.
 */
export class MetadataRegistryService {
  private static instance: MetadataRegistryService
  private compositeProvider: CompositeMetadataProvider
  private savedCredentialProviders = new Map<string, IMetadataProvider & { testSavedCredential: (signal: AbortSignal) => Promise<ProviderHealthResult> }>()

  private constructor() {
    this.compositeProvider = new CompositeMetadataProvider([], async () => {
      try {
        const raw = await getDatabase().config.getSetting('metadata_provider_preferences')
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return {
          enabled: Array.isArray(parsed.enabled) ? parsed.enabled.filter((id: unknown): id is string => typeof id === 'string') : undefined,
          order: Array.isArray(parsed.order) ? parsed.order.filter((id: unknown): id is string => typeof id === 'string') : undefined
        }
      } catch { return null }
    })
    this.initializeProviders()
  }

  public static getInstance(): MetadataRegistryService {
    if (!MetadataRegistryService.instance) {
      MetadataRegistryService.instance = new MetadataRegistryService()
    }
    return MetadataRegistryService.instance
  }

  private initializeProviders(): void {
    // TMDB Provider (with lazy key access)
    const tmdbProvider = new TMDBMetadataProvider(() => getDatabase().config.getSetting('tmdb_api_key'))

    // AniList Provider (Anime Metadata)
    const aniListProvider = new AniListMetadataProvider()

    // OMDb Provider (IMDb Metadata & Ratings)
    const omdbProvider = new OMDbMetadataProvider(() => getDatabase().config.getSetting('omdb_api_key'))

    const tvdbProvider = new TVDBMetadataProvider(async () => ({
      apiKey: await getDatabase().config.getSetting('tvdb_api_key'),
      pin: await getDatabase().config.getSetting('tvdb_pin'),
    }))

    this.savedCredentialProviders.set('omdb', omdbProvider)
    this.savedCredentialProviders.set('tvdb', tvdbProvider)

    this.compositeProvider.registerProvider(tmdbProvider)
    this.compositeProvider.registerProvider(aniListProvider)
    this.compositeProvider.registerProvider(omdbProvider)
    this.compositeProvider.registerProvider(new TVMazeMetadataProvider())
    this.compositeProvider.registerProvider(tvdbProvider)
    this.compositeProvider.registerProvider(new MusicBrainzMetadataProvider())
  }

  public getCompositeProvider(): CompositeMetadataProvider {
    return this.compositeProvider
  }

  public getMatchingService(): MetadataMatchingService {
    return new MetadataMatchingService(this.compositeProvider)
  }

  public testSavedCredential(providerId: 'omdb' | 'tvdb', signal: AbortSignal): Promise<ProviderHealthResult> {
    return this.savedCredentialProviders.get(providerId)!.testSavedCredential(signal)
  }
}
