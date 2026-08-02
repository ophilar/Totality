import { CompositeMetadataProvider } from './CompositeMetadataProvider'
import { MetadataType, MetadataSearchResult } from './IMetadataProvider'
import { normalizeTitleForMatching, scoreTitleMatch } from './TitleMatching'

export interface MatchMediaItemParams {
  title: string
  year?: number
  type: MetadataType
  externalIds?: Record<string, string>
  includeAdult?: boolean
}

/**
 * Unified single-path orchestrator for matching media metadata.
 * Uses CompositeMetadataProvider's fusion capability to fetch and score metadata.
 */
export class MetadataMatchingService {
  constructor(private compositeProvider: CompositeMetadataProvider) {}

  /**
   * Matches a media item using the composite provider and returns a list of sorted candidates.
   */
  async matchMediaItem(params: MatchMediaItemParams): Promise<MetadataSearchResult[]> {
    const normalizedTitle = normalizeTitleForMatching(params.title)
    const queries = [
      { title: params.title, year: params.year },
      { title: normalizedTitle, year: params.year },
      { title: params.title },
      { title: normalizedTitle }
    ].filter((query, index, all) => query.title && all.findIndex(candidate => candidate.title === query.title && candidate.year === query.year) === index)

    const candidates = new Map<string, MetadataSearchResult>()
    for (const query of queries) {
      const results = await this.compositeProvider.searchAndFuse({
        title: query.title,
        year: query.year,
        type: params.type,
        externalIds: params.externalIds,
        includeAdult: params.includeAdult
      })

      for (const result of results) {
        const key = result.externalIds?.tmdbId
          ? `tmdb:${result.externalIds.tmdbId}`
          : result.externalIds?.imdbId
            ? `imdb:${result.externalIds.imdbId}`
            : `${normalizeTitleForMatching(result.title)}_${result.year || 'unknown'}_${result.type}`
        const existing = candidates.get(key)
        if (!existing || scoreTitleMatch(result.title, params.title, result.year, params.year) > scoreTitleMatch(existing.title, params.title, existing.year, params.year)) {
          candidates.set(key, { ...result })
        } else {
          if (!existing.overview && result.overview) existing.overview = result.overview
          if (!existing.posterUrl && result.posterUrl) existing.posterUrl = result.posterUrl
          if (!existing.bannerUrl && result.bannerUrl) existing.bannerUrl = result.bannerUrl
          if (result.externalIds || existing.externalIds) {
            existing.externalIds = { ...result.externalIds, ...existing.externalIds }
          }
        }
      }
    }

    return Array.from(candidates.values()).sort((a, b) =>
      scoreTitleMatch(b.title, params.title, b.year, params.year) - scoreTitleMatch(a.title, params.title, a.year, params.year)
    )
  }
}
