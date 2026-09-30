export interface TimelineItemIdentifiers {
  tmdbId?: number
  tvdbId?: number
  imdbId?: string
}

export interface TimelineItem {
  order: number
  type: 'movie' | 'episode' | 'show'
  title: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  airDate?: string
  releaseYear?: number
  timelineEra?: string
  identifiers: TimelineItemIdentifiers
  identityIssue?: string
  deliberateRepeat?: boolean
}

export interface TimelineDefinition {
  id: string
  franchise: string
  name: string
  description: string
  sourceUrl?: string
  version: number
  items: TimelineItem[]
  retrievedAt?: string
  contentFingerprint?: string
  refreshError?: string
  granularity?: 'episode-interleaved' | 'series-blocks' | 'release-order'
}

export interface TimelineRecipeSummary {
  id: string
  name: string
  franchise: string
  description: string
  totalItems: number
  sourceType: 'preset' | 'remote' | 'trakt' | 'web' | 'ai'
  sourceUrl?: string
  granularity?: TimelineDefinition['granularity']
}

export interface TimelineFetchOptions { refresh?: boolean; snapshotId?: string }

export interface ITimelineRecipeProvider {
  supports(input: string): Promise<boolean>
  listAvailableRecipes(): Promise<TimelineRecipeSummary[]>
  fetchTimeline(id: string, options?: TimelineFetchOptions): Promise<TimelineDefinition>
}
