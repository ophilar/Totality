import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { eq, and, or } from 'drizzle-orm'
import * as schema from '@main/database/drizzleSchema'
import type { TimelineDefinition, TimelineItem, TimelineItemIdentifiers } from './ITimelineRecipeProvider'

export interface ResolvedTimelineItem {
  order: number
  type: 'movie' | 'episode' | 'show'
  title: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  airDate?: string
  timelineEra?: string
  identifiers: TimelineItemIdentifiers
  status: 'matched' | 'missing'
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
  constructor(private readonly db: LibSQLDatabase<typeof schema>) {}

  async resolveTimeline(timeline: TimelineDefinition, sourceId?: string): Promise<ResolvedTimelineResult> {
    const resolvedItems: ResolvedTimelineItem[] = []
    let matchedCount = 0

    for (const item of timeline.items) {
      const match = await this.findLocalMatch(item, sourceId)
      if (match) {
        matchedCount++
        resolvedItems.push({
          ...item,
          status: 'matched',
          matchedMediaItem: {
            id: match.id,
            plexId: match.plexId,
            sourceId: match.sourceId,
            sourceType: match.sourceType,
            title: match.title,
            filePath: match.filePath,
            resolution: match.resolution,
            videoCodec: match.videoCodec,
            duration: match.duration,
          },
        })
      } else {
        resolvedItems.push({
          ...item,
          status: 'missing',
        })
      }
    }

    const totalCount = timeline.items.length
    const missingCount = totalCount - matchedCount
    const completionPercentage = totalCount > 0 ? Math.round((matchedCount / totalCount) * 100) : 0

    return {
      timeline,
      totalCount,
      matchedCount,
      missingCount,
      completionPercentage,
      items: resolvedItems,
    }
  }

  private async findLocalMatch(item: TimelineItem, sourceId?: string): Promise<typeof schema.mediaItems.$inferSelect | null> {
    if (item.type === 'movie') {
      return await this.findMovieMatch(item, sourceId)
    }

    if (item.type === 'episode') {
      return await this.findEpisodeMatch(item, sourceId)
    }

    if (item.type === 'show') {
      return await this.findShowMatch(item, sourceId)
    }

    return null
  }

  private async findMovieMatch(item: TimelineItem, sourceId?: string): Promise<typeof schema.mediaItems.$inferSelect | null> {
    const { tmdbId, imdbId } = item.identifiers

    // Tier 1: Canonical Standard Provider IDs (TMDb, IMDb)
    const idConditions = []
    if (tmdbId) {
      idConditions.push(eq(schema.mediaItems.tmdbId, String(tmdbId)))
    }
    if (imdbId) {
      idConditions.push(eq(schema.mediaItems.imdbId, imdbId))
      const cleanImdb = imdbId.replace(/^tt/, '')
      if (cleanImdb !== imdbId) {
        idConditions.push(eq(schema.mediaItems.imdbId, cleanImdb))
      }
    }

    if (idConditions.length > 0) {
      if (sourceId) {
        const resSource = await this.db
          .select()
          .from(schema.mediaItems)
          .where(and(eq(schema.mediaItems.type, 'movie'), eq(schema.mediaItems.sourceId, sourceId), or(...idConditions)))
          .limit(1)
        if (resSource[0]) return resSource[0]
      }

      const resGlobal = await this.db
        .select()
        .from(schema.mediaItems)
        .where(and(eq(schema.mediaItems.type, 'movie'), or(...idConditions)))
        .limit(1)
      if (resGlobal[0]) return resGlobal[0]
    }

    // Tier 2: Universal Standard Media Title Normalization & Fuzzy Fallback
    const targetNorm = normalizeMediaTitle(item.title)
    const expectedYear = item.airDate ? parseInt(item.airDate.slice(0, 4), 10) : undefined

    const movieCandidates = await this.db
      .select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.type, 'movie'))

    let bestMatch: typeof schema.mediaItems.$inferSelect | null = null
    let bestScore = 0

    // Extract subtitle component if title format is "Main: Subtitle" or "Main - Subtitle"
    const titleParts = item.title.split(/[:\-–—]/).map((p) => normalizeMediaTitle(p)).filter(Boolean)
    const subtitleNorm = titleParts.length > 1 ? titleParts[titleParts.length - 1] : ''

    for (const candidate of movieCandidates) {
      const candNorm = normalizeMediaTitle(candidate.title)
      const candSort = candidate.sortTitle ? normalizeMediaTitle(candidate.sortTitle) : ''

      let score = 0

      if (candNorm === targetNorm || candSort === targetNorm) {
        score = 100
      } else if (subtitleNorm && (candNorm.includes(subtitleNorm) || candSort.includes(subtitleNorm))) {
        score = 85
      } else if (candNorm.length > 4 && targetNorm.length > 4 && (candNorm.includes(targetNorm) || targetNorm.includes(candNorm))) {
        score = 75
      }

      if (score > 0) {
        // Year alignment verification
        if (expectedYear && candidate.year) {
          if (candidate.year === expectedYear) {
            score += 20
          } else if (Math.abs(candidate.year - expectedYear) <= 1) {
            score += 10
          } else {
            score -= 30 // Penalize year mismatch for same-franchise different movies
          }
        }

        // Source priority
        if (sourceId && candidate.sourceId === sourceId) {
          score += 5
        }

        if (score > bestScore) {
          bestScore = score
          bestMatch = candidate
        }
      }
    }

    if (bestMatch && bestScore >= 75) {
      return bestMatch
    }

    return null
  }

  private async findEpisodeMatch(item: TimelineItem, sourceId?: string): Promise<typeof schema.mediaItems.$inferSelect | null> {
    if (item.seasonNumber === undefined || item.episodeNumber === undefined) {
      return null
    }

    const { tmdbId, tvdbId, imdbId } = item.identifiers

    // Tier 1: Canonical Standard Provider IDs (TMDb series/episode ID, TVDb show ID, IMDb episode ID)
    const idConditions = []
    if (tmdbId) {
      idConditions.push(eq(schema.mediaItems.tmdbId, String(tmdbId)))
      idConditions.push(eq(schema.mediaItems.seriesTmdbId, String(tmdbId)))
      idConditions.push(eq(schema.mediaItems.seriesIdentityKey, `tmdb:${tmdbId}`))
    }
    if (tvdbId) {
      idConditions.push(eq(schema.mediaItems.seriesIdentityKey, `tvdb:${tvdbId}`))
    }
    if (imdbId) {
      idConditions.push(eq(schema.mediaItems.imdbId, imdbId))
      const cleanImdb = imdbId.replace(/^tt/, '')
      if (cleanImdb !== imdbId) {
        idConditions.push(eq(schema.mediaItems.imdbId, cleanImdb))
      }
    }

    if (idConditions.length > 0) {
      const episodeWhere = and(
        eq(schema.mediaItems.type, 'episode'),
        eq(schema.mediaItems.seasonNumber, item.seasonNumber),
        eq(schema.mediaItems.episodeNumber, item.episodeNumber),
        or(...idConditions)
      )

      if (sourceId) {
        const resSource = await this.db
          .select()
          .from(schema.mediaItems)
          .where(and(eq(schema.mediaItems.sourceId, sourceId), episodeWhere))
          .limit(1)
        if (resSource[0]) return resSource[0]
      }

      const resGlobal = await this.db
        .select()
        .from(schema.mediaItems)
        .where(episodeWhere)
        .limit(1)
      if (resGlobal[0]) return resGlobal[0]
    }

    // Tier 2: Universal Series Title Normalization + Season Number + Episode Number
    const targetSeriesNorm = item.seriesTitle ? normalizeMediaTitle(item.seriesTitle) : ''
    const targetEpTitleNorm = item.title ? normalizeMediaTitle(item.title) : ''

    const candidates = await this.db
      .select()
      .from(schema.mediaItems)
      .where(
        and(
          eq(schema.mediaItems.type, 'episode'),
          eq(schema.mediaItems.seasonNumber, item.seasonNumber),
          eq(schema.mediaItems.episodeNumber, item.episodeNumber)
        )
      )

    let bestMatch: typeof schema.mediaItems.$inferSelect | null = null
    let bestScore = 0

    // Extract non-stopword tokens for word overlap comparison
    const targetSeriesTokens = targetSeriesNorm.split(' ').filter((t) => t.length > 2)

    for (const candidate of candidates) {
      const candSeriesNorm = candidate.seriesTitle ? normalizeMediaTitle(candidate.seriesTitle) : ''
      const candEpTitleNorm = candidate.title ? normalizeMediaTitle(candidate.title) : ''

      let score = 0

      if (targetSeriesNorm && candSeriesNorm) {
        if (candSeriesNorm === targetSeriesNorm) {
          score = 100
        } else if (targetSeriesNorm.includes(candSeriesNorm) || candSeriesNorm.includes(targetSeriesNorm)) {
          score = 80
        } else {
          // Token overlap comparison
          const candTokens = candSeriesNorm.split(' ').filter((t) => t.length > 2)
          const matchedTokens = targetSeriesTokens.filter((t) => candTokens.includes(t))
          if (matchedTokens.length > 0) {
            const overlapRatio = (matchedTokens.length * 2) / (targetSeriesTokens.length + candTokens.length)
            if (overlapRatio >= 0.5) {
              score = Math.round(overlapRatio * 80)
            }
          }
        }
      }

      // Episode title match verification
      if (targetEpTitleNorm && candEpTitleNorm) {
        if (candEpTitleNorm === targetEpTitleNorm) {
          score += 50
        } else if (candEpTitleNorm.length > 4 && (candEpTitleNorm.includes(targetEpTitleNorm) || targetEpTitleNorm.includes(candEpTitleNorm))) {
          score += 25
        } else if (score > 0) {
          // If episode titles exist and completely mismatch for the same S/E, penalize generic prefix overlap
          score -= 40
        }
      }

      if (sourceId && candidate.sourceId === sourceId) {
        score += 5
      }

      if (score > bestScore) {
        bestScore = score
        bestMatch = candidate
      }
    }

    if (bestMatch && bestScore >= 70) {
      return bestMatch
    }

    // Tier 3: Universal Episode Title Match Fallback
    if (targetEpTitleNorm) {
      const epCandidates = await this.db
        .select()
        .from(schema.mediaItems)
        .where(and(eq(schema.mediaItems.type, 'episode'), eq(schema.mediaItems.seasonNumber, item.seasonNumber)))

      for (const candidate of epCandidates) {
        const candTitleNorm = normalizeMediaTitle(candidate.title)
        if (candTitleNorm === targetEpTitleNorm || (candTitleNorm.length > 6 && candTitleNorm.includes(targetEpTitleNorm))) {
          return candidate
        }
      }
    }

    return null
  }

  private async findShowMatch(item: TimelineItem, sourceId?: string): Promise<typeof schema.mediaItems.$inferSelect | null> {
    const { tmdbId, tvdbId, imdbId } = item.identifiers

    // Tier 1: Match by show external ID on series_tmdb_id, series_identity_key, etc.
    const idConditions = []
    if (tmdbId) {
      idConditions.push(eq(schema.mediaItems.seriesTmdbId, String(tmdbId)))
      idConditions.push(eq(schema.mediaItems.seriesIdentityKey, `tmdb:${tmdbId}`))
    }
    if (tvdbId) {
      idConditions.push(eq(schema.mediaItems.seriesIdentityKey, `tvdb:${tvdbId}`))
    }
    if (imdbId) {
      idConditions.push(eq(schema.mediaItems.imdbId, imdbId))
    }

    if (idConditions.length > 0) {
      const showWhere = and(eq(schema.mediaItems.type, 'episode'), or(...idConditions))
      if (sourceId) {
        const resSource = await this.db
          .select()
          .from(schema.mediaItems)
          .where(and(eq(schema.mediaItems.sourceId, sourceId), showWhere))
          .limit(1)
        if (resSource[0]) return resSource[0]
      }
      const resGlobal = await this.db
        .select()
        .from(schema.mediaItems)
        .where(showWhere)
        .limit(1)
      if (resGlobal[0]) return resGlobal[0]
    }

    // Tier 2: Match by normalized Series Title
    const targetSeriesNorm = normalizeMediaTitle(item.seriesTitle || item.title)
    if (targetSeriesNorm) {
      const candidates = await this.db
        .select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.type, 'episode'))

      for (const candidate of candidates) {
        const candSeriesNorm = candidate.seriesTitle ? normalizeMediaTitle(candidate.seriesTitle) : ''
        if (candSeriesNorm === targetSeriesNorm || (candSeriesNorm.length > 4 && (candSeriesNorm.includes(targetSeriesNorm) || targetSeriesNorm.includes(candSeriesNorm)))) {
          return candidate
        }
      }
    }

    return null
  }
}


