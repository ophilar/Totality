export type MetadataType = 'movie' | 'tv' | 'anime' | 'music' | 'artwork'

export interface MetadataSearchQuery {
  title: string
  year?: number
  type: MetadataType
  externalId?: string
  seasonNumber?: number
  episodeNumber?: number
  includeAdult?: boolean
}

export interface MetadataSearchResult {
  id: string
  provider: string
  title: string
  year?: number
  type: MetadataType
  posterUrl?: string
  bannerUrl?: string
  overview?: string
  score?: number
}

export interface MediaMetadataDetails extends MetadataSearchResult {
  genres?: string[]
  totalSeasons?: number
  totalEpisodes?: number
  collectionId?: string
  collectionName?: string
  contentRating?: string
  imdbRating?: number
  imdbVotes?: string
  awards?: string
  externalIds?: {
    imdbId?: string
    tvdbId?: string
    tmdbId?: string
  }
  raw?: Record<string, unknown>
}

/**
 * Strategy interface for media metadata providers.
 * Follows SOLID principles (Single Responsibility & Open/Closed Principle).
 */
export interface IMetadataProvider {
  readonly providerId: string
  readonly providerName: string
  readonly supportedTypes: MetadataType[]

  search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]>
  getDetails(externalId: string, type: MetadataType): Promise<MediaMetadataDetails | null>
  findByExternalId?(externalId: string, source: 'imdb_id' | 'tvdb_id', type: MetadataType): Promise<MediaMetadataDetails | null>
}
