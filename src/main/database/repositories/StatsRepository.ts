import { eq, and, sql, asc, desc, lt, countDistinct, exists, count, avg, sum } from 'drizzle-orm'
import type { DashboardSummary, MovieCollection, SeriesCompleteness as _SeriesCompleteness, ArtistCompleteness as _ArtistCompleteness, MusicCompletenessStats } from '@main/types/database'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'

export class StatsRepository {
  constructor(
    private drizzle: LibSQLDatabase<typeof schema>
  ) {}

  public async getDashboardSummary(sourceId?: string): Promise<DashboardSummary> {
    // 1. Settings
    const settingsList = await this.drizzle.select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(sql`key IN ('completeness_include_eps', 'completeness_include_singles', 'dashboard_upgrade_sort', 'dashboard_collection_sort', 'dashboard_series_sort', 'dashboard_artist_sort')`)
      .all()
    
    const settingsMap = settingsList.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {} as Record<string, string>)

    const uSort = settingsMap['dashboard_upgrade_sort'] || 'quality'
    const cSort = settingsMap['dashboard_collection_sort'] || 'completeness'
    const sSort = settingsMap['dashboard_series_sort'] || 'completeness'
    const aSort = settingsMap['dashboard_artist_sort'] || 'completeness'

    // Sort order helpers
    const getUpgradeOrder = (item: any, q: any) => {
      if (uSort === 'efficiency') return [asc(q.efficiencyScore), desc(q.storageDebtBytes)]
      if (uSort === 'recent') return [desc(item.createdAt)]
      if (uSort === 'title') return [asc(item.title)]
      return [asc(q.tierScore)]
    }

    const getCollectionOrder = () => {
      if (cSort === 'name') return [asc(schema.movieCollections.collectionName)]
      if (cSort === 'recent') return [desc(schema.movieCollections.createdAt)]
      return [desc(schema.movieCollections.completenessPercentage)]
    }

    const getSeriesOrder = () => {
      if (sSort === 'name') return [asc(schema.seriesCompleteness.seriesTitle)]
      if (sSort === 'recent') return [desc(schema.seriesCompleteness.createdAt)]
      return [desc(schema.seriesCompleteness.completenessPercentage)]
    }

    const getArtistOrder = () => {
      if (aSort === 'name') return [asc(schema.artistCompleteness.artistName)]
      return [desc(schema.artistCompleteness.completenessPercentage)]
    }

    // Common conditions for library visibility
    const visibilitySubquery = (sourceCol: any, libCol: any) => sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = ${sourceCol} AND ls.library_id = ${libCol}) IS NOT 0`
    const sourceEnabledSubquery = (sourceCol: any) => sql`(SELECT is_enabled FROM media_sources s WHERE s.source_id = ${sourceCol}) = 1`

    // 2. Movie Upgrades
    const movieUpgradesQuery = this.drizzle.select({ item: schema.mediaItems, q: schema.qualityScores })
      .from(schema.mediaItems)
      .innerJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(and(
        eq(schema.mediaItems.type, 'movie'),
        eq(schema.qualityScores.needsUpgrade, 1),
        sourceEnabledSubquery(schema.mediaItems.sourceId),
        visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId),
        sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined,
        sql`media_items.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)`
      ))
      .orderBy(...getUpgradeOrder(schema.mediaItems, schema.qualityScores))
      .limit(100)

    // 3. TV Upgrades
    const tvUpgradesQuery = this.drizzle.select({ item: schema.mediaItems, q: schema.qualityScores })
      .from(schema.mediaItems)
      .innerJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(and(
        eq(schema.mediaItems.type, 'episode'),
        eq(schema.qualityScores.needsUpgrade, 1),
        sourceEnabledSubquery(schema.mediaItems.sourceId),
        visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId),
        sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined,
        sql`media_items.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)`
      ))
      .orderBy(...getUpgradeOrder(schema.mediaItems, schema.qualityScores))
      .limit(100)

    // 4. Music Upgrades
    const musicUpgradeOrderBy = uSort === 'efficiency' ? [asc(schema.musicQualityScores.efficiencyScore), desc(schema.musicQualityScores.storageDebtBytes)] :
                          uSort === 'recent' ? [desc(schema.musicAlbums.createdAt)] :
                          uSort === 'title' ? [asc(schema.musicAlbums.title)] : [asc(schema.musicQualityScores.tierScore)]

    const musicUpgradesQuery = this.drizzle.select({ album: schema.musicAlbums, q: schema.musicQualityScores })
      .from(schema.musicAlbums)
      .innerJoin(schema.musicQualityScores, eq(schema.musicAlbums.id, schema.musicQualityScores.albumId))
      .where(and(
        eq(schema.musicQualityScores.needsUpgrade, 1),
        sourceEnabledSubquery(schema.musicAlbums.sourceId),
        visibilitySubquery(schema.musicAlbums.sourceId, schema.musicAlbums.libraryId),
        sourceId ? eq(schema.musicAlbums.sourceId, sourceId) : undefined,
        sql`music_albums.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)`
      ))
      .orderBy(...musicUpgradeOrderBy)
      .limit(100)

    // 5. Incomplete Collections
    const collectionsQuery = this.drizzle.select().from(schema.movieCollections)
      .where(and(
        lt(schema.movieCollections.completenessPercentage, 100),
        sourceEnabledSubquery(schema.movieCollections.sourceId),
        visibilitySubquery(schema.movieCollections.sourceId, schema.movieCollections.libraryId),
        sourceId ? eq(schema.movieCollections.sourceId, sourceId) : undefined
      ))
      .orderBy(...getCollectionOrder())

    // 6. Incomplete Series
    const seriesQuery = this.drizzle.select().from(schema.seriesCompleteness)
      .where(and(
        lt(schema.seriesCompleteness.completenessPercentage, 100),
        sourceEnabledSubquery(schema.seriesCompleteness.sourceId),
        visibilitySubquery(schema.seriesCompleteness.sourceId, schema.seriesCompleteness.libraryId),
        sourceId ? eq(schema.seriesCompleteness.sourceId, sourceId) : undefined
      ))
      .orderBy(...getSeriesOrder())

    // 7. Incomplete Artists
    const artistsQuery = this.drizzle.select().from(schema.artistCompleteness)
      .where(and(
        lt(schema.artistCompleteness.completenessPercentage, 100),
        exists(
          this.drizzle.select().from(schema.musicArtists)
            .where(and(
              eq(schema.musicArtists.name, schema.artistCompleteness.artistName),
              sourceEnabledSubquery(schema.musicArtists.sourceId),
              visibilitySubquery(schema.musicArtists.sourceId, schema.musicArtists.libraryId)
            ))
        )
      ))
      .orderBy(...getArtistOrder())

    // Parallel execution
    const [
      movieUpgradesRows, tvUpgradesRows, musicUpgradesRows,
      collectionsRows, seriesRows, artistsRows,
      collEx, serEx, artEx
    ] = await Promise.all([
      movieUpgradesQuery.all(),
      tvUpgradesQuery.all(),
      musicUpgradesQuery.all(),
      collectionsQuery.all(),
      seriesQuery.all(),
      artistsQuery.all(),
      this.drizzle.select({ reference_key: schema.exclusions.referenceKey, parent_key: schema.exclusions.parentKey }).from(schema.exclusions).where(eq(schema.exclusions.exclusionType, 'collection_movie')).all(),
      this.drizzle.select({ reference_key: schema.exclusions.referenceKey, parent_key: schema.exclusions.parentKey }).from(schema.exclusions).where(eq(schema.exclusions.exclusionType, 'series_episode')).all(),
      this.drizzle.select({ reference_key: schema.exclusions.referenceKey, parent_key: schema.exclusions.parentKey }).from(schema.exclusions).where(eq(schema.exclusions.exclusionType, 'artist_album')).all()
    ])

    // Mapper helper
    const mapItem = (r: any) => ({ ...r.item, quality_tier: r.q.qualityTier, tier_quality: r.q.tierQuality, tier_score: r.q.tierScore, efficiency_score: r.q.efficiencyScore, storage_debt_bytes: r.q.storageDebtBytes })

    // Process Collections exclusions
    const incompleteCollections: MovieCollection[] = []
    for (const c of collectionsRows) {
      const missing = JSON.parse(c.missingMovies || '[]')
      const filtered = missing.filter((m: any) => !collEx.some(ex => ex.reference_key === String(m.tmdb_id) && ex.parent_key === String(c.tmdbCollectionId)))
      const owned = c.ownedMovies || 0
      const total = owned + filtered.length
      const completeness = total > 0 ? (owned / total) * 100 : 100
      if (completeness < 100 && total > 1) {
        incompleteCollections.push({ 
          ...c, 
          tmdb_collection_id: c.tmdbCollectionId, collection_name: c.collectionName, source_id: c.sourceId, library_id: c.libraryId,
          total_movies: total, owned_movies: owned, missing_movies: JSON.stringify(filtered), 
          completeness_percentage: completeness, poster_url: c.posterUrl || undefined, backdrop_url: c.backdropUrl || undefined
        } as any)
      }
    }

    // 8. Storage Waste
    const storageWasteRows = await this.drizzle.select({ item: schema.mediaItems, q: schema.qualityScores })
      .from(schema.mediaItems)
      .innerJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(and(
        sql`quality_scores.storage_debt_bytes > 1073741824`,
        sourceEnabledSubquery(schema.mediaItems.sourceId),
        visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId),
        sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined,
        sql`media_items.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'cleanup_radar' AND reference_id IS NOT NULL)`
      ))
      .orderBy(desc(schema.qualityScores.storageDebtBytes))
      .limit(50)
      .all()

    return {
      movieUpgrades: movieUpgradesRows.map(mapItem) as any,
      tvUpgrades: tvUpgradesRows.map(mapItem) as any,
      musicUpgrades: musicUpgradesRows.map(r => ({ ...r.album, quality_tier: r.q.qualityTier, tier_quality: r.q.tierQuality, tier_score: r.q.tierScore, efficiency_score: r.q.efficiencyScore, storage_debt_bytes: r.q.storageDebtBytes })) as any,
      incompleteCollections,
      incompleteSeries: seriesRows.filter(s => !serEx.some(ex => ex.reference_key === s.seriesTitle && ex.parent_key === s.seriesTitle)).map(s => ({ ...s, series_title: s.seriesTitle, source_id: s.sourceId, library_id: s.libraryId, total_seasons: s.totalSeasons, total_episodes: s.totalEpisodes, owned_seasons: s.ownedSeasons, owned_episodes: s.ownedEpisodes, missing_seasons: s.missingSeasons, missing_episodes: s.missingEpisodes, completeness_percentage: s.completenessPercentage, tmdb_id: s.tmdbId || undefined, poster_url: s.posterUrl || undefined })) as any,
      incompleteArtists: artistsRows.filter(a => !artEx.some(ex => ex.reference_key === a.artistName && ex.parent_key === a.artistName)).map(a => ({ ...a, artist_name: a.artistName, musicbrainz_id: a.musicbrainzId || undefined, completeness_percentage: a.completenessPercentage })) as any,
      storageWaste: storageWasteRows.map(mapItem) as any,
      settings: {
        includeEps: settingsMap['completeness_include_eps'] !== 'false',
        includeSingles: settingsMap['completeness_include_singles'] !== 'false',
        upgradeSort: settingsMap['dashboard_upgrade_sort'] || 'quality',
        collectionSort: settingsMap['dashboard_collection_sort'] || 'completeness',
        seriesSort: settingsMap['dashboard_series_sort'] || 'completeness',
        artistSort: settingsMap['dashboard_artist_sort'] || 'completeness'
      }
    }
  }

  public async getLibraryStats(sourceId?: string): Promise<{
    totalItems: number; totalMovies: number; totalEpisodes: number; totalShows: number;
    lowQualityCount: number; needsUpgradeCount: number; averageQualityScore: number;
    movieNeedsUpgradeCount: number; movieAverageQualityScore: number;
    tvNeedsUpgradeCount: number; tvAverageQualityScore: number;
  }> {
    const visibilitySubquery = (sourceCol: any, libCol: any) => sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = ${sourceCol} AND ls.library_id = ${libCol}) IS NOT 0`
    const sourceEnabledSubquery = (sourceCol: any) => sql`(SELECT is_enabled FROM media_sources s WHERE s.source_id = ${sourceCol}) = 1`

    const baseQuery = this.drizzle.select()
      .from(schema.mediaItems)
      .where(and(
        sourceEnabledSubquery(schema.mediaItems.sourceId),
        visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId),
        sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined
      ))

    const [totalItems, totalMovies, totalEpisodes, totalShows, qualityStats] = await Promise.all([
      this.drizzle.select({ count: count() }).from(baseQuery.as('b')).get(),
      this.drizzle.select({ count: count() }).from(baseQuery.as('b')).where(eq(sql`type`, 'movie')).get(),
      this.drizzle.select({ count: count() }).from(baseQuery.as('b')).where(eq(sql`type`, 'episode')).get(),
      this.drizzle.select({ count: countDistinct(schema.mediaItems.seriesTitle) }).from(schema.mediaItems).where(and(eq(schema.mediaItems.type, 'episode'), sourceEnabledSubquery(schema.mediaItems.sourceId), visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId), sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined)).get(),
      this.drizzle.select({
        lowQualityCount: sql<number>`count(CASE WHEN ${schema.qualityScores.isLowQuality} = 1 THEN 1 END)`,
        needsUpgradeCount: sql<number>`count(CASE WHEN ${schema.qualityScores.needsUpgrade} = 1 THEN 1 END)`,
        averageQualityScore: avg(schema.qualityScores.overallScore),
        movieNeedsUpgradeCount: sql<number>`count(CASE WHEN ${schema.mediaItems.type} = 'movie' AND ${schema.qualityScores.needsUpgrade} = 1 THEN 1 END)`,
        movieAverageQualityScore: sql<number>`avg(CASE WHEN ${schema.mediaItems.type} = 'movie' THEN ${schema.qualityScores.overallScore} END)`,
        tvNeedsUpgradeCount: sql<number>`count(CASE WHEN ${schema.mediaItems.type} = 'episode' AND ${schema.qualityScores.needsUpgrade} = 1 THEN 1 END)`,
        tvAverageQualityScore: sql<number>`avg(CASE WHEN ${schema.mediaItems.type} = 'episode' THEN ${schema.qualityScores.overallScore} END)`
      })
      .from(schema.mediaItems)
      .leftJoin(schema.qualityScores, eq(schema.mediaItems.id, schema.qualityScores.mediaItemId))
      .where(and(
        sourceEnabledSubquery(schema.mediaItems.sourceId),
        visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId),
        sourceId ? eq(schema.mediaItems.sourceId, sourceId) : undefined
      ))
      .get()
    ])

    return {
      totalItems: totalItems?.count || 0,
      totalMovies: totalMovies?.count || 0,
      totalEpisodes: totalEpisodes?.count || 0,
      totalShows: totalShows?.count || 0,
      lowQualityCount: qualityStats?.lowQualityCount || 0,
      needsUpgradeCount: qualityStats?.needsUpgradeCount || 0,
      averageQualityScore: Math.round(Number(qualityStats?.averageQualityScore || 0)),
      movieNeedsUpgradeCount: qualityStats?.movieNeedsUpgradeCount || 0,
      movieAverageQualityScore: Math.round(Number(qualityStats?.movieAverageQualityScore || 0)),
      tvNeedsUpgradeCount: qualityStats?.tvNeedsUpgradeCount || 0,
      tvAverageQualityScore: Math.round(Number(qualityStats?.tvAverageQualityScore || 0)),
    }
  }

  public async getItemsCountBySource(sourceId: string): Promise<number> {
    const visibilitySubquery = (sourceCol: any, libCol: any) => sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = ${sourceCol} AND ls.library_id = ${libCol}) IS NOT 0`
    
    const res = await this.drizzle.select({ count: count() })
      .from(schema.mediaItems)
      .where(and(
        eq(schema.mediaItems.sourceId, sourceId),
        visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId),
        sql`(SELECT is_enabled FROM media_sources s WHERE s.source_id = media_items.source_id) = 1`
      ))
      .get()
    return res?.count || 0
  }

  public async getSourceStats(): Promise<Array<{ sourceId: string, displayName: string, sourceType: string, itemCount: number, lastScanAt?: string }>> {
    const visibilitySubquery = (sourceCol: any, libCol: any) => sql`(SELECT is_enabled FROM library_scans ls WHERE ls.source_id = ${sourceCol} AND ls.library_id = ${libCol}) IS NOT 0`

    const rows = await this.drizzle.select({
      sourceId: schema.mediaSources.sourceId,
      displayName: schema.mediaSources.displayName,
      sourceType: schema.mediaSources.sourceType,
      lastScanAt: schema.mediaSources.lastScanAt,
      itemCount: count(schema.mediaItems.id)
    })
    .from(schema.mediaSources)
    .leftJoin(schema.mediaItems, and(
      eq(schema.mediaSources.sourceId, schema.mediaItems.sourceId),
      visibilitySubquery(schema.mediaItems.sourceId, schema.mediaItems.libraryId)
    ))
    .where(eq(schema.mediaSources.isEnabled, 1))
    .groupBy(schema.mediaSources.sourceId)
    .all()

    return rows.map(r => ({
      ...r,
      itemCount: r.itemCount || 0,
      lastScanAt: r.lastScanAt || undefined
    }))
  }

  public async getMusicCompletenessStats(sourceId?: string): Promise<MusicCompletenessStats> {
    const conditions = []
    if (sourceId) {
      conditions.push(exists(
        this.drizzle.select().from(schema.musicArtists)
          .where(and(
            eq(schema.musicArtists.name, schema.artistCompleteness.artistName),
            eq(schema.musicArtists.sourceId, sourceId)
          ))
      ))
    }

    const [stats, missingRes] = await Promise.all([
      this.drizzle.select({
        total: count(),
        analyzed: sql<number>`count(CASE WHEN last_sync_at IS NOT NULL THEN 1 END)`,
        complete: sql<number>`count(CASE WHEN completeness_percentage >= 100 THEN 1 END)`,
        incomplete: sql<number>`count(CASE WHEN completeness_percentage < 100 THEN 1 END)`,
        average: avg(schema.artistCompleteness.completenessPercentage)
      })
      .from(schema.artistCompleteness)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get(),
      this.drizzle.select({
        total: sum(sql`JSON_ARRAY_LENGTH(COALESCE(missing_albums, "[]")) + JSON_ARRAY_LENGTH(COALESCE(missing_eps, "[]")) + JSON_ARRAY_LENGTH(COALESCE(missing_singles, "[]"))`)
      })
      .from(schema.artistCompleteness)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get()
    ])

    return {
      totalArtists: stats?.total || 0,
      analyzedArtists: stats?.analyzed || 0,
      completeArtists: stats?.complete || 0,
      incompleteArtists: stats?.incomplete || 0,
      totalMissingAlbums: Number(missingRes?.total || 0),
      averageCompleteness: Math.round(Number(stats?.average || 0))
    }
  }

  public async getMusicQualityDistribution(): Promise<Record<string, number>> {
    const rows = await this.drizzle.select({
      qualityTier: schema.musicQualityScores.qualityTier,
      count: count()
    })
    .from(schema.musicQualityScores)
    .groupBy(schema.musicQualityScores.qualityTier)
    .all()

    const distribution: Record<string, number> = { HI_RES: 0, LOSSLESS: 0, LOSSY_HIGH: 0, LOSSY_MID: 0, LOSSY_LOW: 0 }
    rows.forEach(r => { if (r.qualityTier in distribution) distribution[r.qualityTier] = r.count })
    return distribution
  }
}
