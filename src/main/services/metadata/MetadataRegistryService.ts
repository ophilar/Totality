import { CompositeMetadataProvider } from './CompositeMetadataProvider'
import { TMDBMetadataProvider } from './providers/TMDBMetadataProvider'
import { AniListMetadataProvider } from './providers/AniListMetadataProvider'

/**
 * MetadataRegistryService - Singleton orchestrator for metadata provider strategies.
 */
export class MetadataRegistryService {
  private static instance: MetadataRegistryService
  private compositeProvider: CompositeMetadataProvider

  private constructor() {
    this.compositeProvider = new CompositeMetadataProvider()
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
    const tmdbProvider = new TMDBMetadataProvider(() => {
      try {
        const ConfigService = require('../ConfigService').ConfigService
        return ConfigService.getInstance().get('tmdb_api_key') || ''
      } catch {
        return ''
      }
    })

    // AniList Provider (Anime Metadata)
    const aniListProvider = new AniListMetadataProvider()

    this.compositeProvider.registerProvider(tmdbProvider)
    this.compositeProvider.registerProvider(aniListProvider)
  }

  public getCompositeProvider(): CompositeMetadataProvider {
    return this.compositeProvider
  }
}
