import { eq, and, or, like, desc, asc, sql, inArray, lt, gte } from 'drizzle-orm'
import type { MediaItem, MediaItemFilters, MediaItemVersion, QualityScore, MediaItemType } from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'

export class MediaRepository extends BaseRepository<MediaItem> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'media_items', drizzle)
  }

  async getItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): Promise<MediaItem[]> {
    const conditions = []
    
    if (!filters?.includeDisabledLibraries) {
      // Logic for disabled libraries join handled via subquery or raw SQL snippet in Drizzle
      conditions.push(sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = media_items.source_id AND ls.library_id = media_items.library_id) IS NOT 0`)
    }

    if (filters?.type) conditions.push(eq(schema.mediaItems.type, filters.type))
    if (filters?.sourceId) conditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
    if (filters?.sourceType) conditions.push(eq(schema.mediaItems.sourceType, filters.sourceType))
    if (filters?.libraryId) conditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))
    
    if (filters?.searchQuery) {
      const q = `%${filters.searchQuery}%`
      conditions.push(or(
        like(schema.mediaItems.title, q),
        like(schema.mediaItems.seriesTitle, q)
      ))
    }

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        conditions.push(sql`media_items.title NOT GLOB '[A-Za-z]*'`)
      } else {
        conditions.push(eq(sql`UPPER(SUBSTR(media_items.title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
      }
    }

    // Joining quality_scores
    const query = this.drizzle.select({
      item: schema.mediaItems,
      quality: schema.qualityScores
    })
    .from(schema.mediaItems)
    .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))

    if (filters?.qualityTier) conditions.push(eq(schema.qualityScores.qualityTier, filters.qualityTier))
    if (filters?.tierQuality) conditions.push(eq(schema.qualityScores.tierQuality, filters.tierQuality))
    
    if (filters?.efficiencyFilter) {
      if (filters.efficiencyFilter === 'low') conditions.push(lt(schema.qualityScores.efficiencyScore, 60))
      else if (filters.efficiencyFilter === 'medium') conditions.push(and(gte(schema.qualityScores.efficiencyScore, 60), lt(schema.qualityScores.efficiencyScore, 85)))
      else if (filters.efficiencyFilter === 'high') conditions.push(gte(schema.qualityScores.efficiencyScore, 85))
    }

    if (filters?.slimDown) {
      conditions.push(or(
        lt(schema.qualityScores.efficiencyScore, 60),
        sql`quality_scores.storage_debt_bytes > 5368709120`
      ))
    }

    if (filters?.needsUpgrade !== undefined) {
      conditions.push(eq(schema.qualityScores.needsUpgrade, filters.needsUpgrade ? 1 : 0))
    }

    if (conditions.length > 0) query.where(and(...conditions))

    const sortMap: any = {
      'title': schema.mediaItems.title,
      'year': schema.mediaItems.year,
      'updated_at': schema.mediaItems.updatedAt,
      'created_at': schema.mediaItems.createdAt,
      'tier_score': schema.qualityScores.tierScore,
      'overall_score': schema.qualityScores.overallScore,
      'size': schema.mediaItems.fileSize,
      'storage_debt': schema.qualityScores.storageDebtBytes,
      'efficiency': schema.qualityScores.efficiencyScore
    }

    const sortCol = sortMap[filters?.sortBy || 'title'] || schema.mediaItems.title
    const sortOrder = filters?.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol)
    query.orderBy(sortOrder)

    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    return this.mapDrizzleToMediaItems(rows)
  }

  async count(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): Promise<number> {
    const conditions = []
    
    if (!filters?.includeDisabledLibraries) {
      conditions.push(sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = media_items.source_id AND ls.library_id = media_items.library_id) IS NOT 0`)
    }

    if (filters?.type) conditions.push(eq(schema.mediaItems.type, filters.type))
    if (filters?.sourceId) conditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
    if (filters?.sourceType) conditions.push(eq(schema.mediaItems.sourceType, filters.sourceType))
    if (filters?.libraryId) conditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))
    
    if (filters?.searchQuery) {
      const q = `%${filters.searchQuery}%`
      conditions.push(or(
        like(schema.mediaItems.title, q),
        like(schema.mediaItems.seriesTitle, q)
      ))
    }

    const query = this.drizzle.select({ count: sql<number>`count(*)` })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))

    if (filters?.qualityTier) conditions.push(eq(schema.qualityScores.qualityTier, filters.qualityTier))
    if (filters?.needsUpgrade !== undefined) conditions.push(eq(schema.qualityScores.needsUpgrade, filters.needsUpgrade ? 1 : 0))

    if (conditions.length > 0) query.where(and(...conditions))

    const res = await query.get()
    return res?.count || 0
  }

  async getItem(id: number): Promise<MediaItem | null> {
    const row = await this.drizzle.select({
      item: schema.mediaItems,
      quality: schema.qualityScores
    })
    .from(schema.mediaItems)
    .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
    .where(eq(schema.mediaItems.id, id))
    .get()

    return row ? this.mapDrizzleToMediaItems([row])[0] : null
  }

  private mapDrizzleToMediaItems(rows: any[]): MediaItem[] {
    return rows.map(r => {
      const item = r.item || r; // Handle both joined and direct select
      const quality = r.quality || {};
      return {
        ...item,
        source_id: item.sourceId,
        source_type: item.sourceType,
        library_id: item.libraryId,
        plex_id: item.plexId,
        sort_title: item.sortTitle,
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
        color_space: item.colorSpace,
        video_profile: item.videoProfile,
        video_level: item.videoLevel,
        audio_profile: item.audioProfile,
        audio_sample_rate: item.audioSampleRate,
        has_object_audio: item.hasObjectAudio === 1,
        audio_tracks: item.audioTracks,
        subtitle_tracks: item.subtitleTracks,
        version_count: item.versionCount,
        file_mtime: item.fileMtime,
        imdb_id: item.imdbId,
        tmdb_id: item.tmdbId,
        series_tmdb_id: item.seriesTmdbId,
        original_language: item.originalLanguage,
        audio_language: item.audioLanguage,
        poster_url: item.posterUrl,
        episode_thumb_url: item.episodeThumbUrl,
        season_poster_url: item.seasonPosterUrl,
        user_fixed_match: item.userFixedMatch === 1,
        quality_tier: quality.qualityTier || item.qualityTier,
        tier_quality: quality.tierQuality || item.tierQuality,
        tier_score: quality.tierScore || item.tierScore,
        overall_score: quality.overallScore,
        needs_upgrade: quality.needsUpgrade === 1,
        efficiency_score: quality.efficiencyScore || item.efficiencyScore,
        storage_debt_bytes: quality.storageDebtBytes || item.storageDebtBytes,
        issues: quality.issues,
        created_at: item.createdAt,
        updated_at: item.updatedAt
      }
    })
  }

  async updatePathAndStats(mediaItemId: number, newPath: string, analysis: any): Promise<void> {
    await this.drizzle.update(schema.mediaItems)
      .set({
        filePath: newPath,
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
        updatedAt: sql`(datetime('now'))`
      })
      .where(eq(schema.mediaItems.id, mediaItemId))
  }

  async getItemByPath(filePath: string): Promise<MediaItem | null> {
    const row = await this.drizzle.select({
      item: schema.mediaItems,
      quality: schema.qualityScores
    })
    .from(schema.mediaItems)
    .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
    .where(eq(schema.mediaItems.filePath, filePath))
    .get()

    return row ? this.mapDrizzleToMediaItems([row])[0] : null
  }

  async getItemByProviderId(providerId: string, sourceId?: string): Promise<MediaItem | null> {
    const conditions = [eq(schema.mediaItems.plexId, providerId)]
    if (sourceId) conditions.push(eq(schema.mediaItems.sourceId, sourceId))

    const row = await this.drizzle.select()
      .from(schema.mediaItems)
      .where(and(...conditions))
      .get()
    
    return row ? this.mapDrizzleToMediaItems([row])[0] : null
  }

  async upsertItem(item: MediaItem): Promise<number> {
    const result = await this.drizzle.insert(schema.mediaItems)
      .values({
        sourceId: item.source_id || 'legacy',
        sourceType: item.source_type || 'plex',
        libraryId: item.library_id ?? null,
        plexId: item.plex_id || '',
        title: item.title,
        sortTitle: item.sort_title ?? null,
        year: item.year ?? null,
        type: item.type,
        seriesTitle: item.series_title ?? null,
        seasonNumber: item.season_number ?? null,
        episodeNumber: item.episode_number ?? null,
        filePath: item.file_path || '',
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
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .onConflictDoUpdate({
        target: [schema.mediaItems.sourceId, schema.mediaItems.plexId],
        set: {
          libraryId: item.library_id ?? null,
          title: sql`CASE WHEN user_fixed_match = 1 THEN title ELSE excluded.title END`,
          sortTitle: sql`CASE WHEN user_fixed_match = 1 THEN sort_title ELSE excluded.sort_title END`,
          year: sql`CASE WHEN user_fixed_match = 1 THEN year ELSE excluded.year END`,
          type: item.type,
          seriesTitle: sql`CASE WHEN user_fixed_match = 1 THEN series_title ELSE excluded.series_title END`,
          seasonNumber: item.season_number ?? null,
          episodeNumber: item.episode_number ?? null,
          filePath: item.file_path || '',
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
          container: item.container ?? null,
          versionCount: item.version_count || 1,
          fileMtime: item.file_mtime ?? null,
          originalLanguage: sql`CASE WHEN user_fixed_match = 1 THEN original_language ELSE COALESCE(excluded.original_language, original_language) END`,
          audioLanguage: sql`COALESCE(excluded.audio_language, audio_language)`,
          imdbId: sql`CASE WHEN user_fixed_match = 1 THEN imdb_id ELSE COALESCE(excluded.imdb_id, imdb_id) END`,
          tmdbId: sql`CASE WHEN user_fixed_match = 1 THEN tmdb_id ELSE COALESCE(excluded.tmdb_id, tmdb_id) END`,
          seriesTmdbId: sql`CASE WHEN user_fixed_match = 1 THEN series_tmdb_id ELSE COALESCE(excluded.series_tmdb_id, series_tmdb_id) END`,
          posterUrl: sql`CASE WHEN user_fixed_match = 1 THEN poster_url ELSE COALESCE(excluded.poster_url, poster_url) END`,
          episodeThumbUrl: sql`CASE WHEN user_fixed_match = 1 THEN episode_thumb_url ELSE COALESCE(excluded.episode_thumb_url, episode_thumb_url) END`,
          seasonPosterUrl: sql`CASE WHEN user_fixed_match = 1 THEN season_poster_url ELSE COALESCE(excluded.season_poster_url, season_poster_url) END`,
          summary: sql`CASE WHEN user_fixed_match = 1 THEN summary ELSE COALESCE(excluded.summary, summary) END`,
          userFixedMatch: sql`CASE WHEN user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END`,
          qualityTier: sql`COALESCE(excluded.quality_tier, quality_tier)`,
          tierQuality: sql`COALESCE(excluded.tier_quality, tier_quality)`,
          tierScore: sql`COALESCE(excluded.tier_score, tier_score)`,
          updatedAt: sql`(datetime('now'))`
        }
      })
      .returning({ id: schema.mediaItems.id })

    return result[0]?.id || 0
  }

  async deleteItem(id: number): Promise<void> {
    await this.beginBatch()
    try {
      const item = await this.drizzle.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, id))
        .get()

      if (item) {
        await this.drizzle.delete(schema.mediaItemVersions).where(eq(schema.mediaItemVersions.mediaItemId, id))
        await this.drizzle.delete(schema.qualityScores).where(eq(schema.qualityScores.mediaItemId, id))
        await this.drizzle.delete(schema.mediaItemCollections).where(eq(schema.mediaItemCollections.mediaItemId, id))
        await this.drizzle.delete(schema.mediaItems).where(eq(schema.mediaItems.id, id))

        if (item.type === 'episode' && item.seriesTitle) {
          const sourceId = item.sourceId
          const libraryId = item.libraryId || ''

          // Update completeness using Drizzle sql tagged template for complexity
          await this.drizzle.update(schema.seriesCompleteness)
            .set({
              ownedEpisodes: sql`(SELECT COUNT(*) FROM media_items WHERE series_title = ${item.seriesTitle} AND source_id = ${sourceId} AND library_id = ${libraryId} AND type = 'episode')`,
              ownedSeasons: sql`(SELECT COUNT(DISTINCT season_number) FROM media_items WHERE series_title = ${item.seriesTitle} AND source_id = ${sourceId} AND library_id = ${libraryId} AND type = 'episode')`,
              completenessPercentage: sql`CASE WHEN total_episodes > 0
                THEN ROUND(CAST((SELECT COUNT(*) FROM media_items WHERE series_title = ${item.seriesTitle} AND source_id = ${sourceId} AND library_id = ${libraryId} AND type = 'episode') AS REAL) * 100.0 / total_episodes)
                ELSE 0 END`,
              updatedAt: sql`(datetime('now'))`
            })
            .where(and(
              eq(schema.seriesCompleteness.seriesTitle, item.seriesTitle),
              eq(schema.seriesCompleteness.sourceId, sourceId),
              eq(schema.seriesCompleteness.libraryId, libraryId)
            ))

          await this.drizzle.delete(schema.seriesCompleteness)
            .where(and(
              eq(schema.seriesCompleteness.seriesTitle, item.seriesTitle),
              eq(schema.seriesCompleteness.sourceId, sourceId),
              eq(schema.seriesCompleteness.libraryId, libraryId),
              sql`owned_episodes <= 0`
            ))
        }
      }
      await this.endBatch()
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  async deleteItemsForSource(sourceId: string): Promise<void> {
    await this.beginBatch()
    try {
      const items = await this.drizzle.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.sourceId, sourceId))
        .all()
      
      const itemIds = items.map(i => i.id)
      
      if (itemIds.length > 0) {
        await this.drizzle.delete(schema.mediaItemVersions).where(inArray(schema.mediaItemVersions.mediaItemId, itemIds))
        await this.drizzle.delete(schema.qualityScores).where(inArray(schema.qualityScores.mediaItemId, itemIds))
        await this.drizzle.delete(schema.mediaItemCollections).where(inArray(schema.mediaItemCollections.mediaItemId, itemIds))
        await this.drizzle.delete(schema.mediaItems).where(inArray(schema.mediaItems.id, itemIds))
      }
      
      await this.drizzle.delete(schema.seriesCompleteness).where(eq(schema.seriesCompleteness.sourceId, sourceId))
      await this.drizzle.delete(schema.movieCollections).where(eq(schema.movieCollections.sourceId, sourceId))
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
    newSeriesTitle?: string
  ): Promise<number> {
    const data: any = {
      seriesTmdbId: tmdbId,
      userFixedMatch: 1,
      updatedAt: sql`(datetime('now'))`
    }
    if (posterUrl) data.posterUrl = posterUrl
    if (newSeriesTitle) data.seriesTitle = newSeriesTitle

    await this.drizzle.update(schema.mediaItems)
      .set(data)
      .where(and(
        eq(schema.mediaItems.seriesTitle, seriesTitle),
        eq(schema.mediaItems.sourceId, sourceId),
        eq(schema.mediaItems.type, 'episode')
      ))

    if (newSeriesTitle && newSeriesTitle !== seriesTitle) {
      await this.drizzle.update(schema.seriesCompleteness)
        .set({ seriesTitle: newSeriesTitle, updatedAt: sql`(datetime('now'))` })
        .where(and(
          eq(schema.seriesCompleteness.seriesTitle, seriesTitle),
          eq(schema.seriesCompleteness.sourceId, sourceId)
        ))
    }

    const titleToQuery = newSeriesTitle || seriesTitle
    const res = await this.drizzle.select({ count: sql<number>`count(*)` })
      .from(schema.mediaItems)
      .where(and(
        eq(schema.mediaItems.seriesTitle, titleToQuery),
        eq(schema.mediaItems.sourceId, sourceId),
        eq(schema.mediaItems.type, 'episode')
      ))
      .get()
    
    return res?.count || 0
  }

  async updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number
  ): Promise<void> {
    const data: any = {
      tmdbId: tmdbId,
      userFixedMatch: 1,
      updatedAt: sql`(datetime('now'))`
    }
    if (posterUrl) data.posterUrl = posterUrl
    if (title) data.title = title
    if (year !== undefined) data.year = year

    await this.drizzle.update(schema.mediaItems)
      .set(data)
      .where(and(
        eq(schema.mediaItems.id, mediaItemId),
        eq(schema.mediaItems.type, 'movie')
      ))
  }

  async updateMovieWithTMDBId(mediaItemId: number, tmdbId: string): Promise<void> {
    await this.drizzle.update(schema.mediaItems)
      .set({ tmdbId: tmdbId, updatedAt: sql`(datetime('now'))` })
      .where(and(
        eq(schema.mediaItems.id, mediaItemId),
        eq(schema.mediaItems.type, 'movie')
      ))
  }

  async removeStaleProviderItems(
    sourceId: string,
    libraryId: string,
    itemType: MediaItemType,
    validProviderIds: Set<string>
  ): Promise<number> {
    await this.beginBatch()
    try {
      if (validProviderIds.size === 0) {
        await this.drizzle.delete(schema.mediaItems)
          .where(and(
            eq(schema.mediaItems.sourceId, sourceId),
            eq(schema.mediaItems.libraryId, libraryId),
            eq(schema.mediaItems.type, itemType)
          ))
        await this.endBatch()
        return 0 // LibSQL doesn't easily return rowsAffected here
      }

      const currentItems = await this.drizzle.select({ plexId: schema.mediaItems.plexId })
        .from(schema.mediaItems)
        .where(and(
          eq(schema.mediaItems.sourceId, sourceId),
          eq(schema.mediaItems.libraryId, libraryId),
          eq(schema.mediaItems.type, itemType)
        ))
        .all()

      const toDelete = currentItems
        .map(r => r.plexId)
        .filter(id => !validProviderIds.has(id))

      if (toDelete.length > 0) {
        const batchSize = 100
        for (let i = 0; i < toDelete.length; i += batchSize) {
          const chunk = toDelete.slice(i, i + batchSize)
          await this.drizzle.delete(schema.mediaItems)
            .where(and(
              eq(schema.mediaItems.sourceId, sourceId),
              eq(schema.mediaItems.libraryId, libraryId),
              eq(schema.mediaItems.type, itemType),
              inArray(schema.mediaItems.plexId, chunk)
            ))
        }
      }

      await this.endBatch()
      return toDelete.length
    } catch (err) {
      await this.rollbackBatch()
      throw err
    }
  }

  async updateItemArtwork(
    id: number,
    artwork: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): Promise<void> {
    const data: any = { updatedAt: sql`(datetime('now'))` }
    if (artwork.posterUrl !== undefined) data.posterUrl = artwork.posterUrl
    if (artwork.episodeThumbUrl !== undefined) data.episodeThumbUrl = artwork.episodeThumbUrl
    if (artwork.seasonPosterUrl !== undefined) data.seasonPosterUrl = artwork.seasonPosterUrl

    await this.drizzle.update(schema.mediaItems)
      .set(data)
      .where(eq(schema.mediaItems.id, id))
  }

  async updateBatchItemArtwork(
    ids: number[],
    artwork: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): Promise<void> {
    if (ids.length === 0) return
    const data: any = { updatedAt: sql`(datetime('now'))` }
    if (artwork.posterUrl !== undefined) data.posterUrl = artwork.posterUrl
    if (artwork.episodeThumbUrl !== undefined) data.episodeThumbUrl = artwork.episodeThumbUrl
    if (artwork.seasonPosterUrl !== undefined) data.seasonPosterUrl = artwork.seasonPosterUrl

    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      await this.drizzle.update(schema.mediaItems)
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
      const rows = await this.drizzle.select({
        item: schema.mediaItems,
        quality: schema.qualityScores
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(inArray(schema.mediaItems.id, batch))
      .all()

      result.push(...this.mapDrizzleToMediaItems(rows))
    }
    return result
  }

  async exportWorkingCSV(options: any): Promise<string> {
    const conditions = []
    if (options.sourceId) conditions.push(eq(schema.mediaItems.sourceId, options.sourceId))
    if (options.type) conditions.push(eq(schema.mediaItems.type, options.type))
    if (options.needsUpgrade) conditions.push(eq(schema.qualityScores.needsUpgrade, 1))

    const rows = await this.drizzle.select({
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
      audio_codec: schema.mediaItems.audioCodec
    })
    .from(schema.mediaItems)
    .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
    .where(and(...conditions))
    .all()

    if (rows.length === 0) return 'No data'

    const headers = Object.keys(rows[0]).join(',')
    const csvRows = rows.map(row => 
      Object.values(row).map(val => 
        typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val
      ).join(',')
    )

    return [headers, ...csvRows].join('\n')
  }

  async getItemsByTmdbIds(tmdbIds: string[]): Promise<Map<string, MediaItem>> {
    const result = new Map<string, MediaItem>()
    if (tmdbIds.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < tmdbIds.length; i += batchSize) {
      const batch = tmdbIds.slice(i, i + batchSize)
      const rows = await this.drizzle.select()
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
      args: [seriesTmdbId]
    })
    const row = res.rows[0] as unknown as { count: number } | undefined
    return row?.count || 0
  }

  async getEpisodeCountForSeason(seriesTitle: string, seasonNumber: number): Promise<number> {
    const res = await this.db.execute({
      sql: "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ?",
      args: [seriesTitle, seasonNumber]
    })
    const row = res.rows[0] as unknown as { count: number } | undefined
    return row?.count || 0
  }

  async getEpisodeCountForSeasonEpisode(seriesTitle: string, seasonNumber: number, episodeNumber: number): Promise<number> {
    const res = await this.db.execute({
      sql: "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ? AND episode_number = ?",
      args: [seriesTitle, seasonNumber, episodeNumber]
    })
    const row = res.rows[0] as unknown as { count: number } | undefined
    return row?.count || 0
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
        sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = media_items.source_id AND ls.library_id = media_items.library_id) IS NOT 0`
      ]
      if (filters?.sourceId) conditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
      if (filters?.libraryId) conditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))

      const res = await this.drizzle.select({ count: sql<number>`count(*)` })
        .from(schema.mediaItems)
        .where(and(...conditions))
        .get()
      return res?.count || 0
    } else if (table === 'tvshows') {
      const conditions = [
        eq(schema.seriesCompleteness.completenessPercentage, sql`completeness_percentage`), // Dummy to start and(...)
        sql`UPPER(SUBSTR(series_title, 1, 1)) < ${upperLetter}`
      ]
      if (filters?.sourceId) conditions.push(eq(schema.seriesCompleteness.sourceId, filters.sourceId))
      if (filters?.libraryId) conditions.push(eq(schema.seriesCompleteness.libraryId, filters.libraryId))

      const res = await this.drizzle.select({ count: sql<number>`count(*)` })
        .from(schema.seriesCompleteness)
        .where(and(...conditions))
        .get()
      return res?.count || 0
    } else if (table === 'artists') {
      const conditions = [sql`UPPER(SUBSTR(name, 1, 1)) < ${upperLetter}`]
      if (filters?.sourceId) conditions.push(eq(schema.musicArtists.sourceId, filters.sourceId))
      
      const res = await this.drizzle.select({ count: sql<number>`count(*)` })
        .from(schema.musicArtists)
        .where(and(...conditions))
        .get()
      return res?.count || 0
    } else {
      const conditions = [sql`UPPER(SUBSTR(title, 1, 1)) < ${upperLetter}`]
      if (filters?.sourceId) conditions.push(eq(schema.musicAlbums.sourceId, filters.sourceId))

      const res = await this.drizzle.select({ count: sql<number>`count(*)` })
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
      eq(schema.mediaItems.seriesTitle, seriesTitle)
    ]
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

    return this.mapDrizzleToMediaItems(rows)
  }

  async getItemVersions(mediaItemId: number): Promise<MediaItemVersion[]> {
    const rows = await this.drizzle.select()
      .from(schema.mediaItemVersions)
      .where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))
      .all()
    
    return rows.map(r => ({
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
      updated_at: r.updatedAt
    }))
  }

  async syncItemVersions(mediaItemId: number, versions: any[]): Promise<void> {
    await this.beginBatch()
    try {
      await this.drizzle.delete(schema.mediaItemVersions).where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))
      for (const v of versions) {
        await this.drizzle.insert(schema.mediaItemVersions)
          .values({
            mediaItemId,
            versionSource: v.version_source || 'primary',
            filePath: v.file_path || '',
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
            updatedAt: sql`(datetime('now'))`
          })
      }
      await this.endBatch()
    } catch(err) { await this.rollbackBatch(); throw err; }
  }

  async updateMediaItemVersionQuality(id: number, score: any): Promise<void> {
    await this.drizzle.update(schema.mediaItemVersions)
      .set({
        efficiencyScore: score.efficiency_score,
        storageDebtBytes: score.storage_debt_bytes,
        updatedAt: sql`(datetime('now'))`
      })
      .where(eq(schema.mediaItemVersions.id, id))
  }

  async updateBestVersion(mediaItemId: number): Promise<void> {
    await this.beginBatch()
    try {
      await this.drizzle.update(schema.mediaItemVersions)
        .set({ isBest: 0 })
        .where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))

      // Complex subquery update in Drizzle
      await this.drizzle.update(schema.mediaItemVersions)
        .set({ isBest: 1 })
        .where(eq(schema.mediaItemVersions.id, 
          this.drizzle.select({ id: schema.mediaItemVersions.id })
            .from(schema.mediaItemVersions)
            .where(eq(schema.mediaItemVersions.mediaItemId, mediaItemId))
            .orderBy(desc(schema.mediaItemVersions.efficiencyScore), desc(schema.mediaItemVersions.fileSize))
            .limit(1)
        ))
      await this.endBatch()
    } catch(err) { await this.rollbackBatch(); throw err; }
  }

  async updateVersionQuality(id: number, score: any): Promise<void> {
    await this.drizzle.update(schema.mediaItemVersions)
      .set({
        qualityTier: score.quality_tier,
        tierQuality: score.tier_quality,
        tierScore: score.tier_score,
        bitrateTierScore: score.bitrate_tier_score || 0,
        audioTierScore: score.audio_tier_score || 0,
        efficiencyScore: score.efficiency_score || 0,
        storageDebtBytes: score.storage_debt_bytes || 0,
        updatedAt: sql`(datetime('now'))`
      })
      .where(eq(schema.mediaItemVersions.id, id))
  }

  async addMediaItemToCollection(mediaId: number, tmdbCollectionId: string | void): Promise<void> {
    if (!tmdbCollectionId) return
    
    // First ensure the collection exists in movie_collections if not already
    // (This repo doesn't own movie_collections, but we need the numeric ID)
    const collection = await this.drizzle.select({ id: schema.movieCollections.id })
      .from(schema.movieCollections)
      .where(eq(schema.movieCollections.tmdbCollectionId, tmdbCollectionId))
      .get()
    
    if (collection) {
      await this.drizzle.insert(schema.mediaItemCollections)
        .values({
          mediaItemId: mediaId,
          collectionId: collection.id,
          createdAt: sql`(datetime('now'))`
        })
        .onConflictDoNothing()
    }
  }

  async getUniqueSeriesTitles(filters?: { sourceId?: string; libraryId?: string }): Promise<string[]> {
    const conditions = [
      eq(schema.mediaItems.type, 'episode'),
      sql`media_items.series_title IS NOT NULL`
    ]
    if (filters?.sourceId) conditions.push(eq(schema.mediaItems.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.mediaItems.libraryId, filters.libraryId))

    const rows = await this.drizzle.selectDistinct({ seriesTitle: schema.mediaItems.seriesTitle })
      .from(schema.mediaItems)
      .where(and(...conditions))
      .orderBy(asc(schema.mediaItems.seriesTitle))
      .all()
    
    return rows.map(r => r.seriesTitle as string)
  }

  async globalSearch(query: string, limit = 5): Promise<{ movies: MediaItem[], tvShows: Array<{ title: string }>, artists: any[], albums: any[] }> {
    const q = `%${query}%`
    
    // We execute these in parallel using Drizzle
    const [movies, tvShows, artists, albums] = await Promise.all([
      this.drizzle.select().from(schema.mediaItems).where(and(eq(schema.mediaItems.type, 'movie'), like(schema.mediaItems.title, q))).limit(limit).all(),
      this.drizzle.selectDistinct({ title: schema.mediaItems.seriesTitle }).from(schema.mediaItems).where(and(eq(schema.mediaItems.type, 'episode'), like(schema.mediaItems.seriesTitle, q))).limit(limit).all(),
      this.drizzle.select().from(schema.musicArtists).where(like(schema.musicArtists.name, q)).limit(limit).all(),
      this.drizzle.select().from(schema.musicAlbums).where(like(schema.musicAlbums.title, q)).limit(limit).all()
    ])

    return {
      movies: this.mapDrizzleToMediaItems(movies),
      tvShows: tvShows as Array<{ title: string }>,
      artists: artists, // Type mapping for music might be needed later
      albums: albums
    }
  }

  async getQualityScores(): Promise<QualityScore[]> {
    const rows = await this.drizzle.select().from(schema.qualityScores).all()
    return this.mapDrizzleToQualityScores(rows)
  }

  async getQualityScoreByMediaId(id: number): Promise<QualityScore | null> {
    const row = await this.drizzle.select()
      .from(schema.qualityScores)
      .where(eq(schema.qualityScores.mediaItemId, id))
      .get()
    return row ? this.mapDrizzleToQualityScores([row])[0] : null
  }

  async getQualityScoresByMediaItemIds(ids: number[]): Promise<Map<number, QualityScore>> {
    const result = new Map<number, QualityScore>()
    if (ids.length === 0) return result
    
    const rows = await this.drizzle.select()
      .from(schema.qualityScores)
      .where(inArray(schema.qualityScores.mediaItemId, ids))
      .all()
    
    const scores = this.mapDrizzleToQualityScores(rows)
    scores.forEach(s => result.set(s.media_item_id, s))
    return result
  }

  async upsertQualityScore(score: Partial<QualityScore>): Promise<number> {
    const result = await this.drizzle.insert(schema.qualityScores)
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
        issues: Array.isArray(score.issues) ? JSON.stringify(score.issues) : (score.issues || '[]'),
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
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
          issues: Array.isArray(score.issues) ? JSON.stringify(score.issues) : (score.issues || '[]'),
          updatedAt: sql`(datetime('now'))`
        }
      })
      .returning({ id: schema.qualityScores.id })

    return result[0]?.id || 0
  }

  private mapDrizzleToQualityScores(rows: any[]): QualityScore[] {
    return rows.map(r => ({
      id: r.id,
      media_item_id: r.mediaItemId,
      quality_tier: r.qualityTier,
      tier_quality: r.tierQuality,
      tier_score: r.tierScore,
      bitrate_tier_score: r.bitrateTierScore,
      audio_tier_score: r.audioTierScore,
      overall_score: r.overallScore,
      resolution_score: r.resolutionScore,
      bitrate_score: r.bitrateScore,
      audio_score: r.audioScore,
      efficiency_score: r.efficiencyScore,
      storage_debt_bytes: r.storageDebtBytes,
      is_low_quality: r.isLowQuality === 1,
      needs_upgrade: r.needsUpgrade === 1,
      issues: r.issues,
      created_at: r.createdAt,
      updated_at: r.updatedAt
    }))
  }
}
