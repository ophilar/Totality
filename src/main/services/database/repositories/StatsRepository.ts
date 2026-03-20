import type { Database } from 'sql.js'

export class StatsRepository {
  constructor(private getDb: () => Database | null) {}

  private get db(): Database {
    const db = this.getDb()
    if (!db) throw new Error('Database not initialized')
    return db
  }

  /**
   * Get library statistics (optimized single query)
   */
  getLibraryStats(sourceId?: string): {
    totalItems: number
    totalMovies: number
    totalEpisodes: number
    totalShows: number
    lowQualityCount: number
    needsUpgradeCount: number
    averageQualityScore: number
    movieNeedsUpgradeCount: number
    movieAverageQualityScore: number
    tvNeedsUpgradeCount: number
    tvAverageQualityScore: number
  } {
    const whereClause = sourceId ? ' WHERE m.source_id = ?' : ''
    const params = sourceId ? [sourceId] : []

    const result = this.db.exec(`
      SELECT
        COUNT(*) as totalItems,
        SUM(CASE WHEN m.type = 'movie' THEN 1 ELSE 0 END) as totalMovies,
        SUM(CASE WHEN m.type = 'episode' THEN 1 ELSE 0 END) as totalEpisodes,
        COUNT(DISTINCT CASE WHEN m.type = 'episode' THEN m.series_title END) as totalShows,
        SUM(CASE WHEN q.is_low_quality = 1 THEN 1 ELSE 0 END) as lowQualityCount,
        SUM(CASE WHEN q.needs_upgrade = 1 THEN 1 ELSE 0 END) as needsUpgradeCount,
        COALESCE(AVG(q.overall_score), 0) as averageQualityScore,
        SUM(CASE WHEN m.type = 'movie' AND q.needs_upgrade = 1 THEN 1 ELSE 0 END) as movieNeedsUpgradeCount,
        COALESCE(AVG(CASE WHEN m.type = 'movie' THEN q.overall_score END), 0) as movieAverageQualityScore,
        SUM(CASE WHEN m.type = 'episode' AND q.needs_upgrade = 1 THEN 1 ELSE 0 END) as tvNeedsUpgradeCount,
        COALESCE(AVG(CASE WHEN m.type = 'episode' THEN q.overall_score END), 0) as tvAverageQualityScore
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      ${whereClause}
    `, params)

    if (!result.length || !result[0].values.length) {
      return {
        totalItems: 0,
        totalMovies: 0,
        totalEpisodes: 0,
        totalShows: 0,
        lowQualityCount: 0,
        needsUpgradeCount: 0,
        averageQualityScore: 0,
        movieNeedsUpgradeCount: 0,
        movieAverageQualityScore: 0,
        tvNeedsUpgradeCount: 0,
        tvAverageQualityScore: 0,
      }
    }

    const row = result[0].values[0]
    return {
      totalItems: (row[0] as number) || 0,
      totalMovies: (row[1] as number) || 0,
      totalEpisodes: (row[2] as number) || 0,
      totalShows: (row[3] as number) || 0,
      lowQualityCount: (row[4] as number) || 0,
      needsUpgradeCount: (row[5] as number) || 0,
      averageQualityScore: Math.round((row[6] as number) || 0),
      movieNeedsUpgradeCount: (row[7] as number) || 0,
      movieAverageQualityScore: Math.round((row[8] as number) || 0),
      tvNeedsUpgradeCount: (row[9] as number) || 0,
      tvAverageQualityScore: Math.round((row[10] as number) || 0),
    }
  }

  /**
   * Get media items count by source
   */
  getMediaItemsCountBySource(sourceId: string): number {
    const result = this.db.exec(
      'SELECT COUNT(*) FROM media_items WHERE source_id = ?',
      [sourceId]
    )

    return (result[0]?.values[0]?.[0] as number) || 0
  }

  /**
   * Get aggregated stats across all sources
   */
  getAggregatedSourceStats(): {
    totalSources: number
    enabledSources: number
    totalItems: number
    bySource: Array<{
      sourceId: string
      displayName: string
      sourceType: string
      itemCount: number
      lastScanAt?: string
    }>
  } {
    const stats = {
      totalSources: 0,
      enabledSources: 0,
      totalItems: 0,
      bySource: [] as Array<{
        sourceId: string
        displayName: string
        sourceType: string
        itemCount: number
        lastScanAt?: string
      }>,
    }

    // Total sources
    let result = this.db.exec('SELECT COUNT(*) FROM media_sources')
    stats.totalSources = (result[0]?.values[0]?.[0] as number) || 0

    // Enabled sources
    result = this.db.exec('SELECT COUNT(*) FROM media_sources WHERE is_enabled = 1')
    stats.enabledSources = (result[0]?.values[0]?.[0] as number) || 0

    // Total items
    result = this.db.exec('SELECT COUNT(*) FROM media_items')
    stats.totalItems = (result[0]?.values[0]?.[0] as number) || 0

    // Items by source
    result = this.db.exec(`
      SELECT
        s.source_id,
        s.display_name,
        s.source_type,
        COUNT(m.id) as item_count,
        s.last_scan_at
      FROM media_sources s
      LEFT JOIN media_items m ON s.source_id = m.source_id
      GROUP BY s.source_id
      ORDER BY s.display_name ASC
    `)

    if (result.length && result[0].values) {
      stats.bySource = result[0].values.map(row => ({
        sourceId: row[0] as string,
        displayName: row[1] as string,
        sourceType: row[2] as string,
        itemCount: (row[3] as number) || 0,
        lastScanAt: row[4] as string | undefined,
      }))
    }

    return stats
  }
}
