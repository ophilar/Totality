import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from './IMetadataProvider'

/**
 * Composite Metadata Provider that aggregates multiple providers and executes fallback strategies.
 * Follows the Composite & Strategy design patterns (SOLID Principles).
 */
export class CompositeMetadataProvider implements IMetadataProvider {
  readonly providerId = 'composite'
  readonly providerName = 'Composite Provider Aggregator'
  
  private providers: IMetadataProvider[] = []

  constructor(initialProviders: IMetadataProvider[] = []) {
    this.providers = [...initialProviders]
  }

  get supportedTypes(): MetadataType[] {
    const typesSet = new Set<MetadataType>()
    for (const provider of this.providers) {
      provider.supportedTypes.forEach(t => typesSet.add(t))
    }
    return Array.from(typesSet)
  }

  public registerProvider(provider: IMetadataProvider): void {
    if (!this.providers.some(p => p.providerId === provider.providerId)) {
      this.providers.push(provider)
    }
  }

  public getProviders(): IMetadataProvider[] {
    return [...this.providers]
  }

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    const results: MetadataSearchResult[] = []
    const matchingProviders = this.providers.filter(p => p.supportedTypes.includes(query.type))

    for (const provider of matchingProviders) {
      try {
        const providerResults = await provider.search(query)
        if (Array.isArray(providerResults) && providerResults.length > 0) {
          results.push(...providerResults)
        }
      } catch (err) {
        // Continue to next provider in fallback strategy
      }
    }

    return results
  }

  async findByExternalId(externalId: string, source: 'imdb_id' | 'tvdb_id', type: MetadataType): Promise<MediaMetadataDetails | null> {
    const matchingProviders = this.providers.filter(p => p.supportedTypes.includes(type) && typeof p.findByExternalId === 'function')

    for (const provider of matchingProviders) {
      try {
        const details = await provider.findByExternalId!(externalId, source, type)
        if (details) return details
      } catch (err) {
        // Fallback to next provider in cascade
      }
    }

    return null
  }

  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    const matchingProviders = this.providers.filter(p => p.supportedTypes.includes(type))
    let primaryDetails: MediaMetadataDetails | null = null

    for (const provider of matchingProviders) {
      try {
        const details = await provider.getDetails(externalId, type)
        if (details) {
          if (!primaryDetails) {
            primaryDetails = details
          } else {
            // Aggregate complementary fields from secondary providers
            primaryDetails.imdbRating = primaryDetails.imdbRating ?? details.imdbRating
            primaryDetails.imdbVotes = primaryDetails.imdbVotes ?? details.imdbVotes
            primaryDetails.contentRating = primaryDetails.contentRating ?? details.contentRating
            primaryDetails.awards = primaryDetails.awards ?? details.awards
          }
        }
      } catch (err) {
        // Fallback to next provider
      }
    }

    return primaryDetails
  }
}
