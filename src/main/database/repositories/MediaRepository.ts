import { eq, and, like, desc, asc, sql, inArray, isNull } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type {
  MediaItem,
  MediaItemFilters,
  MediaItemVersion,
  QualityScore,
  MediaItemType,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  ProviderType,
} from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'
import { PathUtils } from '@main/services/utils/PathUtils'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'
import { toSnakeCaseMediaItem, toSnakeCaseQualityScore } from '@main/database/utils/mappers'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { Client } from '@libsql/client'
import * as schema from '@main/database/drizzleSchema'

function cleanNulls<T extends object>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, value === null ? undefined : value])
  ) as T
}

interface ExportWorkingCsvOptions {
  sourceId?: string
  type?: MediaItemType
  needsUpgrade?: boolean
  includeUpgrades?: boolean
  includeMissingMovies?: boolean
  includeMissingEpisodes?: boolean
  includeMissingAlbums?: boolean
}

interface MediaAnalysisStats {
  fileSize?: number
  duration?: number
  video?: { resolution?: string; width?: number; height?: number; codec?: string; bitrate?: number }
  audioTracks?: Array<{ codec?: string; channels?: number; bitrate?: number }>
}

interface VersionQualityUpdate {
  efficiency_score?: number
  storage_debt_bytes?: number
  quality_tier?: string
  tier_quality?: string
  tier_score?: number
  bitrate_tier_score?: number
  audio_tier_score?: number
  overall_score?: number
  resolution_score?: number
  bitrate_score?: number
  audio_score?: number
  needs_upgrade?: boolean | number
  is_low_quality?: boolean | number
  issues?: string
}

export class MediaRepository extends BaseRepository<typeof schema.mediaItems> {
  constructor(db: Client, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'media_items', drizzle, schema.mediaItems)
  }

  async getItemById(id: number): Promise<MediaItem | null> {
    const row = await this.drizzle.select({ item: schema.mediaItems, quality: schema.qualityScores })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(eq(schema.mediaItems.id, id))
      .get()
    return row ? toSnakeCaseMediaItem(row) as MediaItem : null
  }

  async getItems(
    filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }
  ): Promise<MediaItem[]> {
    const conditions = this.buildFilters(filters)

    // Joining quality_scores
    const query = this.drizzle
      .select({
        item: schema.mediaItems,
        quality: schema.qualityScores,
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))

    if (conditions.length > 0) query.where(and(...conditions))

    const sortMap: Record<string, AnyColumn | SQL> = {
      title: schema.mediaItems.title,
      year: schema.mediaItems.year,
      updated_at: schema.mediaItems.updatedAt,
      created_at: schema.mediaItems.createdAt,
      tier_score: schema.qualityScores.tierScore,
      overall_score: schema.qualityScores.overallScore,
      size: schema.mediaItems.fileSize,
      storage_debt: schema.qualityScores.storageDebtBytes,
      efficiency: schema.qualityScores.efficiencyScore,
    }

    const sortCol = sortMap[filters?.sortBy || 'title'] || schema.mediaItems.title
    const sortOrder = filters?.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol)
    query.orderBy(sortOrder)

    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    return this.mapDrizzleToMediaItems(rows)
  }

  async count(
    filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }
  ): Promise<number> {
    const conditions = this.buildFilters(filters)

    // We need to join quality_scores if the filters rely on it
    const query = this.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))

    if (conditions.length > 0) {
      query.where(and(...conditions))
    }

    const res = await query.get()
    return res?.count || 0
  }

  private buildFilters(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): SQL[] {
    const conditions: SQL[] = []

    if (!filters?.includeDisabledLibraries) {
      conditions.push(
        sql`NOT EXISTS (SELECT 1 FROM library_scans ls WHERE ls.source_id = media_items.source_id AND ls.library_id = media_items.library_id AND ls.is_enabled = 0)`
      )
    }

    if (filters?.type) conditions.push(eq(schema.mediaItems.type, filters.type))
    if (filters?.sourceId) conditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
    if (filters?.sourceType) conditions.push(eq(schema.mediaItems.sourceType, filters.sourceType))
    if (filters?.libraryId) conditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))

    if (filters?.searchQuery) {
      conditions.push(
        this.buildSearchFilter(
          [schema.mediaItems.title, schema.mediaItems.seriesTitle],
          filters.searchQuery
        )
      )
    }

    if (filters?.alphabetFilter) {
      conditions.push(this.buildAlphabetFilter(schema.mediaItems.title, filters.alphabetFilter))
    }

    // Quality Tier (Resolution: 4K, 1080p, 720p, SD)
    if (filters?.qualityTier && filters.qualityTier !== 'all') {
      conditions.push(
        sql`(UPPER(${schema.qualityScores.qualityTier}) = UPPER(${filters.qualityTier}) OR UPPER(${schema.mediaItems.resolution}) = UPPER(${filters.qualityTier}))`
      )
    }

    // Tier Quality (LOW, MEDIUM, HIGH)
    if (filters?.tierQuality && filters.tierQuality !== 'all') {
      conditions.push(
        sql`UPPER(${schema.qualityScores.tierQuality}) = UPPER(${filters.tierQuality})`
      )
    }

    // Slim Down
    if (filters?.slimDown) {
      conditions.push(
        sql`(${schema.qualityScores.efficiencyScore} < 60 OR ${schema.qualityScores.storageDebtBytes} > 5368709120)`
      )
    }

    if (filters?.needsUpgrade) {
      conditions.push(eq(schema.qualityScores.needsUpgrade, 1))
    }

    return conditions.filter((condition): condition is SQL => condition !== undefined)
  }

  async getItem(id: number): Promise<MediaItem | null> {
    const row = await this.drizzle
      .select({
        item: schema.mediaItems,
        quality: schema.qualityScores,
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(eq(schema.mediaItems.id, id))
      .get()

    return row ? this.mapDrizzleToMediaItems([row])[0] : null
  }

  private mapDrizzleToMediaItems(rows: unknown[]): MediaItem[] {
    return rows.map((r) => toSnakeCaseMediaItem(r))
  }

  async updatePathAndStats(mediaItemId: number, newPath: string, analysis: MediaAnalysisStats): Promise<void> {
    const dbPath = PathUtils.toDatabasePath(newPath)
    await this.drizzle
      .update(schema.mediaItems)
      .set({
        filePath: dbPath,
        fileSize: analysis.fileSize || 0,
        duration: analysis.duration || 0,
        resolution: analysis.video?.resolution || 'unknown',
        width: analysis.video?.width || 0,
        height: analysis.video?.height || 0,
        videoCodec: analysis.video?.codec || 'unknown',
        videoBitrate: analysis.video?.bitrate || 0,
        audioCodec: analysis.audioTracks?.[0]?.codec || 'unknown',
        audioChannels: analysis.audioTracks?.[0]?.channels || 0,
        audioBitrate: analysis.audioTracks?.[0]?.bitrate || 0,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(schema.mediaItems.id, mediaItemId))
  }

  async updateActivatedPathAndStats(mediaItemId: number, newPath: string, fileSize: number, duration: number): Promise<void> {
    await this.drizzle.update(schema.mediaItems).set({ filePath: PathUtils.toDatabasePath(newPath), fileSize, duration, updatedAt: sql`(datetime('now'))` }).where(eq(schema.mediaItems.id, mediaItemId))
  }

  async getItemByPath(filePath: string): Promise<MediaItem | null> {
    const dbPath = PathUtils.toDatabasePath(filePath)
    const row = await this.drizzle
      .select({
        item: schema.mediaItems,
        quality: schema.qualityScores,
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(eq(schema.mediaItems.filePath, dbPath))
      .get()

    return row ? this.mapDrizzleToMediaItems([row])[0] : null
  }

  async getItemsByPaths(filePaths: string[]): Promise<MediaItem[]> {
    if (filePaths.length === 0) return []
    const dbPaths = filePaths.map((fp) => PathUtils.toDatabasePath(fp))
    const result: MediaItem[] = []
    const batchSize = 500

    for (let i = 0; i < dbPaths.length; i += batchSize) {
      const batch = dbPaths.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select({
          item: schema.mediaItems,
          quality: schema.qualityScores,
        })
        .from(schema.mediaItems)
        .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
        .where(inArray(schema.mediaItems.filePath, batch))
        .all()

      result.push(...this.mapDrizzleToMediaItems(rows))
    }

    return result
  }

  async getItemByProviderId(providerId: string, sourceId?: string): Promise<MediaItem | null> {
    const conditions = [eq(schema.mediaItems.plexId, providerId)]
    if (sourceId) conditions.push(eq(schema.mediaItems.sourceId, sourceId))

    const row = await this.drizzle
      .select()
      .from(schema.mediaItems)
      .where(and(...conditions))
      .get()

    return row ? this.mapDrizzleToMediaItems([row])[0] : null
  }

  async upsertItem(item: MediaItem): Promise<number> {
    const seriesIdentityKey = item.series_identity_key
      ?? (item.type === 'episode' && (item.series_title || item.file_path)
          ? deriveSeriesIdentityKey({
            sourceId: item.source_id || 'legacy',
            libraryId: item.library_id ?? '',
            folderRelativePath: item.series_title || item.file_path || 'unknown',
            tmdbId: item.series_tmdb_id,
          })
        : null)
    const data = {
      sourceId: item.source_id || 'legacy',
      sourceType: item.source_type || 'plex',
      libraryId: item.library_id ?? null,
      plexId: item.plex_id || '',
      title: item.title,
      sortTitle: item.sort_title ?? null,
      year: item.year ?? null,
      type: item.type,
      seriesTitle: item.series_title ?? null,
      seriesIdentityKey,
      seasonNumber: item.season_number ?? null,
      episodeNumber: item.episode_number ?? null,
      filePath: PathUtils.toDatabasePath(item.file_path || ''),
      fileSize: item.file_size || 0,
      duration: item.duration || 0,
      resolution: item.resolution || 'unknown',
      width: item.width || 0,
      height: item.height || 0,
      videoCodec: item.video_codec || 'unknown',
      videoBitrate: item.video_bitrate || 0,
      audioCodec: item.audio_codec || 'unknown',
      audioChannels: item.audio_channels || 0,
      audioBitrate: item.audio_bitrate || 0,
      videoFrameRate: item.video_frame_rate ?? null,
      colorBitDepth: item.color_bit_depth ?? null,
      hdrFormat: item.hdr_format ?? null,
      colorSpace: item.color_space ?? null,
      videoProfile: item.video_profile ?? null,
      videoLevel: item.video_level ?? null,
      audioProfile: item.audio_profile ?? null,
      audioSampleRate: item.audio_sample_rate ?? null,
      hasObjectAudio: item.has_object_audio ? 1 : 0,
      audioTracks: item.audio_tracks ?? null,
      subtitleTracks: item.subtitle_tracks ?? null,
      originalLanguage: item.original_language ?? null,
      audioLanguage: item.audio_language ?? null,
      container: item.container ?? null,
      versionCount: item.version_count || 1,
      fileMtime: item.file_mtime ?? null,
      imdbId: item.imdb_id ?? null,
      tmdbId: item.tmdb_id ?? null,
      seriesTmdbId: item.series_tmdb_id ?? null,
      posterUrl: item.poster_url ?? null,
      episodeThumbUrl: item.episode_thumb_url ?? null,
      seasonPosterUrl: item.season_poster_url ?? null,
      summary: item.summary ?? null,
      userFixedMatch: item.user_fixed_match ? 1 : 0,
      qualityTier: item.quality_tier ?? null,
      tierQuality: item.tier_quality ?? null,
      tierScore: item.tier_score || 0,
    }

    return await this.upsertWithProviderId(
      schema.mediaItems,
      data,
      [schema.mediaItems.sourceId, schema.mediaItems.plexId],
      {
        ...data,
        title: sql`CASE WHEN user_fixed_match = 1 THEN title ELSE excluded.title END`,
        sortTitle: sql`CASE WHEN user_fixed_match = 1 THEN sort_title ELSE excluded.sort_title END`,
        year: sql`CASE WHEN user_fixed_match = 1 THEN year ELSE excluded.year END`,
        seriesTitle: sql`CASE WHEN user_fixed_match = 1 THEN series_title ELSE excluded.series_title END`,
        originalLanguage: sql`CASE WHEN user_fixed_match = 1 THEN original_language ELSE COALESCE(excluded.original_language, original_language) END`,
        imdbId: sql`CASE WHEN user_fixed_match = 1 THEN imdb_id ELSE COALESCE(excluded.imdb_id, imdb_id) END`,
        tmdbId: sql`CASE WHEN user_fixed_match = 1 THEN tmdb_id ELSE COALESCE(excluded.tmdb_id, tmdb_id) END`,
        seriesTmdbId: sql`CASE WHEN user_fixed_match = 1 THEN series_tmdb_id ELSE COALESCE(excluded.series_tmdb_id, series_tmdb_id) END`,
        seriesIdentityKey: sql`CASE WHEN user_fixed_match = 1 THEN series_identity_key ELSE COALESCE(excluded.series_identity_key, series_identity_key) END`,
        posterUrl: sql`CASE WHEN user_fixed_match = 1 THEN poster_url ELSE COALESCE(excluded.poster_url, poster_url) END`,
        episodeThumbUrl: sql`CASE WHEN user_fixed_match = 1 THEN episode_thumb_url ELSE COALESCE(excluded.episode_thumb_url, episode_thumb_url) END`,
        seasonPosterUrl: sql`CASE WHEN user_fixed_match = 1 THEN season_poster_url ELSE COALESCE(excluded.season_poster_url, season_poster_url) END`,
        summary: sql`CASE WHEN user_fixed_match = 1 THEN summary ELSE COALESCE(excluded.summary, summary) END`,
        userFixedMatch: sql`CASE WHEN user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END`,
      }
    )
  }

  async deleteItem(id: number): Promise<void> {
    await this.beginBatch()
    try {
      const item = await this.drizzle
        .select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, id))
        .get()

      if (item) {
        await this.drizzle
          .delete(schema.mediaItemVersions)
          .where(eq(schema.mediaItemVersions.mediaItemId, id))
        await this.drizzle
          .delete(schema.qualityScores)
          .where(eq(schema.qualityScores.mediaItemId, id))
        await this.drizzle
          .delete(schema.mediaItemCollections)
          .where(eq(schema.mediaItemCollections.mediaItemId, id))
        await this.drizzle.delete(schema.mediaItems).where(eq(schema.mediaItems.id, id))

        if (item.type === 'episode' && item.seriesTitle) {
          await this.recalculateSeriesCompleteness([item])
        }
      }
      await this.endBatch()
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  async deleteItems(ids: number[]): Promise<void> {
    if (!ids.length) return
    await this.beginBatch()
    try {
      const items = await this.drizzle
        .select()
        .from(schema.mediaItems)
        .where(inArray(schema.mediaItems.id, ids))
        .all()

      if (items.length > 0) {
        await this.drizzle
          .delete(schema.mediaItemVersions)
          .where(inArray(schema.mediaItemVersions.mediaItemId, ids))
        await this.drizzle
          .delete(schema.qualityScores)
          .where(inArray(schema.qualityScores.mediaItemId, ids))
        await this.drizzle
          .delete(schema.mediaItemCollections)
          .where(inArray(schema.mediaItemCollections.mediaItemId, ids))
        await this.drizzle.delete(schema.mediaItems).where(inArray(schema.mediaItems.id, ids))

        const episodeItems = items.filter((it) => it.type === 'episode' && it.seriesTitle)
        if (episodeItems.length > 0) {
          await this.recalculateSeriesCompleteness(episodeItems)
        }
      }
      await this.endBatch()
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  private async recalculateSeriesCompleteness(
    items: Array<typeof schema.mediaItems.$inferSelect>
  ): Promise<void> {
    const seriesMap = new Map<
      string,
      { seriesTitle: string; seriesIdentityKey: string | null; sourceId: string; libraryId: string }
    >()
    for (const item of items) {
      if (item.type === 'episode' && item.seriesTitle) {
        const key = `${item.sourceId}:${item.libraryId || ''}:${item.seriesIdentityKey || item.seriesTitle}`
        if (!seriesMap.has(key)) {
          seriesMap.set(key, {
            seriesTitle: item.seriesTitle,
            seriesIdentityKey: item.seriesIdentityKey ?? null,
            sourceId: item.sourceId,
            libraryId: item.libraryId || '',
          })
        }
      }
    }

    for (const series of seriesMap.values()) {
      const matchCondition = series.seriesIdentityKey
        ? eq(schema.seriesCompleteness.seriesIdentityKey, series.seriesIdentityKey)
        : eq(schema.seriesCompleteness.seriesTitle, series.seriesTitle)

      const epFilter = series.seriesIdentityKey
        ? sql`series_identity_key = ${series.seriesIdentityKey}`
        : sql`series_title = ${series.seriesTitle}`

      await this.drizzle
        .update(schema.seriesCompleteness)
        .set({
          ownedEpisodes: sql`(SELECT COUNT(*) FROM media_items WHERE ${epFilter} AND source_id = ${series.sourceId} AND library_id = ${series.libraryId} AND type = 'episode')`,
          ownedSeasons: sql`(SELECT COUNT(DISTINCT season_number) FROM media_items WHERE ${epFilter} AND source_id = ${series.sourceId} AND library_id = ${series.libraryId} AND type = 'episode')`,
          completenessPercentage: sql`CASE WHEN total_episodes > 0
            THEN ROUND(CAST((SELECT COUNT(*) FROM media_items WHERE ${epFilter} AND source_id = ${series.sourceId} AND library_id = ${series.libraryId} AND type = 'episode') AS REAL) * 100.0 / total_episodes)
            ELSE 0 END`,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(
          and(
            matchCondition,
            eq(schema.seriesCompleteness.sourceId, series.sourceId),
            eq(schema.seriesCompleteness.libraryId, series.libraryId)
          )
        )

      await this.drizzle
        .delete(schema.seriesCompleteness)
        .where(
          and(
            matchCondition,
            eq(schema.seriesCompleteness.sourceId, series.sourceId),
            eq(schema.seriesCompleteness.libraryId, series.libraryId),
            sql`owned_episodes <= 0`
          )
        )
    }
  }

  async deleteItemsForSource(sourceId: string): Promise<void> {
    await this.beginBatch()
    try {
      const items = await this.drizzle
        .select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.sourceId, sourceId))
        .all()

      const itemIds = items.map((i) => i.id)

      if (itemIds.length > 0) {
        await this.drizzle
          .delete(schema.mediaItemVersions)
          .where(inArray(schema.mediaItemVersions.mediaItemId, itemIds))
        await this.drizzle
          .delete(schema.qualityScores)
          .where(inArray(schema.qualityScores.mediaItemId, itemIds))
        await this.drizzle
          .delete(schema.mediaItemCollections)
          .where(inArray(schema.mediaItemCollections.mediaItemId, itemIds))
        await this.drizzle.delete(schema.mediaItems).where(inArray(schema.mediaItems.id, itemIds))
      }

      await this.drizzle
        .delete(schema.seriesCompleteness)
        .where(eq(schema.seriesCompleteness.sourceId, sourceId))
      await this.drizzle
        .delete(schema.movieCollections)
        .where(eq(schema.movieCollections.sourceId, sourceId))
      await this.endBatch()
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  async updateSeriesMatch(
    seriesTitle: string,
    sourceId: string,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string,
    imdbId?: string
  ): Promise<number> {
    const data: { seriesTmdbId: string; userFixedMatch: number; updatedAt: SQL; posterUrl?: string; seriesTitle?: string; imdbId?: string } = {
      seriesTmdbId: tmdbId,
      userFixedMatch: 1,
      updatedAt: sql`(datetime('now'))`,
    }
    if (posterUrl) data.posterUrl = posterUrl
    if (newSeriesTitle) data.seriesTitle = newSeriesTitle
    if (imdbId) data.imdbId = imdbId

    await this.drizzle
      .update(schema.mediaItems)
      .set(data)
      .where(
        and(
          eq(schema.mediaItems.seriesTitle, seriesTitle),
          eq(schema.mediaItems.sourceId, sourceId),
          eq(schema.mediaItems.type, 'episode')
        )
      )

    if (newSeriesTitle && newSeriesTitle !== seriesTitle) {
      await this.drizzle
        .update(schema.seriesCompleteness)
        .set({ seriesTitle: newSeriesTitle, updatedAt: sql`(datetime('now'))` })
        .where(
          and(
            eq(schema.seriesCompleteness.seriesTitle, seriesTitle),
            eq(schema.seriesCompleteness.sourceId, sourceId)
          )
        )
    }

    const titleToQuery = newSeriesTitle || seriesTitle
    const res = await this.drizzle
      .select({ count: sql<number>`count(*)` })
      .from(schema.mediaItems)
      .where(
        and(
          eq(schema.mediaItems.seriesTitle, titleToQuery),
          eq(schema.mediaItems.sourceId, sourceId),
          eq(schema.mediaItems.type, 'episode')
        )
      )
      .get()

    return res?.count || 0
  }

  async updateMovieMatch(
    mediaItemId: number,
    tmdbId?: string,
    posterUrl?: string,
    title?: string,
    year?: number,
    imdbId?: string
  ): Promise<void> {
    const data: { tmdbId?: string; userFixedMatch: number; updatedAt: SQL; posterUrl?: string; title?: string; year?: number; imdbId?: string } = {
      userFixedMatch: 1,
      updatedAt: sql`(datetime('now'))`,
    }
    if (tmdbId !== undefined) data.tmdbId = tmdbId
    if (posterUrl) data.posterUrl = posterUrl
    if (title) data.title = title
    if (year !== undefined) data.year = year
    if (imdbId) data.imdbId = imdbId

    await this.drizzle
      .update(schema.mediaItems)
      .set(data)
      .where(and(eq(schema.mediaItems.id, mediaItemId), eq(schema.mediaItems.type, 'movie')))
  }

  async updateMovieWithTMDBId(mediaItemId: number, tmdbId: string): Promise<void> {
    await this.drizzle
      .update(schema.mediaItems)
      .set({ tmdbId: tmdbId, updatedAt: sql`(datetime('now'))` })
      .where(and(eq(schema.mediaItems.id, mediaItemId), eq(schema.mediaItems.type, 'movie')))
  }

  async removeStaleProviderItems(
    sourceId: string,
    libraryId: string | null,
    itemType: MediaItemType,
    validProviderIds: Set<string>
  ): Promise<number> {
    const where = and(
      eq(schema.mediaItems.sourceId, sourceId),
      libraryId === null
        ? isNull(schema.mediaItems.libraryId)
        : eq(schema.mediaItems.libraryId, libraryId),
      eq(schema.mediaItems.type, itemType)
    )
    return await this.reconcileStaleItems(where!, schema.mediaItems.plexId, validProviderIds)
  }

  async updateItemArtwork(
    id: number,
    artwork: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): Promise<void> {
    const data: { updatedAt: SQL; posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string } = { updatedAt: sql`(datetime('now'))` }
    if (artwork.posterUrl !== undefined) data.posterUrl = artwork.posterUrl
    if (artwork.episodeThumbUrl !== undefined) data.episodeThumbUrl = artwork.episodeThumbUrl
    if (artwork.seasonPosterUrl !== undefined) data.seasonPosterUrl = artwork.seasonPosterUrl

    await this.drizzle.update(schema.mediaItems).set(data).where(eq(schema.mediaItems.id, id))
  }

  async updateBatchItemArtwork(
    ids: number[],
    artwork: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): Promise<void> {
    if (ids.length === 0) return
    const data: { updatedAt: SQL; posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string } = { updatedAt: sql`(datetime('now'))` }
    if (artwork.posterUrl !== undefined) data.posterUrl = artwork.posterUrl
    if (artwork.episodeThumbUrl !== undefined) data.episodeThumbUrl = artwork.episodeThumbUrl
    if (artwork.seasonPosterUrl !== undefined) data.seasonPosterUrl = artwork.seasonPosterUrl

    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      await this.drizzle
        .update(schema.mediaItems)
        .set(data)
        .where(inArray(schema.mediaItems.id, batch))
    }
  }

  async getItemsByIds(ids: number[]): Promise<MediaItem[]> {
    if (ids.length === 0) return []
    const result: MediaItem[] = []
    const batchSize = 500

    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select({
          item: schema.mediaItems,
          quality: schema.qualityScores,
        })
        .from(schema.mediaItems)
        .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
        .where(inArray(schema.mediaItems.id, batch))
        .all()

      result.push(...this.mapDrizzleToMediaItems(rows))
    }
    return result
  }

  async exportWorkingCSV(options: ExportWorkingCsvOptions): Promise<string> {
    const conditions = []
    if (options.sourceId) conditions.push(eq(schema.mediaItems.sourceId, options.sourceId))
    if (options.type) conditions.push(eq(schema.mediaItems.type, options.type))
    if (options.needsUpgrade) conditions.push(eq(schema.qualityScores.needsUpgrade, 1))

    const rows = await this.drizzle
      .select({
        title: schema.mediaItems.title,
        year: schema.mediaItems.year,
        type: schema.mediaItems.type,
        series_title: schema.mediaItems.seriesTitle,
        season_number: schema.mediaItems.seasonNumber,
        episode_number: schema.mediaItems.episodeNumber,
        quality_tier: schema.qualityScores.qualityTier,
        tier_quality: schema.qualityScores.tierQuality,
        overall_score: schema.qualityScores.overallScore,
        efficiency_score: schema.qualityScores.efficiencyScore,
        storage_debt_bytes: schema.qualityScores.storageDebtBytes,
        file_path: schema.mediaItems.filePath,
        file_size: schema.mediaItems.fileSize,
        resolution: schema.mediaItems.resolution,
        video_codec: schema.mediaItems.videoCodec,
        audio_codec: schema.mediaItems.audioCodec,
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(and(...conditions))
      .all()

    if (rows.length === 0) return 'No data'

    const headers = Object.keys(rows[0]).join(',')
    const csvRows = rows.map((row) =>
      Object.values(row)
        .map((val) => (typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val))
        .join(',')
    )

    return [headers, ...csvRows].join('\n')
  }

  async getItemsByTmdbIds(tmdbIds: string[]): Promise<Map<string, MediaItem>> {
    const result = new Map<string, MediaItem>()
    if (tmdbIds.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < tmdbIds.length; i += batchSize) {
      const batch = tmdbIds.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select()
        .from(schema.mediaItems)
        .where(inArray(schema.mediaItems.tmdbId, batch))
        .all()

      const items = this.mapDrizzleToMediaItems(rows)
      for (const item of items) {
        if (item.tmdb_id) result.set(item.tmdb_id, item)
      }
    }
    return result
  }

  async getEpisodeCountBySeriesTmdbId(seriesTmdbId: string): Promise<number> {
    const res = await this.db.execute({
      sql: "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_tmdb_id = ?",
      args: [seriesTmdbId],
    })
    const row = res.rows[0] as unknown as { count: number } | undefined
    return row?.count || 0
  }

  async getEpisodeCountForSeason(seriesTitle: string, seasonNumber: number): Promise<number> {
    const res = await this.db.execute({
      sql: "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ?",
      args: [seriesTitle, seasonNumber],
    })
    const row = res.rows[0] as unknown as { count: number } | undefined
    return row?.count || 0
  }

  async getEpisodeCountForSeasonEpisode(
    seriesTitle: string,
    seasonNumber: number,
    episodeNumber: number
  ): Promise<number> {
    const res = await this.db.execute({
      sql: "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ? AND episode_number = ?",
      args: [seriesTitle, seasonNumber, episodeNumber],
    })
    const row = res.rows[0] as unknown as { count: number } | undefined
    return row?.count || 0
  }

  /**
   * Retrieves episodes given a list of { seriesTitle, seasonNumber, episodeNumber }.
   * This batches requests into chunked parameterized queries.
   */
  async getEpisodesForSeasonEpisodes(
    tuples: { seriesTitle: string; seasonNumber: number; episodeNumber: number }[]
  ): Promise<Set<string>> {
    const foundEpisodes = new Set<string>()
    if (!tuples || tuples.length === 0) return foundEpisodes

    // Chunk size: SQLite limits variables to 999/32766 depending on version. We'll use batches of 300 tuples (900 args).
    const chunkSize = 300
    for (let i = 0; i < tuples.length; i += chunkSize) {
      const batch = tuples.slice(i, i + chunkSize)

      const placeholders = batch.map(() => '(?, ?, ?)').join(', ')
      const args: (string | number)[] = []

      for (const t of batch) {
        args.push(t.seriesTitle, t.seasonNumber, t.episodeNumber)
      }

      const res = await this.db.execute({
        sql: `SELECT series_title, season_number, episode_number FROM media_items WHERE type = 'episode' AND (series_title, season_number, episode_number) IN (${placeholders})`,
        args,
      })

      for (const row of res.rows as unknown as {
        series_title: string
        season_number: number
        episode_number: number
      }[]) {
        const key = `${row.series_title}-${row.season_number}-${row.episode_number}`
        foundEpisodes.add(key)
      }
    }

    return foundEpisodes
  }

  async getLetterOffset(
    table: 'movies' | 'tvshows' | 'artists' | 'albums',
    letter: string,
    filters?: { sourceId?: string; libraryId?: string }
  ): Promise<number> {
    if (letter === '#') return 0
    const upperLetter = letter.toUpperCase()

    if (table === 'movies') {
      const conditions = [
        eq(schema.mediaItems.type, 'movie'),
        sql`UPPER(SUBSTR(COALESCE(media_items.sort_title, media_items.title), 1, 1)) < ${upperLetter}`,
        sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = media_items.source_id AND ls.library_id = media_items.library_id) IS NOT 0`,
      ]
      if (filters?.sourceId) conditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
      if (filters?.libraryId) conditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))

      const res = await this.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(schema.mediaItems)
        .where(and(...conditions))
        .get()
      return res?.count || 0
    } else if (table === 'tvshows') {
      const conditions = [
        eq(schema.seriesCompleteness.completenessPercentage, sql`completeness_percentage`), // Dummy to start and(...)
        sql`UPPER(SUBSTR(series_title, 1, 1)) < ${upperLetter}`,
      ]
      if (filters?.sourceId)
        conditions.push(eq(schema.seriesCompleteness.sourceId, filters.sourceId))
      if (filters?.libraryId)
        conditions.push(eq(schema.seriesCompleteness.libraryId, filters.libraryId))

      const res = await this.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(schema.seriesCompleteness)
        .where(and(...conditions))
        .get()
      return res?.count || 0
    } else if (table === 'artists') {
      const conditions = [sql`UPPER(SUBSTR(name, 1, 1)) < ${upperLetter}`]
      if (filters?.sourceId) conditions.push(eq(schema.musicArtists.sourceId, filters.sourceId))

      const res = await this.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(schema.musicArtists)
        .where(and(...conditions))
        .get()
      return res?.count || 0
    } else {
      const conditions = [sql`UPPER(SUBSTR(title, 1, 1)) < ${upperLetter}`]
      if (filters?.sourceId) conditions.push(eq(schema.musicAlbums.sourceId, filters.sourceId))

      const res = await this.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(schema.musicAlbums)
        .where(and(...conditions))
        .get()
      return res?.count || 0
    }
  }

  async getEpisodesForSeries(
    seriesTitle: string,
    sourceId?: string,
    libraryId?: string
  ): Promise<MediaItem[]> {
    const conditions = [
      eq(schema.mediaItems.type, 'episode'),
      eq(schema.mediaItems.seriesTitle, seriesTitle),
    ]
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

    return this.mapDrizzleToMediaItems(rows)
  }

  async getItemVersions(mediaItemId: number): Promise<MediaItemVersion[]> {
    const rows = await this.drizzle
      .select()
      .from(schema.mediaItemVersions)
      .where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))
      .all()

    return rows.map((r) => ({
      id: r.id,
      media_item_id: r.mediaItemId,
      version_source: r.versionSource,
      edition: r.edition || undefined,
      label: r.label || undefined,
      file_path: r.filePath,
      file_size: r.fileSize,
      duration: r.duration,
      resolution: r.resolution,
      width: r.width,
      height: r.height,
      video_codec: r.videoCodec,
      video_bitrate: r.videoBitrate,
      audio_codec: r.audioCodec,
      audio_channels: r.audioChannels,
      audio_bitrate: r.audioBitrate,
      video_frame_rate: r.videoFrameRate || undefined,
      color_bit_depth: r.colorBitDepth || undefined,
      hdr_format: r.hdrFormat || undefined,
      original_language: r.originalLanguage || undefined,
      audio_language: r.audioLanguage || undefined,
      is_best: r.isBest === 1,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }))
  }

  async syncItemVersions(mediaItemId: number, versions: Array<Omit<MediaItemVersion, 'id' | 'media_item_id'> & { original_language?: string | null; audio_language?: string | null }>): Promise<void> {
    await this.beginBatch()
    try {
      await this.drizzle
        .delete(schema.mediaItemVersions)
        .where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))
      for (const v of versions) {
        await this.drizzle.insert(schema.mediaItemVersions).values({
          mediaItemId,
          versionSource: v.version_source || 'primary',
          filePath: PathUtils.toDatabasePath(v.file_path || ''),
          fileSize: v.file_size || 0,
          duration: v.duration || 0,
          resolution: v.resolution || 'unknown',
          width: v.width || 0,
          height: v.height || 0,
          videoCodec: v.video_codec || 'unknown',
          videoBitrate: v.video_bitrate || 0,
          audioCodec: v.audio_codec || 'unknown',
          audioChannels: v.audio_channels || 0,
          audioBitrate: v.audio_bitrate || 0,
          isBest: v.is_best ? 1 : 0,
          hdrFormat: v.hdr_format ?? null,
          colorBitDepth: v.color_bit_depth ?? null,
          originalLanguage: v.original_language ?? null,
          audioLanguage: v.audio_language ?? null,
          createdAt: sql`(datetime('now'))`,
          updatedAt: sql`(datetime('now'))`,
        })
      }
      await this.endBatch()
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  async updateMediaItemVersionQuality(id: number, score: VersionQualityUpdate): Promise<void> {
    await this.drizzle
      .update(schema.mediaItemVersions)
      .set({
        efficiencyScore: score.efficiency_score,
        storageDebtBytes: score.storage_debt_bytes,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(schema.mediaItemVersions.id, id))
  }

  async updateBestVersion(mediaItemId: number): Promise<void> {
    await this.beginBatch()
    try {
      await this.drizzle
        .update(schema.mediaItemVersions)
        .set({ isBest: 0 })
        .where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))

      // Complex subquery update in Drizzle
      await this.drizzle
        .update(schema.mediaItemVersions)
        .set({ isBest: 1 })
        .where(
          eq(
            schema.mediaItemVersions.id,
            this.drizzle
              .select({ id: schema.mediaItemVersions.id })
              .from(schema.mediaItemVersions)
              .where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))
              .orderBy(
                desc(schema.mediaItemVersions.efficiencyScore),
                desc(schema.mediaItemVersions.fileSize)
              )
              .limit(1)
          )
        )
      await this.endBatch()
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  async updateVersionQuality(id: number, score: VersionQualityUpdate): Promise<void> {
    await this.drizzle
      .update(schema.mediaItemVersions)
      .set({
        qualityTier: score.quality_tier,
        tierQuality: score.tier_quality,
        tierScore: score.tier_score,
        bitrateTierScore: score.bitrate_tier_score || 0,
        audioTierScore: score.audio_tier_score || 0,
        efficiencyScore: score.efficiency_score || 0,
        storageDebtBytes: score.storage_debt_bytes || 0,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(schema.mediaItemVersions.id, id))
  }

  async addMediaItemToCollection(mediaId: number, tmdbCollectionId: string | void): Promise<void> {
    if (!tmdbCollectionId) return

    // First ensure the collection exists in movie_collections if not already
    // (This repo doesn't own movie_collections, but we need the numeric ID)
    const collection = await this.drizzle
      .select({ id: schema.movieCollections.id })
      .from(schema.movieCollections)
      .where(eq(schema.movieCollections.tmdbCollectionId, tmdbCollectionId))
      .get()

    if (collection) {
      await this.drizzle
        .insert(schema.mediaItemCollections)
        .values({
          mediaItemId: mediaId,
          collectionId: collection.id,
          createdAt: sql`(datetime('now'))`,
        })
        .onConflictDoNothing()
    }
  }

  async getUniqueSeriesTitles(filters?: {
    sourceId?: string
    libraryId?: string
  }): Promise<string[]> {
    const conditions = [
      eq(schema.mediaItems.type, 'episode'),
      sql`media_items.series_title IS NOT NULL`,
    ]
    if (filters?.sourceId) conditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))

    const rows = await this.drizzle
      .selectDistinct({ seriesTitle: schema.mediaItems.seriesTitle })
      .from(schema.mediaItems)
      .where(and(...conditions))
      .orderBy(asc(schema.mediaItems.seriesTitle))
      .all()

    return rows.map((r) => r.seriesTitle as string)
  }

  async globalSearch(
    query: string,
    limit = 5
  ): Promise<{
    movies: MediaItem[]
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: MediaItem[]
    artists: MusicArtist[]
    albums: MusicAlbum[]
    tracks: MusicTrack[]
  }> {
    const q = `%${query}%`

    // We execute these in parallel using Drizzle
    const [movies, tvShows, episodes, artists, albums, tracks] = await Promise.all([
      this.drizzle
        .select()
        .from(schema.mediaItems)
        .where(and(eq(schema.mediaItems.type, 'movie'), like(schema.mediaItems.title, q)))
        .limit(limit)
        .all(),
      this.drizzle
        .select({
          id: schema.seriesCompleteness.id,
          title: schema.seriesCompleteness.seriesTitle,
          poster_url: schema.seriesCompleteness.posterUrl,
        })
        .from(schema.seriesCompleteness)
        .where(like(schema.seriesCompleteness.seriesTitle, q))
        .limit(limit)
        .all(),
      this.drizzle
        .select()
        .from(schema.mediaItems)
        .where(and(eq(schema.mediaItems.type, 'episode'), like(schema.mediaItems.title, q)))
        .limit(limit)
        .all(),
      this.drizzle
        .select()
        .from(schema.musicArtists)
        .where(like(schema.musicArtists.name, q))
        .limit(limit)
        .all(),
      this.drizzle
        .select()
        .from(schema.musicAlbums)
        .where(like(schema.musicAlbums.title, q))
        .limit(limit)
        .all(),
      this.drizzle
        .select()
        .from(schema.musicTracks)
        .where(like(schema.musicTracks.title, q))
        .limit(limit)
        .all(),
    ])

    return {
      movies: this.mapDrizzleToMediaItems(movies),
      tvShows: tvShows.map((s) => ({
        id: s.id,
        title: s.title,
        poster_url: s.poster_url ?? undefined,
      })),
      episodes: this.mapDrizzleToMediaItems(episodes),
      artists: artists.map((r) =>
        cleanNulls({
          ...r,
          source_id: r.sourceId,
          source_type: r.sourceType as ProviderType,
          library_id: r.libraryId ?? undefined,
          provider_id: r.providerId,
          sort_name: r.sortName,
          musicbrainz_id: r.musicbrainzId,
          thumb_url: r.thumbUrl,
          art_url: r.artUrl,
          user_fixed_match: r.userFixedMatch === 1,
          album_count: r.albumCount,
          track_count: r.trackCount,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        }) as MusicArtist
      ),
      albums: albums.map((r) =>
        cleanNulls({
          ...r,
          source_id: r.sourceId,
          source_type: r.sourceType as ProviderType,
          library_id: r.libraryId ?? undefined,
          provider_id: r.providerId,
          artist_id: r.artistId,
          artist_name: r.artistName,
          sort_title: r.sortTitle,
          musicbrainz_id: r.musicbrainzId,
          musicbrainz_release_group_id: r.musicbrainzReleaseGroupId,
          album_type: r.albumType,
          track_count: r.trackCount,
          total_duration: r.totalDuration,
          total_size: r.totalSize,
          best_audio_codec: r.bestAudioCodec,
          best_audio_bitrate: r.bestAudioBitrate,
          best_sample_rate: r.bestSampleRate,
          best_bit_depth: r.bestBitDepth,
          avg_audio_bitrate: r.avgAudioBitrate,
          thumb_url: r.thumbUrl,
          art_url: r.artUrl,
          user_fixed_match: r.userFixedMatch === 1,
          release_date: r.releaseDate,
          added_at: r.addedAt,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        }) as MusicAlbum
      ),
      tracks: tracks.map((r) =>
        cleanNulls({
          ...r,
          source_id: r.sourceId,
          source_type: r.sourceType as ProviderType,
          library_id: r.libraryId ?? undefined,
          provider_id: r.providerId,
          album_id: r.albumId,
          artist_id: r.artistId,
          album_name: r.albumName,
          artist_name: r.artistName,
          track_number: r.trackNumber,
          disc_number: r.discNumber,
          file_path: r.filePath,
          file_size: r.fileSize,
          file_mtime: r.fileMtime,
          audio_codec: r.audioCodec,
          audio_bitrate: r.audioBitrate,
          sample_rate: r.sampleRate,
          bit_depth: r.bitDepth,
          is_lossless: r.isLossless === 1,
          is_hi_res: r.isHiRes === 1,
          musicbrainz_id: r.musicbrainzId,
          added_at: r.addedAt,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        }) as MusicTrack
      ),
    }
  }

  async getQualityScores(): Promise<QualityScore[]> {
    const rows = await this.drizzle.select().from(schema.qualityScores).all()
    return this.mapDrizzleToQualityScores(rows)
  }

  async getQualityScoreByMediaId(id: number): Promise<QualityScore | null> {
    const row = await this.drizzle
      .select()
      .from(schema.qualityScores)
      .where(eq(schema.qualityScores.mediaItemId, id))
      .get()
    return row ? this.mapDrizzleToQualityScores([row])[0] : null
  }

  async getQualityScoresByMediaItemIds(ids: number[]): Promise<Map<number, QualityScore>> {
    const result = new Map<number, QualityScore>()
    if (ids.length === 0) return result

    const rows = await this.drizzle
      .select()
      .from(schema.qualityScores)
      .where(inArray(schema.qualityScores.mediaItemId, ids))
      .all()

    const scores = this.mapDrizzleToQualityScores(rows)
    scores.forEach((s) => result.set(s.media_item_id, s))
    return result
  }

  async upsertQualityScore(score: Partial<QualityScore>): Promise<number> {
    const result = await this.drizzle
      .insert(schema.qualityScores)
      .values({
        mediaItemId: score.media_item_id!,
        qualityTier: score.quality_tier || 'SD',
        tierQuality: score.tier_quality || 'MEDIUM',
        tierScore: score.tier_score || 0,
        bitrateTierScore: score.bitrate_tier_score || 0,
        audioTierScore: score.audio_tier_score || 0,
        overallScore: score.overall_score || 0,
        resolutionScore: score.resolution_score || 0,
        bitrateScore: score.bitrate_score || 0,
        audioScore: score.audio_score || 0,
        efficiencyScore: score.efficiency_score || 0,
        storageDebtBytes: score.storage_debt_bytes || 0,
        isLowQuality: score.is_low_quality ? 1 : 0,
        needsUpgrade: score.needs_upgrade ? 1 : 0,
        issues: Array.isArray(score.issues) ? JSON.stringify(score.issues) : score.issues || '[]',
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`,
      })
      .onConflictDoUpdate({
        target: schema.qualityScores.mediaItemId,
        set: {
          qualityTier: score.quality_tier,
          tierQuality: score.tier_quality,
          tierScore: score.tier_score,
          bitrateTierScore: score.bitrate_tier_score || 0,
          audioTierScore: score.audio_tier_score || 0,
          overallScore: score.overall_score,
          resolutionScore: score.resolution_score,
          bitrateScore: score.bitrate_score,
          audioScore: score.audio_score,
          efficiencyScore: score.efficiency_score,
          storageDebtBytes: score.storage_debt_bytes,
          isLowQuality: score.is_low_quality ? 1 : 0,
          needsUpgrade: score.needs_upgrade ? 1 : 0,
          issues: Array.isArray(score.issues) ? JSON.stringify(score.issues) : score.issues || '[]',
          updatedAt: sql`(datetime('now'))`,
        },
      })
      .returning({ id: schema.qualityScores.id })

    return result[0]?.id || 0
  }

  private mapDrizzleToQualityScores(rows: unknown[]): QualityScore[] {
    return rows.map((r) => toSnakeCaseQualityScore(r))
  }
}
