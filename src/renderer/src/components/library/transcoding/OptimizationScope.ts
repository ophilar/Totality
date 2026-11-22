export type OptimizationScope =
  | { kind: 'movie'; mediaId: number }
  | { kind: 'episode'; showId: string; mediaId: number; seasonNumber?: number; episodeNumber?: number }
  | { kind: 'season'; showId: string; seasonNumber: number }
  | { kind: 'show'; showId: string }

export function optimizationScopeForMedia(item: {
  id: number
  type: string
  series_identity_key?: string | null
  season_number?: number
  episode_number?: number
  series_title?: string
}): Extract<OptimizationScope, { kind: 'movie' | 'episode' }> {
  if (item.type === 'movie') return { kind: 'movie', mediaId: item.id }
  if (item.type !== 'episode') throw new Error(`Unsupported optimization media type: ${item.type}`)
  if (!item.series_identity_key) throw new Error(`Optimization requires a stable series identity for ${item.series_title ?? item.id}`)
  return { kind: 'episode', showId: item.series_identity_key, mediaId: item.id, seasonNumber: item.season_number, episodeNumber: item.episode_number }
}

export function optimizationScopeForSeries(show: { series_title: string; series_identity_key?: string | null }, episode?: { id: number; season_number?: number; episode_number?: number }, seasonNumber?: number): Exclude<OptimizationScope, { kind: 'movie' }> {
  const showId = show.series_identity_key
  if (!showId) throw new Error(`Optimization requires a stable identity for ${show.series_title}`)
  if (episode) return { kind: 'episode', showId, mediaId: episode.id, seasonNumber: episode.season_number, episodeNumber: episode.episode_number }
  if (seasonNumber !== undefined) return { kind: 'season', showId, seasonNumber }
  return { kind: 'show', showId }
}

export function describeOptimizationScope(scope: OptimizationScope): string {
  switch (scope.kind) {
    case 'movie': return `movie:${scope.mediaId}`
    case 'episode': return `episode:${scope.showId}:${scope.mediaId}:${scope.seasonNumber ?? 'unknown'}:${scope.episodeNumber ?? 'unknown'}`
    case 'season': return `season:${scope.showId}:${scope.seasonNumber}`
    case 'show': return `show:${scope.showId}`
  }
}
