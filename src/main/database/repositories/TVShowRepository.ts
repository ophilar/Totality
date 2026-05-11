import { eq, and, sql, asc, desc, like } from 'drizzle-orm'
import type { TVShowSummary, TVShowFilters, SeriesCompleteness, MediaItem } from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'

export class TVShowRepository extends BaseRepository<typeof schema.seriesCompleteness> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'series_completeness', drizzle, schema.seriesCompleteness)
  }

  async getSummaries(filters?: TVShowFilters & { completenessFilter?: string }): Promise<TVShowSummary[]> {
    const conditions = []
    if (filters?.sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, filters.libraryId))
    if (filters?.searchQuery) conditions.push(like(schema.seriesCompleteness.seriesTitle, `%${filters.searchQuery}%`))
    
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`series_title NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(series_title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }
    
    if (filters?.completenessFilter) {
      if (filters.completenessFilter === 'complete') conditions.push(sql`completeness_percentage >= 100`)
      else if (filters.completenessFilter === 'incomplete') conditions.push(sql`completeness_percentage < 100`)
    }

    const sortMap: any = {
      'title': schema.seriesCompleteness.seriesTitle,
      'completeness': schema.seriesCompleteness.completenessPercentage,
      'episodes': schema.seriesCompleteness.totalEpisodes,
      'debt': schema.seriesCompleteness.storageDebtBytes,
      'efficiency': schema.seriesCompleteness.efficiencyScore
    }
    const sortCol = sortMap[filters?.sortBy || 'title'] || schema.seriesCompleteness.seriesTitle
    const sortOrder = filters?.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol)

    const query = this.drizzle.select({
      id: schema.seriesCompleteness.id,
      series_title: schema.seriesCompleteness.seriesTitle,
      source_id: schema.seriesCompleteness.sourceId,
      library_id: schema.seriesCompleteness.libraryId,
      total_seasons: schema.seriesCompleteness.totalSeasons,
      total_episodes: schema.seriesCompleteness.totalEpisodes,
      owned_seasons: schema.seriesCompleteness.ownedSeasons,
      owned_episodes: schema.seriesCompleteness.ownedEpisodes,
      missing_seasons: schema.seriesCompleteness.missingSeasons,
      missing_episodes: schema.seriesCompleteness.missingEpisodes,
      completeness_percentage: schema.seriesCompleteness.completenessPercentage,
      tmdb_id: schema.seriesCompleteness.tmdbId,
      poster_url: schema.seriesCompleteness.posterUrl,
      backdrop_url: schema.seriesCompleteness.backdropUrl,
      status: schema.seriesCompleteness.status,
      efficiency_score: schema.seriesCompleteness.efficiencyScore,
      storage_debt_bytes: schema.seriesCompleteness.storageDebtBytes,
      total_size: schema.seriesCompleteness.totalSize,
      current_episodes: sql<number>`(SELECT COUNT(*) FROM media_items m WHERE m.series_title = series_completeness.series_title AND m.type = 'episode' AND m.source_id = series_completeness.source_id)`
    })
    .from(schema.seriesCompleteness)

    if (conditions.length > 0) query.where(and(...conditions))
    query.orderBy(sortOrder)

    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    return rows as unknown as TVShowSummary[]
  }

  async count(filters?: TVShowFilters): Promise<number> {
    const conditions = []
    if (filters?.sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, filters.libraryId))
    if (filters?.searchQuery) conditions.push(like(schema.seriesCompleteness.seriesTitle, `%${filters.searchQuery}%`))
    
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`series_title NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(series_title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }

    const query = this.drizzle.select({ count: sql<number>`count(*)` }).from(schema.seriesCompleteness)
    if (conditions.length > 0) query.where(and(...conditions))
    const res = await query.get()
    return res?.count || 0
  }

  async getEpisodes(seriesTitle: string, sourceId?: string): Promise<MediaItem[]> {
    const conditions = [
      eq(schema.mediaItems.seriesTitle, seriesTitle),
      eq(schema.mediaItems.type, 'episode')
    ]
    if (sourceId) conditions.push(eq(schema.mediaItems.sourceId, sourceId))

    const rows = await this.drizzle.select({
      item: schema.mediaItems,
      quality: schema.qualityScores
    })
    .from(schema.mediaItems)
    .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
    .where(and(...conditions))
    .orderBy(asc(schema.mediaItems.seasonNumber), asc(schema.mediaItems.episodeNumber))
    .all()

    // Map using shared logic if possible, but for now reuse MediaRepository pattern
    return rows.map(r => {
      const item = r.item;
      const q = r.quality || {};
      return {
        ...item,
        source_id: item.sourceId,
        source_type: item.sourceType,
        library_id: item.libraryId,
        plex_id: item.plexId,
        series_title: item.seriesTitle,
        season_number: item.seasonNumber,
        episode_number: item.episodeNumber,
        file_path: item.filePath,
        file_size: item.fileSize,
        video_codec: item.videoCodec,
        video_bitrate: item.videoBitrate,
        audio_codec: item.audioCodec,
        audio_channels: item.audioChannels,
        audio_bitrate: item.audioBitrate,
        video_frame_rate: item.videoFrameRate,
        color_bit_depth: item.colorBitDepth,
        hdr_format: item.hdrFormat,
        has_object_audio: item.hasObjectAudio === 1,
        user_fixed_match: item.userFixedMatch === 1,
        poster_url: item.posterUrl,
        episode_thumb_url: item.episodeThumbUrl,
        season_poster_url: item.seasonPosterUrl,
        quality_tier: (q as any).qualityTier || item.qualityTier,
        tier_quality: (q as any).tierQuality || item.tierQuality,
        tier_score: (q as any).tierScore || item.tierScore,
        efficiency_score: (q as any).efficiencyScore || item.efficiencyScore,
        storage_debt_bytes: (q as any).storageDebtBytes || item.storageDebtBytes
      }
    }) as any[]
  }

  async getCompletenessByTitle(title: string, sourceId?: string, libraryId?: string): Promise<SeriesCompleteness | null> {
    const conditions = [eq(schema.seriesCompleteness.seriesTitle, title)]
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, libraryId))

    const row = await this.drizzle.select().from(schema.seriesCompleteness).where(and(...conditions)).get()
    return row ? this.mapDrizzleToCompleteness(row) : null
  }

  async upsertCompleteness(data: SeriesCompleteness): Promise<number> {
    const result = await this.drizzle.insert(schema.seriesCompleteness)
      .values({
        seriesTitle: data.series_title,
        sourceId: data.source_id || '',
        libraryId: data.library_id || '',
        totalSeasons: data.total_seasons,
        totalEpisodes: data.total_episodes,
        ownedSeasons: data.owned_seasons,
        ownedEpisodes: data.owned_episodes,
        missingSeasons: data.missing_seasons || '[]',
        missingEpisodes: data.missing_episodes || '[]',
        completenessPercentage: data.completeness_percentage,
        tmdbId: data.tmdb_id ?? null,
        posterUrl: data.poster_url ?? null,
        backdropUrl: data.backdrop_url ?? null,
        status: data.status ?? null,
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .onConflictDoUpdate({
        target: [schema.seriesCompleteness.seriesTitle, schema.seriesCompleteness.sourceId, schema.seriesCompleteness.libraryId],
        set: {
          totalSeasons: data.total_seasons,
          totalEpisodes: data.total_episodes,
          ownedSeasons: data.owned_seasons,
          ownedEpisodes: data.owned_episodes,
          missingSeasons: data.missing_seasons || '[]',
          missingEpisodes: data.missing_episodes || '[]',
          completenessPercentage: data.completeness_percentage,
          tmdbId: sql`COALESCE(excluded.tmdb_id, series_completeness.tmdb_id)`,
          posterUrl: sql`COALESCE(excluded.poster_url, series_completeness.poster_url)`,
          backdropUrl: sql`COALESCE(excluded.backdrop_url, series_completeness.backdrop_url)`,
          status: sql`COALESCE(excluded.status, series_completeness.status)`,
          updatedAt: sql`(datetime('now'))`
        }
      })
      .returning({ id: schema.seriesCompleteness.id })

    return result[0]?.id || 0
  }

  async getAllCompleteness(sourceId?: string, libraryId?: string): Promise<SeriesCompleteness[]> {
    const conditions = []
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, libraryId))

    const rows = await this.drizzle.select()
      .from(schema.seriesCompleteness)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.seriesCompleteness.seriesTitle))
      .all()
    
    return rows.map(r => this.mapDrizzleToCompleteness(r))
  }

  async getIncomplete(sourceId?: string): Promise<SeriesCompleteness[]> {
    const conditions = [sql`completeness_percentage < 100`]
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))

    const rows = await this.drizzle.select()
      .from(schema.seriesCompleteness)
      .where(and(...conditions))
      .orderBy(asc(schema.seriesCompleteness.completenessPercentage))
      .all()
    
    return rows.map(r => this.mapDrizzleToCompleteness(r))
  }

  async deleteCompleteness(id: number): Promise<void> {
    await this.drizzle.delete(schema.seriesCompleteness).where(eq(schema.seriesCompleteness.id, id))
  }

  private mapDrizzleToCompleteness(r: any): SeriesCompleteness {
    return {
      id: r.id,
      series_title: r.seriesTitle,
      source_id: r.sourceId,
      library_id: r.libraryId,
      total_seasons: r.totalSeasons,
      total_episodes: r.totalEpisodes,
      owned_seasons: r.ownedSeasons,
      owned_episodes: r.ownedEpisodes,
      missing_seasons: r.missingSeasons,
      missing_episodes: r.missingEpisodes,
      completeness_percentage: r.completenessPercentage,
      tmdb_id: r.tmdbId || undefined,
      poster_url: r.posterUrl || undefined,
      backdrop_url: r.backdropUrl || undefined,
      status: r.status || undefined,
      efficiency_score: r.efficiencyScore,
      storage_debt_bytes: r.storageDebtBytes,
      total_size: r.totalSize,
      created_at: r.createdAt,
      updated_at: r.updatedAt
    }
  }
}
