import { CompositeMetadataProvider } from './CompositeMetadataProvider'
import { TMDBMetadataProvider } from './providers/TMDBMetadataProvider'
import { AniListMetadataProvider } from './providers/AniListMetadataProvider'
import { OMDbMetadataProvider } from './providers/OMDbMetadataProvider'
import { TVMazeMetadataProvider } from './providers/TVMazeMetadataProvider'
import { TVDBMetadataProvider } from './providers/TVDBMetadataProvider'
import { MusicBrainzMetadataProvider } from './providers/MusicBrainzMetadataProvider'
import { MetadataMatchingService } from './MetadataMatchingService'
import { getDatabase } from '../../database/BetterSQLiteService'

/**
 * MetadataRegistryService - Singleton orchestrator for metadata provider strategies.
 */
export class MetadataRegistryService {
  private static instance: MetadataRegistryService
  private compositeProvider: CompositeMetadataProvider

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

    // OMDb Provider (IMDb Metadata & Ratings)
    const omdbProvider = new OMDbMetadataProvider(() => {
      try {
        const ConfigService = require('../ConfigService').ConfigService
        return ConfigService.getInstance().get('omdb_api_key') || ''
      } catch {
        return ''
      }
    })

    const tvdbProvider = new TVDBMetadataProvider(() => ({
      apiKey: (() => { try { const ConfigService = require('../ConfigService').ConfigService; return ConfigService.getInstance().get('tvdb_api_key') || '' } catch { return '' } })(),
      pin: (() => { try { const ConfigService = require('../ConfigService').ConfigService; return ConfigService.getInstance().get('tvdb_pin') || undefined } catch { return undefined } })()
    }))

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
}
