export interface TimelineItemIdentifiers {
  tmdbId?: number
  tvdbId?: number
  imdbId?: string
}

export interface TimelineItem {
  order: number
  type: 'movie' | 'episode'
  title: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  airDate?: string
  timelineEra?: string
  identifiers: TimelineItemIdentifiers
}

export interface TimelineDefinition {
  id: string
  franchise: string
  name: string
  description: string
  sourceUrl?: string
  version: number
  items: TimelineItem[]
}

export interface TimelineRecipeSummary {
  id: string
  name: string
  franchise: string
  description: string
  totalItems: number
  sourceType: 'preset' | 'remote' | 'trakt'
}

export interface ITimelineRecipeProvider {
  listAvailableRecipes(): Promise<TimelineRecipeSummary[]>
  fetchTimeline(id: string): Promise<TimelineDefinition>
}
