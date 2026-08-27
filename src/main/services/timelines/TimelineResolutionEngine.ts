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

export const CANONICAL_SHOW_EPISODES: Record<number, { title: string; seasons: Record<number, number> }> = {
  // Star Trek: Enterprise
  1478: { title: 'Star Trek: Enterprise', seasons: { 1: 26, 2: 26, 3: 24, 4: 22 } },
  // Star Trek: Discovery
  67198: { title: 'Star Trek: Discovery', seasons: { 1: 15, 2: 14, 3: 13, 4: 13, 5: 10 } },
  // Star Trek: Short Treks
  82894: { title: 'Star Trek: Short Treks', seasons: { 1: 4, 2: 6 } },
  // Star Trek: Strange New Worlds
  103516: { title: 'Star Trek: Strange New Worlds', seasons: { 1: 10, 2: 10 } },
  // Star Trek: The Original Series
  253: { title: 'Star Trek: The Original Series', seasons: { 1: 29, 2: 26, 3: 24 } },
  // Star Trek: The Animated Series
  1992: { title: 'Star Trek: The Animated Series', seasons: { 1: 16, 2: 6 } },
  // Star Trek: The Next Generation
  655: { title: 'Star Trek: The Next Generation', seasons: { 1: 26, 2: 22, 3: 26, 4: 26, 5: 26, 6: 26, 7: 26 } },
  // Star Trek: Deep Space Nine
  580: { title: 'Star Trek: Deep Space Nine', seasons: { 1: 20, 2: 26, 3: 26, 4: 26, 5: 26, 6: 26, 7: 26 } },
  // Star Trek: Voyager
  1855: { title: 'Star Trek: Voyager', seasons: { 1: 16, 2: 26, 3: 26, 4: 26, 5: 26, 6: 26, 7: 26 } },
  // Star Trek: Lower Decks
  85949: { title: 'Star Trek: Lower Decks', seasons: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 10 } },
  // Star Trek: Prodigy
  106393: { title: 'Star Trek: Prodigy', seasons: { 1: 20, 2: 20 } },
  // Star Trek: Picard
  85948: { title: 'Star Trek: Picard', seasons: { 1: 10, 2: 10, 3: 10 } },
  // Star Wars: The Clone Wars
  41727: { title: 'Star Wars: The Clone Wars', seasons: { 1: 22, 2: 22, 3: 22, 4: 22, 5: 20, 6: 13, 7: 12 } },
  // Star Wars: The Bad Batch
  105971: { title: 'Star Wars: The Bad Batch', seasons: { 1: 16, 2: 16, 3: 15 } },
  // Star Wars Rebels
  60554: { title: 'Star Wars Rebels', seasons: { 1: 15, 2: 22, 3: 22, 4: 16 } },
  // Andor
  83867: { title: 'Andor', seasons: { 1: 12, 2: 12 } },
  // Obi-Wan Kenobi
  92783: { title: 'Obi-Wan Kenobi', seasons: { 1: 6 } },
  // The Mandalorian
  82856: { title: 'The Mandalorian', seasons: { 1: 8, 2: 8, 3: 8 } },
  // The Book of Boba Fett
  115036: { title: 'The Book of Boba Fett', seasons: { 1: 7 } },
  // Ahsoka
  114461: { title: 'Ahsoka', seasons: { 1: 8 } },
  // The Acolyte
  114478: { title: 'The Acolyte', seasons: { 1: 8 } },
  // Skeleton Crew
  202879: { title: 'Star Wars: Skeleton Crew', seasons: { 1: 8 } },
}

export class TimelineResolutionEngine {
  constructor(private readonly db: LibSQLDatabase<typeof schema>) {}

  async resolveTimeline(timeline: TimelineDefinition, sourceId?: string): Promise<ResolvedTimelineResult> {
    const resolvedItems: ResolvedTimelineItem[] = []
    let matchedCount = 0

    for (const item of timeline.items) {
      if (item.type === 'show') {
        const showEpisodes = await this.findAllShowMatches(item, sourceId)
        if (showEpisodes.length > 0) {
          matchedCount++
          for (const ep of showEpisodes) {
            resolvedItems.push({
              ...item,
              type: 'episode',
              seasonNumber: ep.seasonNumber ?? undefined,
              episodeNumber: ep.episodeNumber ?? undefined,
              title: ep.title || item.title,
              seriesTitle: item.seriesTitle || item.title || ep.seriesTitle || undefined,
              status: 'matched',
              matchedMediaItem: {
                id: ep.id,
                plexId: ep.plexId,
                sourceId: ep.sourceId,
                sourceType: ep.sourceType,
                title: ep.title,
                filePath: ep.filePath,
                resolution: ep.resolution,
                videoCodec: ep.videoCodec,
                duration: ep.duration,
              },
            })
          }
        } else {
          resolvedItems.push({
            ...item,
            status: 'missing',
          })
        }
      } else {
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
        const isGenericTarget = /s\d+\s*e\d+|\d+x\d+/i.test(item.title) || targetEpTitleNorm === targetSeriesNorm
        if (candEpTitleNorm === targetEpTitleNorm) {
          score += 50
        } else if (candEpTitleNorm.length > 4 && (candEpTitleNorm.includes(targetEpTitleNorm) || targetEpTitleNorm.includes(candEpTitleNorm))) {
          score += 25
        } else if (score > 0 && !isGenericTarget) {
          // If specific custom episode titles exist and completely mismatch for the same S/E, penalize generic prefix overlap
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

  private parseSeasonRange(title: string): { startSeason?: number; endSeason?: number } {
    const match = title.match(/seasons?\s+(\d+)\s*[-–—]\s*(\d+)/i)
    if (match) {
      return { startSeason: parseInt(match[1], 10), endSeason: parseInt(match[2], 10) }
    }
    const single = title.match(/season\s+(\d+)/i)
    if (single) {
      const s = parseInt(single[1], 10)
      return { startSeason: s, endSeason: s }
    }
    return {}
  }

  private async findAllShowMatches(item: TimelineItem, sourceId?: string): Promise<Array<typeof schema.mediaItems.$inferSelect>> {
    const { tmdbId, tvdbId, imdbId } = item.identifiers
    const { startSeason, endSeason } = this.parseSeasonRange(item.title)

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

    const filterEpisodes = (rows: Array<typeof schema.mediaItems.$inferSelect>) => {
      let filtered = rows
      if (startSeason !== undefined && endSeason !== undefined) {
        filtered = filtered.filter(ep => ep.seasonNumber !== null && ep.seasonNumber >= startSeason && ep.seasonNumber <= endSeason)
      } else if (startSeason !== undefined) {
        filtered = filtered.filter(ep => ep.seasonNumber === startSeason)
      }
      return filtered.sort((a, b) => ((a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)) || ((a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)))
    }

    if (idConditions.length > 0) {
      const showWhere = and(eq(schema.mediaItems.type, 'episode'), or(...idConditions))
      if (sourceId) {
        const resSource = await this.db
          .select()
          .from(schema.mediaItems)
          .where(and(eq(schema.mediaItems.sourceId, sourceId), showWhere))
        if (resSource.length > 0) return filterEpisodes(resSource)
      }
      const resGlobal = await this.db
        .select()
        .from(schema.mediaItems)
        .where(showWhere)
      if (resGlobal.length > 0) return filterEpisodes(resGlobal)
    }

    // Tier 1.5: Check seriesCompleteness table by TMDB ID, TVDB ID, or title
    const targetSeriesNorm = normalizeMediaTitle(item.seriesTitle || item.title)
    const compConditions = []
    if (tmdbId) compConditions.push(eq(schema.seriesCompleteness.tmdbId, String(tmdbId)))
    if (tvdbId) compConditions.push(eq(schema.seriesCompleteness.tvdbId, String(tvdbId)))
    if (targetSeriesNorm) compConditions.push(eq(schema.seriesCompleteness.seriesTitle, item.seriesTitle || item.title))

    if (compConditions.length > 0) {
      const compRows = await this.db
        .select()
        .from(schema.seriesCompleteness)
        .where(or(...compConditions))

      for (const comp of compRows) {
        const epConditions = []
        if (comp.seriesIdentityKey) epConditions.push(eq(schema.mediaItems.seriesIdentityKey, comp.seriesIdentityKey))
        if (comp.seriesTitle) epConditions.push(eq(schema.mediaItems.seriesTitle, comp.seriesTitle))
        if (epConditions.length > 0) {
          const compEps = await this.db
            .select()
            .from(schema.mediaItems)
            .where(and(eq(schema.mediaItems.type, 'episode'), or(...epConditions)))
          if (compEps.length > 0) {
            if (sourceId) {
              const resSource = compEps.filter(e => e.sourceId === sourceId)
              if (resSource.length > 0) return filterEpisodes(resSource)
            }
            return filterEpisodes(compEps)
          }
        }
      }
    }

    // Tier 2: Match by normalized Series Title
    if (targetSeriesNorm) {
      const candidates = await this.db
        .select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.type, 'episode'))

      const matched = candidates.filter(cand => {
        const candSeriesNorm = cand.seriesTitle ? normalizeMediaTitle(cand.seriesTitle) : ''
        return candSeriesNorm === targetSeriesNorm || (candSeriesNorm.length > 4 && (candSeriesNorm.includes(targetSeriesNorm) || targetSeriesNorm.includes(candSeriesNorm)))
      })
      if (matched.length > 0) {
        if (sourceId) {
          const resSource = matched.filter(cand => cand.sourceId === sourceId)
          if (resSource.length > 0) return filterEpisodes(resSource)
        }
        return filterEpisodes(matched)
      }
    }

    return []
  }

  private async findShowMatch(item: TimelineItem, sourceId?: string): Promise<typeof schema.mediaItems.$inferSelect | null> {
    const all = await this.findAllShowMatches(item, sourceId)
    return all[0] || null
  }
}


