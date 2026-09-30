import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import * as schema from '@main/database/drizzleSchema'
import type { MissingEpisode } from '@main/types/database'
import type { TimelineDefinition, TimelineItem, TimelineItemIdentifiers } from './ITimelineRecipeProvider'

export interface ResolvedTimelineItem {
  order: number
  type: 'movie' | 'episode' | 'show'
  title: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  deliberateRepeat?: boolean
  airDate?: string
  timelineEra?: string
  identifiers: TimelineItemIdentifiers
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

type LocalItem = typeof schema.mediaItems.$inferSelect

export class TimelineResolutionEngine {
  constructor(private readonly db: LibSQLDatabase<typeof schema>) {}

  async resolveTimeline(timeline: TimelineDefinition, sourceId?: string): Promise<ResolvedTimelineResult> {
    const local = sourceId ? await this.db.select().from(schema.mediaItems).where(eq(schema.mediaItems.sourceId, sourceId)) : []
    const completeness = sourceId ? await this.db.select().from(schema.seriesCompleteness).where(eq(schema.seriesCompleteness.sourceId, sourceId)) : []
    const items: ResolvedTimelineItem[] = []
    const append = (item: TimelineItem, candidates: LocalItem[]) => {
      const match = candidates.length === 1 ? candidates[0] : undefined
      items.push({ ...item, order: items.length + 1,
        status: candidates.length > 1 ? 'ambiguous' : match ? 'matched' : 'missing',
        reason: !sourceId ? 'Select a media source to resolve local availability.' : candidates.length > 1 ? 'Multiple local editions or series match; choose an unambiguous library identity.' : undefined,
        matchedMediaItem: match ? { id: match.id, plexId: match.plexId, sourceId: match.sourceId, sourceType: match.sourceType, title: match.title, filePath: match.filePath, resolution: match.resolution, videoCodec: match.videoCodec, duration: match.duration } : undefined,
      })
    }
    for (const item of timeline.items) {
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
      const episodes = local.filter(row => this.matches(item, row) && row.seasonNumber !== null && row.episodeNumber !== null && inRange(row.seasonNumber))
      const identityKeys = new Set(episodes.map(row => `${row.libraryId}:${row.seriesIdentityKey}`))
      if (identityKeys.size > 1) { append(item, episodes); continue }
      const missing = completeness.filter(row => {
        if (episodes.length) return row.seriesIdentityKey === episodes[0].seriesIdentityKey && row.libraryId === episodes[0].libraryId
        return item.identifiers.tmdbId ? row.tmdbId === String(item.identifiers.tmdbId) : item.identifiers.tvdbId ? row.tvdbId === String(item.identifiers.tvdbId) : normalizeMediaTitle(row.seriesTitle) === normalizeMediaTitle(item.seriesTitle || item.title.replace(/\s*\(?seasons?\s+\d+(?:\s*[-–—]\s*\d+)?\)?/i, ''))
      }).flatMap(row => JSON.parse(row.missingEpisodes) as MissingEpisode[]).filter(ep => inRange(ep.season_number))
      const coordinates = new Map<string, { season: number; episode: number; title: string }>()
      for (const ep of episodes) coordinates.set(`${ep.seasonNumber}:${ep.episodeNumber}`, { season: ep.seasonNumber!, episode: ep.episodeNumber!, title: ep.title })
      for (const ep of missing) {
        const key = `${ep.season_number}:${ep.episode_number}`
        if (!coordinates.has(key)) coordinates.set(key, { season: ep.season_number, episode: ep.episode_number, title: ep.title || `${item.seriesTitle || item.title} S${ep.season_number}E${ep.episode_number}` })
      }
      if (!coordinates.size) { append(item, []); continue }
      for (const ep of [...coordinates.values()].sort((a, b) => a.season - b.season || a.episode - b.episode)) {
        append({ ...item, type: 'episode', title: ep.title, seriesTitle: item.seriesTitle || episodes[0]?.seriesTitle || item.title, seasonNumber: ep.season, episodeNumber: ep.episode }, episodes.filter(row => row.seasonNumber === ep.season && row.episodeNumber === ep.episode))
      }
    }
    const seenEpisodes = new Set<string>()
    for (const item of items) {
      if (item.type !== 'episode') continue
      const identity = JSON.stringify([item.identifiers.tmdbId, item.identifiers.tvdbId, item.identifiers.imdbId, normalizeMediaTitle(item.seriesTitle || ''), item.seasonNumber, item.episodeNumber])
      if (seenEpisodes.has(identity) && !item.deliberateRepeat) {
        item.status = 'ambiguous'
        item.reason = 'Repeated episode identity requires explicit deliberateRepeat in the guide.'
      }
      seenEpisodes.add(identity)
    }
    const matchedCount = items.filter(item => item.status === 'matched').length
    const ambiguousCount = items.filter(item => item.status === 'ambiguous').length
    return { timeline, sourceId, items, totalCount: items.length, matchedCount, ambiguousCount, missingCount: items.filter(item => item.status === 'missing').length, completionPercentage: items.length ? Math.round(matchedCount / items.length * 100) : 0 }
  }

  private matches(item: TimelineItem, row: LocalItem): boolean {
    if (row.type !== (item.type === 'movie' ? 'movie' : 'episode')) return false
    if (item.type === 'episode' && (row.seasonNumber !== item.seasonNumber || row.episodeNumber !== item.episodeNumber)) return false
    const ids = item.identifiers
    const canonical: boolean[] = []
    if (ids.tmdbId) canonical.push(item.type === 'movie' ? row.tmdbId === String(ids.tmdbId) : row.seriesTmdbId === String(ids.tmdbId) || row.seriesIdentityKey === `tmdb:${ids.tmdbId}`)
    if (ids.tvdbId) canonical.push(row.seriesIdentityKey === `tvdb:${ids.tvdbId}`)
    if (ids.imdbId) canonical.push(item.type === 'movie' ? row.imdbId?.replace(/^tt/, '') === ids.imdbId.replace(/^tt/, '') : row.seriesIdentityKey === `imdb:${ids.imdbId}`)
    if (canonical.length) {
      if (ids.tmdbId && row.tmdbId && item.type === 'movie' && row.tmdbId !== String(ids.tmdbId)) return false
      if (ids.tmdbId && item.type !== 'movie' && row.seriesTmdbId && row.seriesTmdbId !== String(ids.tmdbId)) return false
      if (ids.tvdbId && row.seriesIdentityKey?.startsWith('tvdb:') && row.seriesIdentityKey !== `tvdb:${ids.tvdbId}`) return false
      if (ids.imdbId && item.type === 'movie' && row.imdbId && row.imdbId.replace(/^tt/, '') !== ids.imdbId.replace(/^tt/, '')) return false
      if (ids.imdbId && item.type !== 'movie' && row.seriesIdentityKey?.startsWith('imdb:') && row.seriesIdentityKey !== `imdb:${ids.imdbId}`) return false
      return canonical.some(Boolean)
    }
    if (item.type === 'movie') return normalizeMediaTitle(row.title) === normalizeMediaTitle(item.title) && (!item.airDate || row.year === Number(item.airDate.slice(0, 4)))
    const series = item.seriesTitle || (item.type === 'show' ? item.title.replace(/\s*\(?seasons?\s+\d+(?:\s*[-–—]\s*\d+)?\)?/i, '') : '')
    return Boolean(series && row.seriesTitle && normalizeMediaTitle(row.seriesTitle) === normalizeMediaTitle(series))
  }
}
