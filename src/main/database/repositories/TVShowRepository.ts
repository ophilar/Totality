import { eq, and, sql, asc, desc, like } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type {
  TVShowSummary,
  TVShowFilters,
  SeriesCompleteness,
  MediaItem,
} from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'
import { toSnakeCaseMediaItem } from '@main/database/utils/mappers'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { Client } from '@libsql/client'
import * as schema from '@main/database/drizzleSchema'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'
import { getMediaMatchStatus } from '@main/services/SeriesIdentityService'
import { IdentityRepository } from '@main/database/repositories/IdentityRepository'

export class TVShowRepository extends BaseRepository<typeof schema.seriesCompleteness> {
  private readonly identities: IdentityRepository
  constructor(db: Client, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'series_completeness', drizzle, schema.seriesCompleteness)
    this.identities = new IdentityRepository(db)
  }

  async getSummaries(
    filters?: TVShowFilters & { completenessFilter?: string }
  ): Promise<TVShowSummary[]> {
    const conditions = this.buildFilterConditions(filters)

    const sortMap: Record<string, AnyColumn | SQL> = {
      title: schema.seriesCompleteness.seriesTitle,
      completeness: schema.seriesCompleteness.completenessPercentage,
      episode_count: schema.seriesCompleteness.totalEpisodes,
      episodes: schema.seriesCompleteness.totalEpisodes,
      season_count: schema.seriesCompleteness.totalSeasons,
      storage_debt: schema.seriesCompleteness.storageDebtBytes,
      recoverable: schema.seriesCompleteness.storageDebtBytes,
      debt: schema.seriesCompleteness.storageDebtBytes,
      waste: schema.seriesCompleteness.storageDebtBytes,
      efficiency: schema.seriesCompleteness.efficiencyScore,
      size: schema.seriesCompleteness.totalSize,
    }
    const sortCol = sortMap[filters?.sortBy || 'title'] || schema.seriesCompleteness.seriesTitle
    const sortOrder = filters?.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol)

    const query = this.drizzle
      .select({
        id: schema.seriesCompleteness.id,
        series_title: schema.seriesCompleteness.seriesTitle,
        series_identity_key: schema.seriesCompleteness.seriesIdentityKey,
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
        tvdb_id: schema.seriesCompleteness.tvdbId,
        poster_url: schema.seriesCompleteness.posterUrl,
        backdrop_url: schema.seriesCompleteness.backdropUrl,
        status: schema.seriesCompleteness.status,
        user_fixed_match: schema.seriesCompleteness.userFixedMatch,
        efficiency_score: schema.seriesCompleteness.efficiencyScore,
        storage_debt_bytes: schema.seriesCompleteness.storageDebtBytes,
        total_size: schema.seriesCompleteness.totalSize,
        current_episodes: schema.seriesCompleteness.ownedEpisodes,
      })
      .from(schema.seriesCompleteness)

    if (conditions.length > 0) query.where(and(...conditions))
    query.orderBy(sortOrder)

    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    const summaries: TVShowSummary[] = []

    // Batch fetch conflicts in single query if there are rows with identities
    const seriesWithIds: {
      entityId: number
      identities: { provider: string; externalId: string }[]
    }[] = []
    for (const row of rows) {
      if (row.id && (row.tmdb_id || row.tvdb_id)) {
        const identities = []
        if (row.tmdb_id) identities.push({ provider: 'tmdb', externalId: String(row.tmdb_id) })
        if (row.tvdb_id) identities.push({ provider: 'tvdb', externalId: String(row.tvdb_id) })
        seriesWithIds.push({ entityId: row.id, identities })
      }
    }
    const conflictMap = await this.identities.getBatchConflictingEntityIds('series', seriesWithIds)

    for (const row of rows) {
      const canonicalIds: string[] = []
      if (row.tmdb_id) canonicalIds.push(row.tmdb_id)
      if (row.tvdb_id) canonicalIds.push(row.tvdb_id)

      const conflictingEntityIds = row.id ? conflictMap.get(row.id) || [] : []
      const totalRecoverable = row.storage_debt_bytes || 0
      const ownedCount = row.owned_episodes || 0
      const totalCount = row.total_episodes || 0

      summaries.push({
        ...row,
        poster_url: row.poster_url ?? undefined,
        episode_count: row.total_episodes,
        season_count: row.total_seasons,
        match_status: getMediaMatchStatus({
          locked: row.user_fixed_match === 1,
          canonicalIds,
          conflictingEntityIds,
        }),
        total_size: row.total_size || 0,
        total_recoverable_bytes: totalRecoverable,
        weighted_efficiency: row.efficiency_score || 0,
        scored_episode_count: ownedCount,
        unscored_episode_count: Math.max(0, totalCount - ownedCount),
        recommended_action: totalRecoverable > 0 ? 'review-required' : 'no-optimization',
      })
    }
    return summaries
  }

  async count(filters?: TVShowFilters & { completenessFilter?: string }): Promise<number> {
    const conditions = this.buildFilterConditions(filters)
    const query = this.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.seriesCompleteness)
    if (conditions.length > 0) query.where(and(...conditions))
    const res = await query.get()
    return res?.count || 0
  }

  private buildFilterConditions(filters?: TVShowFilters & { completenessFilter?: string }): SQL[] {
    const conditions: SQL[] = []
    if (filters?.sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, filters.sourceId))
    if (filters?.libraryId)
      conditions.push(eq(schema.seriesCompleteness.libraryId, filters.libraryId))
    if (filters?.searchQuery)
      conditions.push(like(schema.seriesCompleteness.seriesTitle, `%${filters.searchQuery}%`))

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`series_title NOT GLOB '[A-Za-z]*'`)
      else
        conditions.push(
          eq(sql`UPPER(SUBSTR(series_title, 1, 1))`, filters.alphabetFilter.toUpperCase())
        )
    }

    if (filters?.completenessFilter) {
      if (filters.completenessFilter === 'complete')
        conditions.push(sql`completeness_percentage >= 100`)
      else if (filters.completenessFilter === 'incomplete')
        conditions.push(sql`completeness_percentage < 100`)
    }

    if (filters?.slimDown) {
      conditions.push(
        sql`(${schema.seriesCompleteness.efficiencyScore} < 60 OR ${schema.seriesCompleteness.storageDebtBytes} > 5368709120)`
      )
    }

    if (filters?.qualityTier && filters.qualityTier !== 'all') {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM media_items m JOIN quality_scores q ON m.id = q.media_item_id WHERE m.type = 'episode' AND m.source_id = series_completeness.source_id AND m.series_identity_key = series_completeness.series_identity_key AND (UPPER(q.quality_tier) = UPPER(${filters.qualityTier}) OR UPPER(m.resolution) = UPPER(${filters.qualityTier})))`
      )
    }

    if (filters?.tierQuality && filters.tierQuality !== 'all') {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM media_items m JOIN quality_scores q ON m.id = q.media_item_id WHERE m.type = 'episode' AND m.source_id = series_completeness.source_id AND m.series_identity_key = series_completeness.series_identity_key AND UPPER(q.tier_quality) = UPPER(${filters.tierQuality}))`
      )
    }

    return conditions
  }

  async getEpisodes(
    seriesTitle: string,
    sourceId?: string,
    seriesIdentityKey?: string,
    libraryId?: string
  ): Promise<MediaItem[]> {
    const conditions = [eq(schema.mediaItems.type, 'episode')]
    if (seriesIdentityKey)
      conditions.push(eq(schema.mediaItems.seriesIdentityKey, seriesIdentityKey))
    else conditions.push(eq(schema.mediaItems.seriesTitle, seriesTitle))
    if (sourceId) conditions.push(eq(schema.mediaItems.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.mediaItems.libraryId, libraryId))

    const rows = await this.drizzle
      .select({
        item: schema.mediaItems,
        quality: schema.qualityScores,
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(and(...conditions))
      .orderBy(asc(schema.mediaItems.seasonNumber), asc(schema.mediaItems.episodeNumber))
      .all()

    return rows.map((r) => toSnakeCaseMediaItem(r))
  }

  async getCompletenessByTitle(
    title: string,
    sourceId?: string,
    libraryId?: string
  ): Promise<SeriesCompleteness | null> {
    const conditions = [eq(schema.seriesCompleteness.seriesTitle, title)]
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, libraryId))

    const row = await this.drizzle
      .select()
      .from(schema.seriesCompleteness)
      .where(and(...conditions))
      .get()
    return row ? this.mapDrizzleToCompleteness(row) : null
  }

  async upsertCompleteness(data: SeriesCompleteness): Promise<number> {
    const record = {
      seriesTitle: data.series_title,
      seriesIdentityKey:
        data.series_identity_key ||
        deriveSeriesIdentityKey({
          sourceId: data.source_id || '',
          libraryId: data.library_id || '',
          folderRelativePath: data.series_title,
          tmdbId: data.tmdb_id,
          tvdbId: data.tvdb_id,
        }),
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
      tvdbId: data.tvdb_id ?? null,
      posterUrl: data.poster_url ?? null,
      backdropUrl: data.backdrop_url ?? null,
      status: data.status ?? null,
      userFixedMatch: data.user_fixed_match ? 1 : 0,
      efficiencyScore: data.efficiency_score ?? null,
      storageDebtBytes: data.storage_debt_bytes ?? null,
      totalSize: data.total_size ?? null,
    }

    const conditions = [
      eq(schema.seriesCompleteness.sourceId, record.sourceId),
      eq(schema.seriesCompleteness.libraryId, record.libraryId),
      sql`(${schema.seriesCompleteness.seriesIdentityKey} = ${record.seriesIdentityKey}
           OR (${record.tmdbId} IS NOT NULL AND ${record.tmdbId} <> '' AND ${schema.seriesCompleteness.tmdbId} = ${record.tmdbId})
           OR (${record.tvdbId} IS NOT NULL AND ${record.tvdbId} <> '' AND ${schema.seriesCompleteness.tvdbId} = ${record.tvdbId}))`,
    ]

    const existing = await this.drizzle
      .select()
      .from(schema.seriesCompleteness)
      .where(and(...conditions))
      .get()

    let id: number
    if (existing) {
      id = existing.id
      await this.drizzle
        .update(schema.seriesCompleteness)
        .set({
          ...record,
          seriesTitle: existing.userFixedMatch === 1 ? existing.seriesTitle : record.seriesTitle,
          tmdbId:
            existing.userFixedMatch === 1 ? existing.tmdbId : record.tmdbId || existing.tmdbId,
          tvdbId:
            existing.userFixedMatch === 1 ? existing.tvdbId : record.tvdbId || existing.tvdbId,
          posterUrl:
            existing.userFixedMatch === 1
              ? existing.posterUrl
              : record.posterUrl || existing.posterUrl,
          userFixedMatch: existing.userFixedMatch === 1 ? 1 : record.userFixedMatch,
          updatedAt: sql`datetime('now')`,
        })
        .where(eq(schema.seriesCompleteness.id, existing.id))
    } else {
      id = await this.upsertWithProviderId(
        schema.seriesCompleteness,
        record,
        [
          schema.seriesCompleteness.seriesIdentityKey,
          schema.seriesCompleteness.sourceId,
          schema.seriesCompleteness.libraryId,
        ],
        {
          ...record,
          seriesTitle: sql`CASE WHEN user_fixed_match = 1 THEN series_title ELSE excluded.series_title END`,
          tmdbId: sql`CASE WHEN user_fixed_match = 1 THEN tmdb_id ELSE COALESCE(excluded.tmdb_id, series_completeness.tmdb_id) END`,
          tvdbId: sql`CASE WHEN user_fixed_match = 1 THEN tvdb_id ELSE COALESCE(excluded.tvdb_id, series_completeness.tvdb_id) END`,
          posterUrl: sql`CASE WHEN user_fixed_match = 1 THEN poster_url ELSE COALESCE(excluded.poster_url, series_completeness.poster_url) END`,
          userFixedMatch: sql`CASE WHEN user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END`,
        }
      )
    }

    if (
      !record.userFixedMatch &&
      (record.seriesIdentityKey.startsWith('tmdb:') || record.seriesIdentityKey.startsWith('tvdb:'))
    ) {
      await this.drizzle
        .delete(schema.seriesCompleteness)
        .where(
          and(
            eq(schema.seriesCompleteness.seriesTitle, record.seriesTitle),
            eq(schema.seriesCompleteness.sourceId, record.sourceId),
            eq(schema.seriesCompleteness.libraryId, record.libraryId),
            like(schema.seriesCompleteness.seriesIdentityKey, 'unresolved:%'),
            eq(schema.seriesCompleteness.userFixedMatch, 0)
          )
        )
    }

    return id
  }

  async getAllCompleteness(sourceId?: string, libraryId?: string): Promise<SeriesCompleteness[]> {
    const conditions = []
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, libraryId))

    const rows = await this.drizzle
      .select()
      .from(schema.seriesCompleteness)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.seriesCompleteness.seriesTitle))
      .all()

    return rows.map((r) => this.mapDrizzleToCompleteness(r))
  }

  async getIncomplete(sourceId?: string): Promise<SeriesCompleteness[]> {
    const conditions = [sql`completeness_percentage < 100`]
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))

    const rows = await this.drizzle
      .select()
      .from(schema.seriesCompleteness)
      .where(and(...conditions))
      .orderBy(asc(schema.seriesCompleteness.completenessPercentage))
      .all()

    return rows.map((r) => this.mapDrizzleToCompleteness(r))
  }

  async deleteCompleteness(id: number): Promise<void> {
    await this.drizzle.delete(schema.seriesCompleteness).where(eq(schema.seriesCompleteness.id, id))
  }

  private mapDrizzleToCompleteness(
    r: typeof schema.seriesCompleteness.$inferSelect
  ): SeriesCompleteness {
    return {
      id: r.id,
      series_title: r.seriesTitle,
      series_identity_key: r.seriesIdentityKey ?? undefined,
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
      tvdb_id: r.tvdbId || undefined,
      poster_url: r.posterUrl || undefined,
      backdrop_url: r.backdropUrl || undefined,
      status: r.status || undefined,
      efficiency_score: r.efficiencyScore ?? undefined,
      storage_debt_bytes: r.storageDebtBytes ?? undefined,
      total_size: r.totalSize ?? undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }
  }
}
