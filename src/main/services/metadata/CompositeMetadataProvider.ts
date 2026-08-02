import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from './IMetadataProvider'
import { getLoggingService } from '../LoggingService'
import { normalizeTitleForMatching, scoreTitleMatch } from './TitleMatching'

/**
 * Composite Metadata Provider that aggregates multiple providers and executes multi-provider result fusion.
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
    return this.searchAndFuse(query)
  }

  async searchAndFuse(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    const matchingProviders = this.providers.filter(p => p.supportedTypes.includes(query.type))
    const results = await Promise.allSettled(
      matchingProviders.map(async p => {
        try {
          return await p.search(query)
        } catch (err) {
          getLoggingService().error('[CompositeMetadataProvider]', `Provider ${p.providerId} search failed:`, err)
          return []
        }
      })
    )

    const allCandidates: MetadataSearchResult[] = []
    for (const res of results) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        allCandidates.push(...res.value)
      } else if (res.status === 'rejected') {
        getLoggingService().error('[CompositeMetadataProvider]', 'Provider search rejected:', res.reason)
      }
    }

    for (const candidate of allCandidates) {
      const titleScores = [candidate.title, ...(candidate.alternateTitles || [])]
        .map(title => scoreTitleMatch(title, query.title, candidate.year, query.year))
      candidate.score = Math.max(...titleScores, 0)
    }
    
    const fusedMap = new Map<string, MetadataSearchResult>()
    
    for (const candidate of allCandidates) {
      const key = candidate.externalIds?.tmdbId
        ? `tmdb:${candidate.externalIds.tmdbId}`
        : candidate.externalIds?.imdbId
          ? `imdb:${candidate.externalIds.imdbId}`
          : `${normalizeTitleForMatching(candidate.title)}_${candidate.year || 'unknown'}_${candidate.type}`
      if (!fusedMap.has(key)) {
        fusedMap.set(key, { ...candidate })
      } else {
        const existing = fusedMap.get(key)!
        existing.overview = existing.overview || candidate.overview
        existing.posterUrl = existing.posterUrl || candidate.posterUrl
        existing.bannerUrl = existing.bannerUrl || candidate.bannerUrl
        existing.imdbRating = existing.imdbRating ?? candidate.imdbRating
        existing.imdbVotes = existing.imdbVotes ?? candidate.imdbVotes
        existing.externalIds = { ...candidate.externalIds, ...existing.externalIds }
        existing.alternateTitles = Array.from(new Set([...(existing.alternateTitles || []), ...(candidate.alternateTitles || [])]))
        if ((candidate.score || 0) > (existing.score || 0)) {
          existing.score = candidate.score
        }
      }
    }

    const finalResults = Array.from(fusedMap.values())
    finalResults.sort((a, b) => (b.score || 0) - (a.score || 0))

    return finalResults
  }

  async findByExternalId(externalId: string, source: 'imdb_id' | 'tvdb_id', type: MetadataType): Promise<MediaMetadataDetails | null> {
    const matchingProviders = this.providers.filter(p => p.supportedTypes.includes(type) && typeof p.findByExternalId === 'function')
    const results = await Promise.allSettled(
      matchingProviders.map(async p => {
        try {
          return await p.findByExternalId!(externalId, source, type)
        } catch (err) {
          getLoggingService().error('[CompositeMetadataProvider]', `Provider ${p.providerId} findByExternalId failed:`, err)
          return null
        }
      })
    )

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        return res.value
      }
    }

    return null
  }

  async getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null> {
    const matchingProviders = this.providers.filter(p => p.supportedTypes.includes(type))
    const results = await Promise.allSettled(
      matchingProviders.map(async p => {
        try {
          return await p.getDetails(externalId, type)
        } catch (err) {
          getLoggingService().error('[CompositeMetadataProvider]', `Provider ${p.providerId} getDetails failed:`, err)
          return null
        }
      })
    )

    let primaryDetails: MediaMetadataDetails | null = null

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        const details = res.value
        if (!primaryDetails) {
          primaryDetails = { ...details }
        } else {
          primaryDetails.imdbRating = primaryDetails.imdbRating ?? details.imdbRating
          primaryDetails.imdbVotes = primaryDetails.imdbVotes ?? details.imdbVotes
          primaryDetails.contentRating = primaryDetails.contentRating ?? details.contentRating
          primaryDetails.awards = primaryDetails.awards ?? details.awards
          primaryDetails.overview = primaryDetails.overview || details.overview
          primaryDetails.posterUrl = primaryDetails.posterUrl || details.posterUrl
        }
      }
    }

    return primaryDetails
  }
}

