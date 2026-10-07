import type { MediaItem } from '../../types/database'
import type { TimelineDefinition, TimelineItem, TimelineItemIdentifiers } from './ITimelineRecipeProvider'

export interface ResolvedTimelineItem extends TimelineItem {
  status: 'matched' | 'missing' | 'ambiguous'
  reason?: string
  matchedMediaItem?: {
    id: number
    plexId: string
    sourceId: string
    sourceType: string
    title: string
    filePath: string
    resolution: string
    videoCodec: string
    duration: number
  }
}

export interface ResolvedTimelineResult {
  snapshotId?: string
  sourceId?: string
  ambiguousCount: number
  timeline: TimelineDefinition
  totalCount: number
  matchedCount: number
  missingCount: number
  completionPercentage: number
  items: ResolvedTimelineItem[]
}

export function normalizeMediaTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\((?:director'?s? cut|extended|remastered|theatrical|special edition|unrated|imax|final cut|\d{4})\)/gi, '')
    .replace(/\[(?:director'?s? cut|extended|remastered|theatrical|special edition|unrated|imax|final cut|\d{4}|4k|1080p|720p|hdr|dvd|bluray)\]/gi, '')
    .replace(/\b(xiii|xii|xi|viii|vii|vi|iv|v|ix|iii|ii|i|x)\b/gi, token => String(({ xiii: 13, xii: 12, xi: 11, viii: 8, vii: 7, vi: 6, iv: 4, v: 5, ix: 9, iii: 3, ii: 2, i: 1, x: 10 })[token] ?? token))
    .replace(/['’"`]/g, '').replace(/[:\-–—,.!_?#&()[\]{}/\\+]/g, ' ').replace(/\s+/g, ' ').trim()
}

export class TimelineResolutionEngine {
  constructor(private readonly loadLibrary: (sourceId: string) => MediaItem[]) {}

  async resolveTimeline(timeline: TimelineDefinition, sourceId?: string, signal?: AbortSignal): Promise<ResolvedTimelineResult> {
    const library = sourceId ? this.loadLibrary(sourceId) : []
    const items: ResolvedTimelineItem[] = []
    for (const [index, item] of timeline.items.entries()) {
      if (index % 128 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve))
        signal?.throwIfAborted()
      }
      if (item.identityIssue) {
        items.push({ ...item, status: 'ambiguous', reason: item.identityIssue })
        continue
      }
      if (!sourceId) {
        items.push({ ...item, status: 'missing', reason: 'Select a media source to resolve local availability.' })
        continue
      }
      const candidates = library.filter(row => this.matches(item, row))
      const match = candidates.length === 1 ? candidates[0] : undefined
      items.push({
        ...item,
        status: candidates.length > 1 ? 'ambiguous' : match ? 'matched' : 'missing',
        reason: candidates.length > 1 ? 'Multiple library items match this guide entry; review the source data.' : undefined,
        matchedMediaItem: match?.id == null ? undefined : {
          id: match.id,
          plexId: match.plex_id,
          sourceId: match.source_id ?? sourceId,
          sourceType: match.source_type ?? 'plex',
          title: match.title,
          filePath: match.file_path,
          resolution: match.resolution,
          videoCodec: match.video_codec,
          duration: match.duration,
        },
      })
    }
    const seenEpisodeIdentities = new Set<string>()
    for (const item of items) {
      signal?.throwIfAborted()
      if (item.type !== 'episode' || item.deliberateRepeat) continue
      const identity = JSON.stringify([item.identifiers.tmdbId, item.identifiers.tvdbId, item.identifiers.imdbId, normalizeMediaTitle(item.seriesTitle || ''), item.seasonNumber, item.episodeNumber])
      if (seenEpisodeIdentities.has(identity)) {
        item.status = 'ambiguous'
        item.reason = 'Repeated episode identity requires explicit deliberateRepeat in the guide.'
      }
      seenEpisodeIdentities.add(identity)
    }
    signal?.throwIfAborted()
    const matchedCount = items.filter(item => item.status === 'matched').length
    return {
      timeline,
      sourceId,
      items,
      totalCount: items.length,
      matchedCount,
      ambiguousCount: items.filter(item => item.status === 'ambiguous').length,
      missingCount: items.filter(item => item.status === 'missing').length,
      completionPercentage: items.length ? Math.round(matchedCount / items.length * 100) : 0,
    }
  }

  private matches(item: TimelineItem, row: MediaItem): boolean {
    if (item.type === 'movie' ? row.type !== 'movie' : row.type !== 'episode') return false
    if (item.type === 'episode' && (row.season_number !== item.seasonNumber || row.episode_number !== item.episodeNumber)) return false
    const ids: TimelineItemIdentifiers = item.identifiers
    if (ids.tmdbId) {
      const rowId = item.type === 'movie' ? row.tmdb_id : row.series_tmdb_id
      if (rowId) return rowId === String(ids.tmdbId)
    }
    if (ids.imdbId && item.type === 'movie' && row.imdb_id) return row.imdb_id.replace(/^tt/, '') === ids.imdbId.replace(/^tt/, '')
    const expectedTitle = item.type === 'movie' ? item.title : item.seriesTitle
    const actualTitle = item.type === 'movie' ? row.title : row.series_title
    if (!expectedTitle || !actualTitle || normalizeMediaTitle(expectedTitle) !== normalizeMediaTitle(actualTitle)) return false
    return !item.releaseYear || !row.year || row.year === item.releaseYear
  }
}
