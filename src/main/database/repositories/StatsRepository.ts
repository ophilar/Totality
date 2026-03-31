import type { Database } from 'better-sqlite3'

export class StatsRepository {
  constructor(private db: Database) {}

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

    const sql = `
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
    `

    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as Record<string, number> | undefined

    if (!row) {
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

    return {
      totalItems: row.totalItems || 0,
      totalMovies: row.totalMovies || 0,
      totalEpisodes: row.totalEpisodes || 0,
      totalShows: row.totalShows || 0,
      lowQualityCount: row.lowQualityCount || 0,
      needsUpgradeCount: row.needsUpgradeCount || 0,
      averageQualityScore: Math.round(row.averageQualityScore || 0),
      movieNeedsUpgradeCount: row.movieNeedsUpgradeCount || 0,
      movieAverageQualityScore: Math.round(row.movieAverageQualityScore || 0),
      tvNeedsUpgradeCount: row.tvNeedsUpgradeCount || 0,
      tvAverageQualityScore: Math.round(row.tvAverageQualityScore || 0),
    }
  }

  getMediaItemsCountBySource(sourceId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM media_items WHERE source_id = ?')
    const result = stmt.get(sourceId) as { count: number }
    return result.count
  }

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
    const totalSources = (this.db.prepare('SELECT COUNT(*) as count FROM media_sources').get() as { count: number }).count
    const enabledSources = (this.db.prepare('SELECT COUNT(*) as count FROM media_sources WHERE is_enabled = 1').get() as { count: number }).count
    const totalItems = (this.db.prepare('SELECT COUNT(*) as count FROM media_items').get() as { count: number }).count

    const bySourceRows = this.db.prepare(`
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
    `).all() as Array<{
      source_id: string
      display_name: string
      source_type: string
      item_count: number
      last_scan_at: string | null
    }>

    return {
      totalSources,
      enabledSources,
      totalItems,
      bySource: bySourceRows.map(row => ({
        sourceId: row.source_id,
        displayName: row.display_name,
        sourceType: row.source_type,
        itemCount: row.item_count || 0,
        lastScanAt: row.last_scan_at || undefined,
      })),
    }
  }
}
