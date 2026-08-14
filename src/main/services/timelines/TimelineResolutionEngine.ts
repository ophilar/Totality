import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { eq, and, or } from 'drizzle-orm'
import * as schema from '@main/database/drizzleSchema'
import type { TimelineDefinition, TimelineItem, TimelineItemIdentifiers } from './ITimelineRecipeProvider'

export interface ResolvedTimelineItem {
  order: number
  type: 'movie' | 'episode'
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
    const { tmdbId, tvdbId, imdbId } = item.identifiers

    if (item.type === 'movie') {
      const idConditions = []
      if (tmdbId) idConditions.push(eq(schema.mediaItems.tmdbId, String(tmdbId)))
      if (imdbId) idConditions.push(eq(schema.mediaItems.imdbId, imdbId))

      if (idConditions.length === 0) return null

      const whereClause = and(
        eq(schema.mediaItems.type, 'movie'),
        sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined,
        or(...idConditions)
      )

      const results = await this.db.select().from(schema.mediaItems).where(whereClause).limit(1)
      return results[0] ?? null
    }

    if (item.type === 'episode') {
      if (item.seasonNumber === undefined || item.episodeNumber === undefined) {
        return null
      }

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
      }

      if (idConditions.length === 0) return null

      const whereClause = and(
        eq(schema.mediaItems.type, 'episode'),
        eq(schema.mediaItems.seasonNumber, item.seasonNumber),
        eq(schema.mediaItems.episodeNumber, item.episodeNumber),
        sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined,
        or(...idConditions)
      )

      const results = await this.db.select().from(schema.mediaItems).where(whereClause).limit(1)
      return results[0] ?? null
    }

    return null
  }
}
