import { eq, and, sql, asc, desc, like } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { TVShowSummary, TVShowFilters, SeriesCompleteness, MediaItem, OptimizationMetricsSummary, CalculationStatus } from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'
import { toSnakeCaseMediaItem } from '@main/database/utils/mappers'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { Client } from '@libsql/client'
import * as schema from '@main/database/drizzleSchema'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'
import { getMediaMatchStatus } from '@main/services/SeriesIdentityService'
import { IdentityRepository } from '@main/database/repositories/IdentityRepository'
import { getFileNameParser } from '@main/services/FileNameParser'
import { getLoggingService } from '@main/services/LoggingService'
import { getErrorMessage } from '@main/services/utils/errorUtils'

export class TVShowRepository extends BaseRepository<typeof schema.seriesCompleteness> {
  private readonly identities: IdentityRepository
  constructor(db: Client, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'series_completeness', drizzle, schema.seriesCompleteness)
    this.identities = new IdentityRepository(db)
  }

  async getSummaries(filters?: TVShowFilters & { completenessFilter?: string }): Promise<TVShowSummary[]> {
    const conditions = this.buildFilterConditions(filters)

    const episodeAggregates = this.drizzle.select({
      seriesTitle: schema.mediaItems.seriesTitle,
      seriesIdentityKey: schema.mediaItems.seriesIdentityKey,
      sourceId: schema.mediaItems.sourceId,
      libraryId: schema.mediaItems.libraryId,
      totalSize: sql<number>`SUM(COALESCE(${schema.mediaItems.fileSize}, 0))`.as('aggregate_total_size'),
      storageDebtBytes: sql<number | null>`CASE WHEN COUNT(${schema.mediaItems.id}) > 0 AND COUNT(CASE WHEN ${schema.qualityScores.storageDebtBytes} IS NOT NULL THEN 1 END) = COUNT(${schema.mediaItems.id}) THEN SUM(${schema.qualityScores.storageDebtBytes}) ELSE NULL END`.as('aggregate_storage_debt_bytes'),
      weightedEfficiency: sql<number | null>`SUM(CASE WHEN ${schema.qualityScores.efficiencyScore} IS NOT NULL THEN ${schema.qualityScores.efficiencyScore} * COALESCE(${schema.mediaItems.fileSize}, 1) ELSE 0 END) / NULLIF(SUM(CASE WHEN ${schema.qualityScores.efficiencyScore} IS NOT NULL THEN COALESCE(${schema.mediaItems.fileSize}, 1) ELSE 0 END), 0)`.as('aggregate_efficiency'),
      ownedCount: sql<number>`COUNT(${schema.mediaItems.id})`.as('aggregate_owned_count'),
      seasonCount: sql<number>`COUNT(DISTINCT CASE WHEN ${schema.mediaItems.seasonNumber} > 0 THEN ${schema.mediaItems.seasonNumber} END)`.as('aggregate_season_count'),
      regularEpisodeCount: sql<number>`COUNT(DISTINCT CASE WHEN ${schema.mediaItems.seasonNumber} > 0 AND ${schema.mediaItems.episodeNumber} IS NOT NULL THEN ${schema.mediaItems.seasonNumber} || ':' || ${schema.mediaItems.episodeNumber} END)`.as('aggregate_regular_episode_count'),
      specialEpisodeCount: sql<number>`COUNT(CASE WHEN ${schema.mediaItems.seasonNumber} = 0 THEN 1 END)`.as('aggregate_special_episode_count'),
      scoredCount: sql<number>`COUNT(${schema.qualityScores.efficiencyScore})`.as('aggregate_scored_count'),
      measuredDebtCount: sql<number>`COUNT(CASE WHEN ${schema.qualityScores.evidenceStatus} = 'measured' AND ${schema.qualityScores.storageDebtBytes} IS NOT NULL THEN 1 END)`.as('aggregate_measured_debt_count')
    }).from(schema.mediaItems).leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(eq(schema.mediaItems.type, 'episode'))
      .groupBy(schema.mediaItems.seriesTitle, schema.mediaItems.seriesIdentityKey, schema.mediaItems.sourceId, schema.mediaItems.libraryId)
      .as('episode_aggregates')

    const sortMap: Record<string, AnyColumn | SQL | SQL.Aliased> = {
      'title': schema.seriesCompleteness.seriesTitle,
      'completeness': schema.seriesCompleteness.completenessPercentage,
      'episode_count': schema.seriesCompleteness.totalEpisodes,
      'episodes': schema.seriesCompleteness.totalEpisodes,
      'season_count': schema.seriesCompleteness.totalSeasons,
      'storage_debt': sql`COALESCE(${episodeAggregates.storageDebtBytes}, ${schema.seriesCompleteness.storageDebtBytes})`,
      'storage_debt_bytes': sql`COALESCE(${episodeAggregates.storageDebtBytes}, ${schema.seriesCompleteness.storageDebtBytes})`,
      'recoverable': sql`COALESCE(${episodeAggregates.storageDebtBytes}, ${schema.seriesCompleteness.storageDebtBytes})`,
      'recoverable_waste_bytes': sql`COALESCE(${episodeAggregates.storageDebtBytes}, ${schema.seriesCompleteness.storageDebtBytes})`,
      'debt': sql`COALESCE(${episodeAggregates.storageDebtBytes}, ${schema.seriesCompleteness.storageDebtBytes})`,
      'waste': sql`COALESCE(${episodeAggregates.storageDebtBytes}, ${schema.seriesCompleteness.storageDebtBytes})`,
      'efficiency': sql`COALESCE(${episodeAggregates.weightedEfficiency}, ${schema.seriesCompleteness.efficiencyScore})`,
      'efficiency_score': sql`COALESCE(${episodeAggregates.weightedEfficiency}, ${schema.seriesCompleteness.efficiencyScore})`,
      'weighted_efficiency': sql`COALESCE(${episodeAggregates.weightedEfficiency}, ${schema.seriesCompleteness.efficiencyScore})`,
      'size': sql`COALESCE(${episodeAggregates.totalSize}, ${schema.seriesCompleteness.totalSize})`,
    }
    const sortCol = sortMap[filters?.sortBy || 'title'] || schema.seriesCompleteness.seriesTitle
    const sortOrder = filters?.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol)

    const query = this.drizzle.select({
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
      evidence_status: schema.seriesCompleteness.evidenceStatus,
      confidence: schema.seriesCompleteness.confidence,
      savings_basis: schema.seriesCompleteness.savingsBasis,
      total_size: schema.seriesCompleteness.totalSize,
      current_episodes: schema.seriesCompleteness.ownedEpisodes,
      aggregate_total_size: episodeAggregates.totalSize,
      aggregate_storage_debt_bytes: episodeAggregates.storageDebtBytes,
      aggregate_efficiency: episodeAggregates.weightedEfficiency,
      aggregate_owned_count: episodeAggregates.ownedCount,
      aggregate_season_count: episodeAggregates.seasonCount,
      aggregate_regular_episode_count: episodeAggregates.regularEpisodeCount,
      aggregate_special_episode_count: episodeAggregates.specialEpisodeCount,
      aggregate_scored_count: episodeAggregates.scoredCount,
      aggregate_measured_debt_count: episodeAggregates.measuredDebtCount
    })
    .from(schema.seriesCompleteness)
    .leftJoin(episodeAggregates, sql`
      ${episodeAggregates.sourceId} IS ${schema.seriesCompleteness.sourceId}
      AND ${episodeAggregates.libraryId} IS ${schema.seriesCompleteness.libraryId}
      AND (
        (${schema.seriesCompleteness.seriesIdentityKey} IS NOT NULL
          AND ${episodeAggregates.seriesIdentityKey} IS ${schema.seriesCompleteness.seriesIdentityKey})
        OR
        (${schema.seriesCompleteness.seriesIdentityKey} IS NULL
          AND ${episodeAggregates.seriesIdentityKey} IS NULL
          AND ${episodeAggregates.seriesTitle} IS ${schema.seriesCompleteness.seriesTitle})
      )
    `)

    if (conditions.length > 0) query.where(and(...conditions))
    query.orderBy(sortOrder, asc(schema.seriesCompleteness.id))
    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    const summaries: TVShowSummary[] = []

    const seriesWithIds = rows
      .filter((r) => r.id && (r.tmdb_id || r.tvdb_id))
      .map((row) => ({
        entityId: row.id!,
        identities: [
          row.tmdb_id ? { provider: 'tmdb', externalId: String(row.tmdb_id) } : null,
          row.tvdb_id ? { provider: 'tvdb', externalId: String(row.tvdb_id) } : null,
        ].filter((value): value is { provider: string; externalId: string } => value !== null),
      }))
    const conflictMap = await this.identities.getBatchConflictingEntityIds('series', seriesWithIds)

    const seriesTitles = rows
      .map((r) => r.series_title)
      .filter(Boolean)

    const aggregatedScoresMap = new Map<string, {
      totalSize: number
      storageDebtBytes: number | null
      weightedEfficiency: number | null
      scoredCount: number
      ownedCount: number
      seasonCount: number
      regularEpisodeCount: number
      specialEpisodeCount: number
      evidenceStatus: 'measured' | 'estimated' | undefined
    }>()

    if (seriesTitles.length > 0) {
      const aggregateConditions: SQL[] = [
        eq(schema.mediaItems.type, 'episode'),
        sql`${schema.mediaItems.seriesTitle} IN (${sql.join(seriesTitles.map(t => sql`${t}`), sql`, `)})`
      ]
      if (filters?.sourceId) aggregateConditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
      if (filters?.libraryId) aggregateConditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))

      const aggRows = await this.drizzle.select({
        seriesTitle: schema.mediaItems.seriesTitle,
        seriesIdentityKey: schema.mediaItems.seriesIdentityKey,
        sourceId: schema.mediaItems.sourceId,
        libraryId: schema.mediaItems.libraryId,
        totalSize: sql<number>`SUM(COALESCE(${schema.mediaItems.fileSize}, 0))`,
        storageDebtBytes: sql<number | null>`SUM(CASE WHEN ${schema.qualityScores.storageDebtBytes} IS NOT NULL THEN ${schema.qualityScores.storageDebtBytes} ELSE NULL END)`,
        measuredDebtCount: sql<number>`COUNT(CASE WHEN ${schema.qualityScores.storageDebtBytes} IS NOT NULL THEN 1 END)`,
        genuinelyMeasuredDebtCount: sql<number>`COUNT(CASE WHEN ${schema.qualityScores.evidenceStatus} = 'measured' AND ${schema.qualityScores.storageDebtBytes} IS NOT NULL THEN 1 END)`,
        scoredCount: sql<number>`COUNT(${schema.qualityScores.efficiencyScore})`,
        ownedCount: sql<number>`COUNT(${schema.mediaItems.id})`,
        seasonCount: sql<number>`COUNT(DISTINCT CASE WHEN ${schema.mediaItems.seasonNumber} IS NOT NULL AND ${schema.mediaItems.seasonNumber} > 0 THEN ${schema.mediaItems.seasonNumber} END)`,
        regularEpisodeCount: sql<number>`COUNT(DISTINCT CASE WHEN ${schema.mediaItems.seasonNumber} > 0 AND ${schema.mediaItems.episodeNumber} IS NOT NULL THEN ${schema.mediaItems.seasonNumber} || ':' || ${schema.mediaItems.episodeNumber} END)`,
        specialEpisodeCount: sql<number>`COUNT(CASE WHEN ${schema.mediaItems.seasonNumber} = 0 THEN 1 END)`,
        weightedEfficiency: sql<number>`SUM(CASE WHEN ${schema.qualityScores.efficiencyScore} IS NOT NULL THEN ${schema.qualityScores.efficiencyScore} * COALESCE(${schema.mediaItems.fileSize}, 1) ELSE 0 END) / NULLIF(SUM(CASE WHEN ${schema.qualityScores.efficiencyScore} IS NOT NULL THEN COALESCE(${schema.mediaItems.fileSize}, 1) ELSE 0 END), 0)`
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(and(...aggregateConditions))
      .groupBy(schema.mediaItems.seriesIdentityKey, schema.mediaItems.seriesTitle, schema.mediaItems.sourceId, schema.mediaItems.libraryId)
      .all()

      for (const agg of aggRows) {
        if (!agg.seriesTitle) continue
        const ownedCount = Number(agg.ownedCount) || 0
        const measuredDebtCount = Number(agg.measuredDebtCount) || 0
        const aggData = {
          totalSize: Number(agg.totalSize) || 0,
          storageDebtBytes: measuredDebtCount === ownedCount && agg.storageDebtBytes !== null
            ? Number(agg.storageDebtBytes)
            : null,
          weightedEfficiency: agg.weightedEfficiency != null ? Math.round(Number(agg.weightedEfficiency)) : null,
          scoredCount: Number(agg.scoredCount) || 0,
          ownedCount,
          seasonCount: Number(agg.seasonCount) || 0
          , regularEpisodeCount: Number(agg.regularEpisodeCount) || 0
          , specialEpisodeCount: Number(agg.specialEpisodeCount) || 0
          , evidenceStatus: measuredDebtCount === ownedCount && Number(agg.storageDebtBytes) >= 0
            ? (Number(agg.genuinelyMeasuredDebtCount) === ownedCount ? 'measured' as const : 'estimated' as const)
            : undefined
        }
        if (agg.seriesIdentityKey) {
          aggregatedScoresMap.set(`${agg.seriesIdentityKey}:${agg.sourceId}:${agg.libraryId}`, aggData)
        } else {
          aggregatedScoresMap.set(`${agg.seriesTitle}:${agg.sourceId}:${agg.libraryId}`, aggData)
        }
      }
    }

    for (const row of rows) {
      const canonicalIds = [row.tmdb_id, row.tvdb_id].filter((value): value is string => Boolean(value))
      const conflictingEntityIds = row.id ? (conflictMap.get(row.id) || []) : []
      const aggregate = (row.series_identity_key
        ? aggregatedScoresMap.get(`${row.series_identity_key}:${row.source_id}:${row.library_id}`)
        : (row.series_title ? aggregatedScoresMap.get(`${row.series_title}:${row.source_id}:${row.library_id}`) : undefined))
        ?? (row.aggregate_owned_count != null ? {
          totalSize: Number(row.aggregate_total_size) || 0,
          storageDebtBytes: row.aggregate_storage_debt_bytes == null ? null : Number(row.aggregate_storage_debt_bytes),
          weightedEfficiency: row.aggregate_efficiency == null ? null : Math.round(Number(row.aggregate_efficiency)),
          scoredCount: Number(row.aggregate_scored_count) || 0,
          ownedCount: Number(row.aggregate_owned_count) || 0,
          seasonCount: Number(row.aggregate_season_count) || 0,
          regularEpisodeCount: Number(row.aggregate_regular_episode_count) || 0,
          specialEpisodeCount: Number(row.aggregate_special_episode_count) || 0,
          evidenceStatus: undefined,
        } : undefined)
      const hasEpisodeAggregate = aggregate !== undefined && aggregate.ownedCount > 0

      const totalSize = hasEpisodeAggregate ? aggregate.totalSize : (row.total_size ?? 0)
      const totalRecoverable = hasEpisodeAggregate
        ? (aggregate.storageDebtBytes ?? undefined)
        : (row.evidence_status === 'measured' && row.storage_debt_bytes != null ? row.storage_debt_bytes : undefined)
      const weightedEfficiency = hasEpisodeAggregate
        ? aggregate.weightedEfficiency
        : (row.efficiency_score ?? null)
      const aggregateEvidenceStatus = hasEpisodeAggregate ? aggregate.evidenceStatus : row.evidence_status as TVShowSummary['evidence_status']
      const ownedCount = hasEpisodeAggregate ? aggregate.ownedCount : (row.owned_episodes || 0)
      const totalCount = row.total_episodes || ownedCount
      const scoredCount = hasEpisodeAggregate
        ? aggregate.scoredCount
        : (row.efficiency_score != null ? ownedCount : 0)
      const unscoredCount = Math.max(0, totalCount - scoredCount)
      const seasonCount = (row.total_seasons && row.total_seasons > 0)
        ? row.total_seasons
        : ((row.owned_seasons && row.owned_seasons > 0)
          ? row.owned_seasons
          : (hasEpisodeAggregate ? aggregate.seasonCount : 0))
      const ownedSeasons = (row.owned_seasons && row.owned_seasons > 0)
        ? row.owned_seasons
        : (hasEpisodeAggregate ? aggregate.seasonCount : 0)

      summaries.push({
        ...row,
        evidence_status: aggregateEvidenceStatus,
        confidence: row.confidence as TVShowSummary['confidence'],
        savings_basis: row.savings_basis as TVShowSummary['savings_basis'],
        poster_url: row.poster_url ?? undefined,
        episode_count: totalCount,
        season_count: seasonCount,
        total_seasons: seasonCount,
        total_episodes: totalCount,
        owned_seasons: ownedSeasons,
        owned_episodes: ownedCount,
        owned_regular_seasons: hasEpisodeAggregate ? aggregate.seasonCount : row.owned_seasons,
        total_regular_seasons: row.total_seasons > 0 ? row.total_seasons : null,
        owned_regular_episodes: hasEpisodeAggregate ? aggregate.regularEpisodeCount : row.owned_episodes,
        total_regular_episodes: row.total_episodes > 0 ? row.total_episodes : null,
        special_episode_count: hasEpisodeAggregate ? aggregate.specialEpisodeCount : 0,
        match_status: getMediaMatchStatus({ locked: row.user_fixed_match === 1, canonicalIds, conflictingEntityIds }),
        total_size: totalSize,
        total_recoverable_bytes: totalRecoverable,
        weighted_efficiency: weightedEfficiency,
        scored_episode_count: scoredCount,
        unscored_episode_count: unscoredCount,
        recommended_action: totalRecoverable === undefined
          ? undefined
          : totalRecoverable > 0
            ? 'review-required'
            : 'no-optimization'
      })
    }
    return summaries
  }

  async getOptimizationMetricsSummary(
    filters?: TVShowFilters & { completenessFilter?: string }
  ): Promise<OptimizationMetricsSummary> {
    const summaries = await this.getSummaries(filters)
    const totalCount = summaries.length
    if (totalCount === 0) {
      return {
        status: 'unknown',
        calculationStatus: 'unavailable',
        knownCount: 0,
        totalCount: 0,
        efficiency: null,
        overallEfficiencyScore: null,
        recoverableBytes: null,
        recoverableWasteBytes: null,
        wasteBytes: null,
        totalStorageDebtBytes: null,
        savingsBasis: null,
        evidenceStatus: 'insufficient',
        confidence: 'low',
        confidenceScore: 0,
      }
    }

    let knownCount = 0
    let weightedEfficiencySum = 0
    let weightedSizeSum = 0
    let totalStorageDebtBytes = 0
    let hasAnyDebt = false

    let unweightedEfficiencySum = 0

    for (const s of summaries) {
      if (s.weighted_efficiency != null) {
        knownCount++
        unweightedEfficiencySum += s.weighted_efficiency
        if (s.total_size != null && s.total_size > 0) {
          weightedEfficiencySum += s.weighted_efficiency * s.total_size
          weightedSizeSum += s.total_size
        }
      }
      if (s.total_recoverable_bytes != null) {
        totalStorageDebtBytes += s.total_recoverable_bytes
        hasAnyDebt = true
      }
    }

    let status: CalculationStatus = 'unknown'
    let calculationStatus: CalculationStatus = 'unavailable'
    if (totalCount > 0 && knownCount === totalCount) {
      status = 'complete'
      calculationStatus = 'measured'
    } else if (knownCount > 0) {
      status = 'partial'
      calculationStatus = 'estimated'
    }

    const overallEfficiencyScore = knownCount > 0
      ? Math.round(weightedSizeSum > 0 ? weightedEfficiencySum / weightedSizeSum : unweightedEfficiencySum / knownCount)
      : null

    const recoverableWasteBytes = hasAnyDebt ? totalStorageDebtBytes : null
    const confidenceScore = totalCount > 0 ? Math.round((knownCount / totalCount) * 100) : 0

    return {
      status,
      calculationStatus,
      knownCount,
      totalCount,
      efficiency: overallEfficiencyScore,
      overallEfficiencyScore,
      recoverableBytes: recoverableWasteBytes,
      recoverableWasteBytes,
      wasteBytes: recoverableWasteBytes,
      totalStorageDebtBytes: recoverableWasteBytes,
      savingsBasis: hasAnyDebt ? 'measured' : null,
      evidenceStatus: hasAnyDebt ? 'measured' : 'insufficient',
      confidence: confidenceScore >= 80 ? 'high' : confidenceScore >= 40 ? 'medium' : 'low',
      confidenceScore,
    }
  }

  async count(filters?: TVShowFilters & { completenessFilter?: string }): Promise<number> {
    const conditions = this.buildFilterConditions(filters)
    const query = this.drizzle.select({ count: sql<number>`count(*)` }).from(schema.seriesCompleteness)
    if (conditions.length > 0) query.where(and(...conditions))
    const res = await query.get()
    return res?.count || 0
  }

  private buildFilterConditions(filters?: TVShowFilters & { completenessFilter?: string }): SQL[] {
    const conditions: SQL[] = []
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

    if (filters?.slimDown) {
      conditions.push(sql`(${schema.seriesCompleteness.efficiencyScore} < 60 OR ${schema.seriesCompleteness.storageDebtBytes} > 5368709120)`)
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

  async getEpisodes(seriesTitle: string, sourceId?: string, seriesIdentityKey?: string, libraryId?: string): Promise<MediaItem[]> {
    const conditions = [eq(schema.mediaItems.type, 'episode')]
    if (seriesIdentityKey) conditions.push(eq(schema.mediaItems.seriesIdentityKey, seriesIdentityKey))
    else conditions.push(eq(schema.mediaItems.seriesTitle, seriesTitle))
    if (sourceId) conditions.push(eq(schema.mediaItems.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.mediaItems.libraryId, libraryId))

    const rows = await this.drizzle.select({
      item: schema.mediaItems,
      quality: schema.qualityScores
    })
    .from(schema.mediaItems)
    .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
    .where(and(...conditions))
    .orderBy(asc(schema.mediaItems.seasonNumber), asc(schema.mediaItems.episodeNumber))
    .all()

    return rows.map(r => toSnakeCaseMediaItem(r))
  }

  async getCompletenessByTitle(title: string, sourceId?: string, libraryId?: string): Promise<SeriesCompleteness | null> {
    const conditions = [eq(schema.seriesCompleteness.seriesTitle, title)]
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, libraryId))

    const row = await this.drizzle.select().from(schema.seriesCompleteness).where(and(...conditions)).get()
    return row ? this.mapDrizzleToCompleteness(row) : null
  }

  async upsertCompleteness(data: SeriesCompleteness): Promise<number> {
    const record = {
      seriesTitle: data.series_title,
      seriesIdentityKey: data.series_identity_key || deriveSeriesIdentityKey({ sourceId: data.source_id || '', libraryId: data.library_id || '', folderRelativePath: data.series_title, tmdbId: data.tmdb_id, tvdbId: data.tvdb_id }),
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
      evidenceStatus: data.evidence_status,
      confidence: data.confidence,
      savingsBasis: data.savings_basis,
      totalSize: data.total_size ?? null,
    }

    const parser = getFileNameParser()
    const clean = parser.cleanSeriesTitleAndYear(record.seriesTitle)
    const normTitle = parser.normalizeSeriesTitle(record.seriesTitle)
    const unresolvedSlug = normTitle.trim().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '')
    const unresolvedKey = `unresolved:${record.sourceId}:${record.libraryId}:${unresolvedSlug}`

    const conditions = [
      eq(schema.seriesCompleteness.sourceId, record.sourceId),
      eq(schema.seriesCompleteness.libraryId, record.libraryId),
      sql`(${schema.seriesCompleteness.seriesIdentityKey} = ${record.seriesIdentityKey}
           OR ${schema.seriesCompleteness.seriesIdentityKey} = ${unresolvedKey}
           OR (${record.tmdbId} IS NOT NULL AND ${record.tmdbId} <> '' AND ${schema.seriesCompleteness.tmdbId} = ${record.tmdbId})
           OR (${record.tvdbId} IS NOT NULL AND ${record.tvdbId} <> '' AND ${schema.seriesCompleteness.tvdbId} = ${record.tvdbId})
           OR ${schema.seriesCompleteness.seriesTitle} = ${record.seriesTitle}
           OR ${schema.seriesCompleteness.seriesTitle} = ${clean.title})`
    ]

    const targetConditions = [
      eq(schema.seriesCompleteness.sourceId, record.sourceId),
      eq(schema.seriesCompleteness.libraryId, record.libraryId),
      sql`(${schema.seriesCompleteness.seriesIdentityKey} = ${record.seriesIdentityKey}
           OR (${record.tmdbId} IS NOT NULL AND ${record.tmdbId} <> '' AND ${schema.seriesCompleteness.tmdbId} = ${record.tmdbId}))`
    ]
    const targetConflict = await this.drizzle.select().from(schema.seriesCompleteness).where(and(...targetConditions)).get()
    const existing = await this.drizzle.select().from(schema.seriesCompleteness).where(and(...conditions)).get()

    let id: number
    const target = targetConflict || existing
    if (target) {
      id = target.id
      if (existing && targetConflict && existing.id !== targetConflict.id && existing.userFixedMatch !== 1) {
        await this.drizzle.delete(schema.seriesCompleteness).where(eq(schema.seriesCompleteness.id, existing.id))
      }

      await this.drizzle.update(schema.seriesCompleteness).set({
        ...record,
        seriesTitle: target.userFixedMatch === 1 ? target.seriesTitle : record.seriesTitle,
        tmdbId: target.userFixedMatch === 1 ? target.tmdbId : (record.tmdbId !== undefined ? record.tmdbId : target.tmdbId),
        tvdbId: target.userFixedMatch === 1 ? target.tvdbId : (record.tvdbId !== undefined ? record.tvdbId : target.tvdbId),
        posterUrl: target.userFixedMatch === 1 ? target.posterUrl : (record.posterUrl || target.posterUrl),
        userFixedMatch: target.userFixedMatch === 1 ? 1 : record.userFixedMatch,
        updatedAt: sql`datetime('now')`
      }).where(eq(schema.seriesCompleteness.id, target.id))
    } else {
      id = await this.upsertWithProviderId(
        schema.seriesCompleteness,
        record,
        [schema.seriesCompleteness.seriesIdentityKey, schema.seriesCompleteness.sourceId, schema.seriesCompleteness.libraryId],
        {
          ...record,
          seriesTitle: sql`CASE WHEN user_fixed_match = 1 THEN series_title ELSE excluded.series_title END`,
          tmdbId: sql`CASE WHEN user_fixed_match = 1 THEN tmdb_id ELSE excluded.tmdb_id END`,
          tvdbId: sql`CASE WHEN user_fixed_match = 1 THEN tvdb_id ELSE excluded.tvdb_id END`,
          posterUrl: sql`CASE WHEN user_fixed_match = 1 THEN poster_url ELSE COALESCE(excluded.poster_url, series_completeness.poster_url) END`,
          userFixedMatch: sql`CASE WHEN user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END`,
        }
      )
    }

    if (
      !record.userFixedMatch
      && (record.seriesIdentityKey.startsWith('tmdb:') || record.seriesIdentityKey.startsWith('tvdb:'))
    ) {
      await this.drizzle
        .delete(schema.seriesCompleteness)
        .where(and(
          eq(schema.seriesCompleteness.sourceId, record.sourceId),
          eq(schema.seriesCompleteness.libraryId, record.libraryId),
          sql`(${schema.seriesCompleteness.seriesTitle} = ${record.seriesTitle}
               OR ${schema.seriesCompleteness.seriesTitle} = ${clean.title}
               OR ${schema.seriesCompleteness.seriesIdentityKey} = ${unresolvedKey})`,
          like(schema.seriesCompleteness.seriesIdentityKey, 'unresolved:%'),
          eq(schema.seriesCompleteness.userFixedMatch, 0),
          sql`${schema.seriesCompleteness.id} != ${id}`
        ))
    }

    return id
  }

  async clearTmdbId(id: number): Promise<void> {
    await this.drizzle.update(schema.seriesCompleteness).set({
      tmdbId: null,
      updatedAt: sql`datetime('now')`
    }).where(eq(schema.seriesCompleteness.id, id))
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

  async updateEpisodeMetadata(
    id: number,
    metadata: {
      title?: string
      year?: number
      summary?: string
      posterUrl?: string
      episodeThumbUrl?: string
      seasonPosterUrl?: string
      seriesTmdbId?: string | null
      tmdbId?: string | null
      imdbId?: string | null
      originalLanguage?: string
    }
  ): Promise<void> {
    const data: Record<string, unknown> = { updatedAt: sql`(datetime('now'))` }
    if (metadata.title !== undefined) data.title = metadata.title
    if (metadata.year !== undefined) data.year = metadata.year
    if (metadata.summary !== undefined) data.summary = metadata.summary
    if (metadata.posterUrl !== undefined) data.posterUrl = metadata.posterUrl
    if (metadata.episodeThumbUrl !== undefined) data.episodeThumbUrl = metadata.episodeThumbUrl
    if (metadata.seasonPosterUrl !== undefined) data.seasonPosterUrl = metadata.seasonPosterUrl
    if (metadata.seriesTmdbId !== undefined) data.seriesTmdbId = metadata.seriesTmdbId
    if (metadata.tmdbId !== undefined) data.tmdbId = metadata.tmdbId
    if (metadata.imdbId !== undefined) data.imdbId = metadata.imdbId
    if (metadata.originalLanguage !== undefined) data.originalLanguage = metadata.originalLanguage

    await this.drizzle.update(schema.mediaItems).set(data).where(eq(schema.mediaItems.id, id))
  }

  async updateBatchEpisodeMetadata(
    updates: Array<{
      id: number
      metadata: {
        title?: string
        year?: number
        summary?: string
        posterUrl?: string
        episodeThumbUrl?: string
        seasonPosterUrl?: string
        seriesTmdbId?: string
        tmdbId?: string
        imdbId?: string
        originalLanguage?: string
      }
    }>
  ): Promise<void> {
    for (const update of updates) {
      await this.updateEpisodeMetadata(update.id, update.metadata)
    }
  }

  async deleteCompleteness(id: number): Promise<void> {
    await this.drizzle.delete(schema.seriesCompleteness).where(eq(schema.seriesCompleteness.id, id))
  }

  async mergeDuplicateShows(sourceId?: string, libraryId?: string): Promise<number> {
    const parser = getFileNameParser()
    const logging = getLoggingService()
    let mergedCount = 0

    const conditions = []
    if (sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, sourceId))
    if (libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, libraryId))

    const rows = await this.drizzle.select()
      .from(schema.seriesCompleteness)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all()

    if (!rows || rows.length <= 1) return 0

    const scopedGroups = new Map<string, typeof rows>()
    for (const row of rows) {
      const scope = `${row.sourceId || ''}:::${row.libraryId || ''}`
      if (!scopedGroups.has(scope)) scopedGroups.set(scope, [])
      scopedGroups.get(scope)!.push(row)
    }

    for (const [scope, scopeRows] of scopedGroups.entries()) {
      const [scopeSourceId, scopeLibraryId] = scope.split(':::')
      const clusters: Array<typeof rows> = []
      const visited = new Set<number>()

      for (let i = 0; i < scopeRows.length; i++) {
        const a = scopeRows[i]
        if (visited.has(a.id)) continue

        const cluster: typeof rows = [a]
        visited.add(a.id)

        const normA = parser.normalizeSeriesTitle(a.seriesTitle)
        const cleanA = parser.cleanSeriesTitleAndYear(a.seriesTitle)

        for (let j = i + 1; j < scopeRows.length; j++) {
          const b = scopeRows[j]
          if (visited.has(b.id)) continue

          const normB = parser.normalizeSeriesTitle(b.seriesTitle)
          const cleanB = parser.cleanSeriesTitleAndYear(b.seriesTitle)

          const matchTvdb = a.tvdbId && b.tvdbId && a.tvdbId === b.tvdbId
          const matchTmdb = a.tmdbId && b.tmdbId && a.tmdbId === b.tmdbId
          const matchIdentityKey = a.seriesIdentityKey && b.seriesIdentityKey && a.seriesIdentityKey === b.seriesIdentityKey
          const matchNormTitle = normA && normB && normA === normB
          const matchCleanTitleAndYear = cleanA.title && cleanB.title && cleanA.title.toLowerCase() === cleanB.title.toLowerCase() && (cleanA.year === cleanB.year || !cleanA.year || !cleanB.year)

          if (matchTvdb || matchTmdb || matchIdentityKey || (matchNormTitle && matchCleanTitleAndYear)) {
            cluster.push(b)
            visited.add(b.id)
          }
        }

        if (cluster.length > 1) clusters.push(cluster)
      }

      for (const cluster of clusters) {
        cluster.sort((x, y) => {
          const xFixed = (x.userFixedMatch || 0) === 1 ? 1 : 0
          const yFixed = (y.userFixedMatch || 0) === 1 ? 1 : 0
          if (xFixed !== yFixed) return yFixed - xFixed

          const xHasExt = (x.tmdbId || x.tvdbId) ? 1 : 0
          const yHasExt = (y.tmdbId || y.tvdbId) ? 1 : 0
          if (xHasExt !== yHasExt) return yHasExt - xHasExt

          const xEpisodes = x.ownedEpisodes || 0
          const yEpisodes = y.ownedEpisodes || 0
          if (xEpisodes !== yEpisodes) return yEpisodes - xEpisodes

          return x.id - y.id
        })

        const primary = cluster[0]
        const secondaryRows = cluster.slice(1)
        const secondaryIds = secondaryRows.map(r => r.id)

        const mergedTmdbId = primary.tmdbId || cluster.find(r => r.tmdbId)?.tmdbId || null
        const mergedTvdbId = primary.tvdbId || cluster.find(r => r.tvdbId)?.tvdbId || null
        const mergedPosterUrl = primary.posterUrl ?? cluster.find(r => r.posterUrl)?.posterUrl ?? null
        const mergedBackdropUrl = primary.backdropUrl ?? cluster.find(r => r.backdropUrl)?.backdropUrl ?? null
        const mergedStatus = primary.status ?? cluster.find(r => r.status)?.status ?? null
        const mergedUserFixed = cluster.some(r => r.userFixedMatch === 1) ? 1 : 0

        const canonicalKey = deriveSeriesIdentityKey({
          sourceId: scopeSourceId,
          libraryId: scopeLibraryId,
          folderRelativePath: primary.seriesTitle,
          tmdbId: mergedTmdbId,
          tvdbId: mergedTvdbId,
        })

        const cleanTitle = parser.cleanSeriesTitleAndYear(primary.seriesTitle).title || primary.seriesTitle

        await this.db.execute('BEGIN IMMEDIATE')
        try {
          for (const sec of secondaryRows) {
            await this.db.execute({
              sql: `UPDATE media_items
                    SET series_identity_key = ?, series_title = ?, series_tmdb_id = COALESCE(?, series_tmdb_id)
                    WHERE type = 'episode' AND source_id = ? AND (library_id = ? OR library_id IS NULL OR library_id = '')
                      AND (series_identity_key = ? OR series_title = ?)`,
              args: [canonicalKey, cleanTitle, mergedTmdbId, scopeSourceId, scopeLibraryId, sec.seriesIdentityKey || '', sec.seriesTitle]
            })
          }
          await this.db.execute({
            sql: `UPDATE media_items
                  SET series_identity_key = ?, series_title = ?, series_tmdb_id = COALESCE(?, series_tmdb_id)
                  WHERE type = 'episode' AND source_id = ? AND (library_id = ? OR library_id IS NULL OR library_id = '')
                    AND (series_identity_key = ? OR series_title = ?)`,
            args: [canonicalKey, cleanTitle, mergedTmdbId, scopeSourceId, scopeLibraryId, primary.seriesIdentityKey || '', primary.seriesTitle]
          })

          for (const secId of secondaryIds) {
            await this.db.execute({
              sql: `UPDATE OR IGNORE media_identities SET entity_id = ? WHERE entity_type = 'series' AND entity_id = ?`,
              args: [primary.id, secId]
            })
            await this.db.execute({
              sql: `DELETE FROM media_identities WHERE entity_type = 'series' AND entity_id = ?`,
              args: [secId]
            })
            await this.db.execute({
              sql: `UPDATE OR IGNORE media_aliases SET entity_id = ? WHERE entity_type = 'series' AND entity_id = ?`,
              args: [primary.id, secId]
            })
            await this.db.execute({
              sql: `DELETE FROM media_aliases WHERE entity_type = 'series' AND entity_id = ?`,
              args: [secId]
            })
          }

          const epStatsRes = await this.db.execute({
            sql: `SELECT
                    COUNT(DISTINCT season_number) as owned_seasons,
                    COUNT(*) as owned_episodes,
                    SUM(file_size) as total_size
                  FROM media_items
                  WHERE type = 'episode' AND source_id = ? AND (library_id = ? OR library_id IS NULL OR library_id = '')
                    AND series_identity_key = ?`,
            args: [scopeSourceId, scopeLibraryId, canonicalKey]
          })
          const epStats = epStatsRes.rows[0] as unknown as {
            owned_seasons: number
            owned_episodes: number
            total_size: number | null
          }

          const totalEpisodes = Math.max(primary.totalEpisodes || 0, Number(epStats?.owned_episodes || 0))
          const totalSeasons = Math.max(primary.totalSeasons || 0, Number(epStats?.owned_seasons || 0))
          const ownedEpisodes = Number(epStats?.owned_episodes || primary.ownedEpisodes || 0)
          const ownedSeasons = Number(epStats?.owned_seasons || primary.ownedSeasons || 0)
          const completenessPct = primary.completenessPercentage == null
            ? null
            : totalEpisodes > 0
              ? (ownedEpisodes / totalEpisodes) * 100
              : primary.completenessPercentage

          await this.db.execute({
            sql: `UPDATE series_completeness
                  SET series_title = ?, series_identity_key = ?, tmdb_id = ?, tvdb_id = ?,
                      poster_url = ?, backdrop_url = ?, status = ?, user_fixed_match = ?,
                      total_seasons = ?, total_episodes = ?, owned_seasons = ?, owned_episodes = ?,
                      completeness_percentage = ?, total_size = ?, updated_at = datetime('now')
                  WHERE id = ?`,
            args: [
              cleanTitle,
              canonicalKey,
              mergedTmdbId,
              mergedTvdbId,
              mergedPosterUrl,
              mergedBackdropUrl,
              mergedStatus,
              mergedUserFixed,
              totalSeasons,
              totalEpisodes,
              ownedSeasons,
              ownedEpisodes,
              completenessPct,
              epStats?.total_size !== null && epStats?.total_size !== undefined ? Math.round(Number(epStats.total_size)) : primary.totalSize,
              primary.id
            ]
          })

          for (const secId of secondaryIds) {
            await this.db.execute({
              sql: `DELETE FROM series_completeness WHERE id = ?`,
              args: [secId]
            })
          }

          await this.db.execute('COMMIT')
          mergedCount++
          logging.info('[TVShowRepository]', `Merged ${cluster.length} duplicate TV show records into canonical ID ${primary.id} ("${cleanTitle}")`)
        } catch (err) {
          await this.db.execute('ROLLBACK')
          logging.error('[TVShowRepository]', `Failed to merge duplicate cluster for "${primary.seriesTitle}": ${getErrorMessage(err)}`)
          throw err
        }
      }
    }

    return mergedCount
  }

  private mapDrizzleToCompleteness(r: typeof schema.seriesCompleteness.$inferSelect): SeriesCompleteness {
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
      efficiency_score: r.efficiencyScore,
      storage_debt_bytes: r.storageDebtBytes,
      evidence_status: r.evidenceStatus as SeriesCompleteness['evidence_status'],
      confidence: r.confidence as SeriesCompleteness['confidence'],
      savings_basis: r.savingsBasis as SeriesCompleteness['savings_basis'],
      total_size: r.totalSize ?? undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt
    }
  }
}
