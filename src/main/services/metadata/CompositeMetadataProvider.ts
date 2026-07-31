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

  async searchAndFuse(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    const matchingProviders = this.providers.filter(p => p.supportedTypes.includes(query.type))
    const results = await Promise.allSettled(
      matchingProviders.map(p => p.search(query))
    )

    const allCandidates: MetadataSearchResult[] = []
    for (const res of results) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        allCandidates.push(...res.value)
      }
    }

    // Naive fusion/scoring based on title and year
    const targetTitle = query.title.toLowerCase()
    
    // Score candidates and group them? We can just score them.
    for (const candidate of allCandidates) {
      let score = 0
      const cTitle = candidate.title.toLowerCase()
      if (cTitle === targetTitle) {
        score += 50
      } else if (cTitle.includes(targetTitle) || targetTitle.includes(cTitle)) {
        score += 20
      }

      if (query.year && candidate.year) {
        if (query.year === candidate.year) {
          score += 30
        } else if (Math.abs(query.year - candidate.year) === 1) {
          score += 10
        }
      }

      candidate.score = score
    }
    
    // We could do actual fusion, merging complementary fields
    const fusedMap = new Map<string, MetadataSearchResult & { imdbRating?: number, imdbVotes?: string }>()
    
    for (const candidate of allCandidates) {
      const key = `${candidate.title.toLowerCase()}_${candidate.year || 'unknown'}`
      if (!fusedMap.has(key)) {
        fusedMap.set(key, { ...candidate })
      } else {
        const existing = fusedMap.get(key)!
        // Merge complementary fields (hacky but fits the requested description)
        const cAsAny = candidate as any
        if (cAsAny.imdbRating) existing.imdbRating = cAsAny.imdbRating
        if (cAsAny.imdbVotes) existing.imdbVotes = cAsAny.imdbVotes
        if ((candidate.score || 0) > (existing.score || 0)) existing.score = candidate.score
      }
    }

    const finalResults = Array.from(fusedMap.values())
    finalResults.sort((a, b) => (b.score || 0) - (a.score || 0))

    return finalResults
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
