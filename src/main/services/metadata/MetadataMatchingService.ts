import { CompositeMetadataProvider } from './CompositeMetadataProvider'
import { MetadataType, MetadataSearchResult } from './IMetadataProvider'

export interface MatchMediaItemParams {
  title: string
  year?: number
  type: MetadataType
  externalIds?: Record<string, string>
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
    return this.compositeProvider.searchAndFuse({
      title: params.title,
      year: params.year,
      type: params.type,
      externalIds: params.externalIds
    })
  }
}
