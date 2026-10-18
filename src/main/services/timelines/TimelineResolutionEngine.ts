
import type { MediaItem, SeriesCompleteness, MissingEpisode } from '../../types/database'
import type { TimelineDefinition, TimelineItem } from './ITimelineRecipeProvider'

export interface ResolvedTimelineItem extends TimelineItem {
  order: number
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
  ambiguousCount?: number
  timeline: TimelineDefinition
  totalCount: number
  matchedCount: number
  missingCount: number
  completionPercentage: number
  items: ResolvedTimelineItem[]
}

/**
 * Universal media title cleaner applying standard media catalog normalization:
 * - NFKD unicode decomposition (accents/diacritics removed)
 * - Roman numeral conversion (I-XIII -> 1-13)
 * - Strips edition/release tags: (Extended), (Director's Cut), [Remastered], (1982), etc.
 * - Punctuation stripping and whitespace collapsing
 */
export function normalizeMediaTitle(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\((?:directors? cut|extended|remastered|theatrical|special edition|unrated|imax|final cut|\d{4})\)/gi, '')
    .replace(/\[(?:directors? cut|extended|remastered|theatrical|special edition|unrated|imax|final cut|\d{4}|4k|1080p|720p|hdr|dvd|bluray)\]/gi, '')
    .replace(/\b(xiii)\b/gi, '13')
    .replace(/\b(xii)\b/gi, '12')
    .replace(/\b(xi)\b/gi, '11')
    .replace(/\b(viii)\b/gi, '8')
    .replace(/\b(vii)\b/gi, '7')
    .replace(/\b(vi)\b/gi, '6')
    .replace(/\b(iv)\b/gi, '4')
    .replace(/\b(v)\b/gi, '5')
    .replace(/\b(ix)\b/gi, '9')
    .replace(/\b(iii)\b/gi, '3')
    .replace(/\b(ii)\b/gi, '2')
    .replace(/\b(i)\b/gi, '1')
    .replace(/\b(x)\b/gi, '10')
    .replace(/['’"`]/g, '')
    .replace(/[:\-–—,.!_?#&()[\]{}/\\+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class TimelineResolutionEngine {
  constructor(
    private readonly loadLibrary: (sourceId: string) => MediaItem[],
    private readonly loadCompleteness?: (sourceId: string) => SeriesCompleteness[]
  ) {}

  async resolveTimeline(timeline: TimelineDefinition, sourceId?: string, signal?: AbortSignal): Promise<ResolvedTimelineResult> {
    const local = sourceId ? this.loadLibrary(sourceId) : []
    signal?.throwIfAborted()
    const completeness = (sourceId && this.loadCompleteness) ? this.loadCompleteness(sourceId) : []
    signal?.throwIfAborted()
    const items: ResolvedTimelineItem[] = []

    const append = (item: TimelineItem, candidates: MediaItem[]) => {
      const match = candidates.length === 1 ? candidates[0] : undefined
      items.push({
        ...item,
        order: items.length + 1,
        status: candidates.length > 1 ? 'ambiguous' : match ? 'matched' : 'missing',
        reason: !sourceId
          ? 'Select a media source to resolve local availability.'
          : candidates.length > 1
          ? 'Multiple local editions or series match; choose an unambiguous library identity.'
          : undefined,
        matchedMediaItem: match?.id == null
          ? undefined
          : {
              id: match.id,
              plexId: match.plex_id,
              sourceId: match.source_id ?? sourceId!,
              sourceType: match.source_type ?? 'plex',
              title: match.title,
              filePath: match.file_path,
              resolution: match.resolution,
              videoCodec: match.video_codec,
              duration: match.duration,
            },
      })
    }

    for (const [index, item] of timeline.items.entries()) {
      if (index % 128 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve))
        signal?.throwIfAborted()
      }
      if (item.identityIssue) {
        items.push({ ...item, order: items.length + 1, status: 'ambiguous', reason: item.identityIssue })
        continue
      }
      if (item.type !== 'show') {
        append(item, local.filter(row => this.matches(item, row)))
        continue
      }

      const range = item.title.match(/seasons?\s+(\d+)(?:\s*[-–—]\s*(\d+))?/i)
      const inRange = (season: number) => !range || (season >= Number(range[1]) && season <= Number(range[2] ?? range[1]))
      const episodes = local.filter(row => this.matches(item, row) && row.season_number !== null && row.episode_number !== null && inRange(row.season_number!))
      const identityKeys = new Set(episodes.map(row => `${row.library_id}:${row.series_identity_key}`))
      if (identityKeys.size > 1) {
        append(item, episodes)
        continue
      }

      const missing = completeness.filter(row => {
        if (episodes.length) return row.series_identity_key === episodes[0].series_identity_key && row.library_id === episodes[0].library_id
        return item.identifiers.tmdbId
          ? row.tmdb_id === String(item.identifiers.tmdbId)
          : normalizeMediaTitle(row.series_title) === normalizeMediaTitle(item.seriesTitle || item.title.replace(/\s*\(?seasons?\s+\d+(?:\s*[-–—]\s*\d+)?\)?/i, ''))
      }).flatMap(row => {
        try {
          return (typeof row.missing_episodes === 'string' ? JSON.parse(row.missing_episodes) : row.missing_episodes || []) as MissingEpisode[]
        } catch {
          return []
        }
      }).filter(ep => inRange(ep.season_number))

      const coordinates = new Map<string, { season: number; episode: number; title: string }>()
      for (const ep of episodes) {
        coordinates.set(`${ep.season_number}:${ep.episode_number}`, { season: ep.season_number!, episode: ep.episode_number!, title: ep.title })
      }
      for (const ep of missing) {
        const key = `${ep.season_number}:${ep.episode_number}`
        if (!coordinates.has(key)) {
          coordinates.set(key, { season: ep.season_number, episode: ep.episode_number, title: ep.title || `${item.seriesTitle || item.title} S${ep.season_number}E${ep.episode_number}` })
        }
      }

      if (!coordinates.size) {
        append(item, [])
        continue
      }

      for (const ep of [...coordinates.values()].sort((a, b) => a.season - b.season || a.episode - b.episode)) {
        append(
          {
            ...item,
            type: 'episode',
            title: ep.title,
            seriesTitle: item.seriesTitle || episodes[0]?.series_title || item.title,
            seasonNumber: ep.season,
            episodeNumber: ep.episode,
          },
          episodes.filter(row => row.season_number === ep.season && row.episode_number === ep.episode)
        )
      }
    }

    const seenEpisodes = new Set<string>()
    for (const item of items) {
      signal?.throwIfAborted()
      if (item.type !== 'episode') continue
      const identity = JSON.stringify([
        item.identifiers.tmdbId,
        item.identifiers.tvdbId,
        item.identifiers.imdbId,
        normalizeMediaTitle(item.seriesTitle || ''),
        item.seasonNumber,
        item.episodeNumber,
      ])
      if (seenEpisodes.has(identity) && !item.deliberateRepeat) {
        item.status = 'ambiguous'
        item.reason = 'Repeated episode identity requires explicit deliberateRepeat in the guide.'
      }
      seenEpisodes.add(identity)
    }

    const matchedCount = items.filter(item => item.status === 'matched').length
    signal?.throwIfAborted()
    const ambiguousCount = items.filter(item => item.status === 'ambiguous').length
    return {
      timeline,
      sourceId,
      items,
      totalCount: items.length,
      matchedCount,
      ambiguousCount,
      missingCount: items.filter(item => item.status === 'missing').length,
      completionPercentage: items.length ? Math.round((matchedCount / items.length) * 100) : 0,
    }
  }

  private matches(item: TimelineItem, row: MediaItem): boolean {
    if (row.type !== (item.type === 'movie' ? 'movie' : 'episode')) return false
    if (item.type === 'episode' && (row.season_number !== item.seasonNumber || row.episode_number !== item.episodeNumber)) return false
    const ids = item.identifiers
    const canonical: boolean[] = []
    if (ids.tmdbId) {
      canonical.push(item.type === 'movie' ? row.tmdb_id === String(ids.tmdbId) : row.series_tmdb_id === String(ids.tmdbId) || row.series_identity_key === `tmdb:${ids.tmdbId}`)
    }
    if (ids.tvdbId) {
      canonical.push(row.series_identity_key === `tvdb:${ids.tvdbId}`)
    }
    if (ids.imdbId) {
      canonical.push(item.type === 'movie' ? row.imdb_id?.replace(/^tt/, '') === ids.imdbId.replace(/^tt/, '') : row.series_identity_key === `imdb:${ids.imdbId}`)
    }
    if (canonical.length) {
      if (ids.tmdbId && row.tmdb_id && item.type === 'movie' && row.tmdb_id !== String(ids.tmdbId)) return false
      if (ids.tmdbId && item.type !== 'movie' && row.series_tmdb_id && row.series_tmdb_id !== String(ids.tmdbId)) return false
      if (ids.tvdbId && row.series_identity_key?.startsWith('tvdb:') && row.series_identity_key !== `tvdb:${ids.tvdbId}`) return false
      if (ids.imdbId && item.type === 'movie' && row.imdb_id && row.imdb_id.replace(/^tt/, '') !== ids.imdbId.replace(/^tt/, '')) return false
      if (ids.imdbId && item.type !== 'movie' && row.series_identity_key?.startsWith('imdb:') && row.series_identity_key !== `imdb:${ids.imdbId}`) return false
      return canonical.some(Boolean)
    }
    if (item.type === 'movie') {
      return normalizeMediaTitle(row.title) === normalizeMediaTitle(item.title) && (!item.airDate || row.year === Number(item.airDate.slice(0, 4)))
    }
    const series = item.seriesTitle || (item.type === 'show' ? item.title.replace(/\s*\(?seasons?\s+\d+(?:\s*[-–—]\s*\d+)?\)?/i, '') : '')
    return Boolean(series && row.series_title && normalizeMediaTitle(row.series_title) === normalizeMediaTitle(series))
  }
}
