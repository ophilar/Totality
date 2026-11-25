import type { ResolvedTimelineItem } from './TimelineResolutionEngine'

export interface TimelinePlaylistSummary { id: string; title: string; mediaType: string }
export interface TimelinePlaylistPublishOptions {
  sourceId: string
  title: string
  items: readonly ResolvedTimelineItem[]
  existingPlaylistId?: string
  signal: AbortSignal
  onCommitBeginning: () => void
  onPhase: (phase: string) => void
}
export interface TimelinePlaylistPublishResult { sourceId: string; title: string; playlistId?: string; matchedItems: number }
export interface TimelinePlaylistPublisher {
  listPlaylists(signal?: AbortSignal): Promise<readonly TimelinePlaylistSummary[]>
  publish(options: TimelinePlaylistPublishOptions): Promise<TimelinePlaylistPublishResult>
}
