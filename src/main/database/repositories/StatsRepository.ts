import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { DashboardSummary, MediaItem, MusicAlbum, MovieCollection, SeriesCompleteness, ArtistCompleteness, MusicCompletenessStats } from '../../types/database'

export class StatsRepository {
  constructor(private db: DatabaseSync) {}

  public getDashboardSummary(sourceId?: string): DashboardSummary {
    const params: SQLInputValue[] = []
    const sourceFilter = sourceId ? 'AND m.source_id = ?' : ''
    if (sourceId) params.push(sourceId)

    // 1. Settings
    const settings = this.db.prepare("SELECT key, value FROM settings WHERE key IN ('completeness_include_eps', 'completeness_include_singles', 'dashboard_upgrade_sort', 'dashboard_collection_sort', 'dashboard_series_sort', 'dashboard_artist_sort')").all() as unknown as Array<{ key: string; value: string }>
    const settingsMap = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {} as Record<string, string>)

    const uSort = settingsMap['dashboard_upgrade_sort'] || 'quality'
    
    let upgradeOrderBy = 'q.tier_score ASC'
    if (uSort === 'efficiency') {
      upgradeOrderBy = 'q.efficiency_score ASC, q.storage_debt_bytes DESC'
    } else if (uSort === 'recent') {
      upgradeOrderBy = 'm.created_at DESC'
    } else if (uSort === 'title') {
      upgradeOrderBy = 'm.title ASC'
    }

    const cSort = settingsMap['dashboard_collection_sort'] || 'completeness'
    let collOrderBy = 'completeness_percentage DESC'
    if (cSort === 'name') collOrderBy = 'collection_name ASC'
    else if (cSort === 'recent') collOrderBy = 'created_at DESC'

    const sSort = settingsMap['dashboard_series_sort'] || 'completeness'
    let seriesOrderBy = 'completeness_percentage DESC'
    if (sSort === 'name') seriesOrderBy = 'series_title ASC'
    else if (sSort === 'recent') seriesOrderBy = 'created_at DESC'

    const aSort = settingsMap['dashboard_artist_sort'] || 'completeness'
    let artistOrderBy = 'completeness_percentage DESC'
    if (aSort === 'name') artistOrderBy = 'artist_name ASC'

    // 2. Movie Upgrades
    const movieUpgradesSql = `
      SELECT m.*, q.tier_score, q.efficiency_score, q.storage_debt_bytes
      FROM media_items m
      JOIN quality_scores q ON m.id = q.media_item_id
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'movie' AND q.needs_upgrade = 1 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
      AND m.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)
      ORDER BY ${upgradeOrderBy}
      LIMIT 100
    `
    const movieUpgrades = this.db.prepare(movieUpgradesSql).all(...params) as unknown as MediaItem[]

    // 3. TV Upgrades
    const tvUpgradesSql = `
      SELECT m.*, q.tier_score, q.efficiency_score, q.storage_debt_bytes
      FROM media_items m
      JOIN quality_scores q ON m.id = q.media_item_id
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'episode' AND q.needs_upgrade = 1
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
      AND m.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)
      ORDER BY ${upgradeOrderBy}
      LIMIT 100
    `
    const tvUpgrades = this.db.prepare(tvUpgradesSql).all(...params) as unknown as MediaItem[]

    // 4. Music Upgrades
    let musicUpgradeOrderBy = 'q.tier_score ASC'
    
    if (uSort === 'efficiency') {
      musicUpgradeOrderBy = 'q.efficiency_score ASC, q.storage_debt_bytes DESC'
    } else if (uSort === 'recent') {
      musicUpgradeOrderBy = 'a.created_at DESC'
    } else if (uSort === 'title') {
      musicUpgradeOrderBy = 'a.title ASC'
    }

    const musicUpgradesSql = `
      SELECT a.*, q.tier_score, q.efficiency_score, q.storage_debt_bytes
      FROM music_albums a
      JOIN music_quality_scores q ON a.id = q.album_id
      JOIN media_sources s ON a.source_id = s.source_id
      LEFT JOIN library_scans ls ON a.source_id = ls.source_id AND a.library_id = ls.library_id
      WHERE q.needs_upgrade = 1 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceId ? 'AND a.source_id = ?' : ''}
      AND a.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)
      ORDER BY ${musicUpgradeOrderBy}
      LIMIT 100
    `
    const musicUpgrades = this.db.prepare(musicUpgradesSql).all(...(sourceId ? [sourceId] : [])) as unknown as MusicAlbum[]

    // 5. Incomplete Collections
    const collectionsSql = `
      SELECT c.* FROM movie_collections c
      JOIN media_sources s ON c.source_id = s.source_id
      LEFT JOIN library_scans ls ON c.source_id = ls.source_id AND c.library_id = ls.library_id
      WHERE c.completeness_percentage < 100 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceId ? 'AND c.source_id = ?' : ''}
      ORDER BY ${collOrderBy}
    `
    const incompleteCollectionsRaw = this.db.prepare(collectionsSql).all(...(sourceId ? [sourceId] : [])) as unknown as MovieCollection[]

    // 6. Incomplete Series
    const seriesSql = `
      SELECT sc.* FROM series_completeness sc
      JOIN media_sources s ON sc.source_id = s.source_id
      LEFT JOIN library_scans ls ON sc.source_id = ls.source_id AND sc.library_id = ls.library_id
      WHERE sc.completeness_percentage < 100 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceId ? 'AND sc.source_id = ?' : ''}
      ORDER BY ${seriesOrderBy}
    `
    const incompleteSeriesRaw = this.db.prepare(seriesSql).all(...(sourceId ? [sourceId] : [])) as unknown as SeriesCompleteness[]

    // 7. Incomplete Artists
    const artistsSql = `
      SELECT ac.* FROM artist_completeness ac
      WHERE ac.completeness_percentage < 100
      AND EXISTS (
        SELECT 1 FROM music_artists ma
        JOIN media_sources ms ON ma.source_id = ms.source_id
        LEFT JOIN library_scans ls ON ma.source_id = ls.source_id AND ma.library_id = ls.library_id
        WHERE ma.name = ac.artist_name 
        AND ms.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      )
      ORDER BY ${artistOrderBy}
    `
    const incompleteArtistsRaw = this.db.prepare(artistsSql).all() as unknown as ArtistCompleteness[]

    // Fetch Exclusions for filtering JSON arrays
    const collEx = this.db.prepare("SELECT reference_key, parent_key FROM exclusions WHERE exclusion_type = 'collection_movie'").all() as unknown as Array<{ reference_key: string; parent_key: string }>
    const serEx = this.db.prepare("SELECT reference_key, parent_key FROM exclusions WHERE exclusion_type = 'series_episode'").all() as unknown as Array<{ reference_key: string; parent_key: string }>
    const artEx = this.db.prepare("SELECT reference_key, parent_key FROM exclusions WHERE exclusion_type = 'artist_album'").all() as unknown as Array<{ reference_key: string; parent_key: string }>

    // Process Collections exclusions
    const incompleteCollections: MovieCollection[] = []
    for (const c of incompleteCollectionsRaw) {
      const missing = JSON.parse(c.missing_movies || '[]')
      const filtered = missing.filter((m: any) => !collEx.some(ex => ex.reference_key === String(m.tmdb_id) && ex.parent_key === String(c.tmdb_collection_id)))
      const owned = c.owned_movies || 0
      const total = owned + filtered.length
      const completeness = total > 0 ? (owned / total) * 100 : 100
      if (completeness < 100 && total > 1) {
        incompleteCollections.push({
          ...c,
          missing_movies: JSON.stringify(filtered),
          total_movies: total,
          completeness_percentage: completeness
        })
      }
    }

    // Process Series exclusions
    const incompleteSeries: SeriesCompleteness[] = []
    for (const s of incompleteSeriesRaw) {
      const missing = JSON.parse(s.missing_episodes || '[]')
      const filtered = missing.filter((e: any) => {
        const key = `S${e.season_number}E${e.episode_number}`
        return !serEx.some(ex => ex.reference_key === key && ex.parent_key === (s.tmdb_id || s.series_title))
      })
      if (filtered.length > 0) {
        incompleteSeries.push({
          ...s,
          missing_episodes: JSON.stringify(filtered)
        })
      }
    }

    // Process Artists exclusions
    const includeEps = settingsMap['completeness_include_eps'] !== 'false'
    const includeSingles = settingsMap['completeness_include_singles'] !== 'false'
    const incompleteArtists: ArtistCompleteness[] = []

    for (const a of incompleteArtistsRaw) {
      const filterJson = (json: string) => {
        const items = JSON.parse(json || '[]')
        return items.filter((item: any) => !artEx.some(ex => ex.reference_key === item.musicbrainz_id && ex.parent_key === (a.musicbrainz_id || a.artist_name)))
      }

      const filteredAlbums = filterJson(a.missing_albums)
      const filteredEps = filterJson(a.missing_eps)
      const filteredSingles = filterJson(a.missing_singles)

      const hasAlbums = filteredAlbums.length > 0
      const hasEps = includeEps && filteredEps.length > 0
      const hasSingles = includeSingles && filteredSingles.length > 0

      if (hasAlbums || hasEps || hasSingles) {
        incompleteArtists.push({
          ...a,
          missing_albums: JSON.stringify(filteredAlbums),
          missing_eps: JSON.stringify(filteredEps),
          missing_singles: JSON.stringify(filteredSingles)
        })
      }
    }

    // 8. Storage Waste
    const wasteSql = `
      SELECT m.*, q.storage_debt_bytes
      FROM media_items m
      JOIN quality_scores q ON m.id = q.media_item_id
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE q.storage_debt_bytes > 1073741824
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
      AND m.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'cleanup_radar' AND reference_id IS NOT NULL)
      ORDER BY q.storage_debt_bytes DESC
      LIMIT 50
    `
    const storageWaste = this.db.prepare(wasteSql).all(...params) as unknown as MediaItem[]

    return {
      movieUpgrades,
      tvUpgrades,
      musicUpgrades,
      incompleteCollections,
      incompleteSeries,
      incompleteArtists,
      storageWaste,
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

  public getAggregatedSourceStats(): {
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
    const sources = this.getSourceStats()
    const allSources = this.db.prepare('SELECT is_enabled FROM media_sources').all() as unknown as Array<{ is_enabled: number }>

    return {
      totalSources: allSources.length,
      enabledSources: allSources.filter((s) => s.is_enabled === 1).length,
      totalItems: sources.reduce((acc, s) => acc + s.itemCount, 0),
      bySource: sources
    }
  }

  public getLibraryStats(sourceId?: string): {
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
    const params: SQLInputValue[] = []
    const sourceFilter = sourceId ? 'AND m.source_id = ?' : ''
    if (sourceId) params.push(sourceId)

    const totalItemsRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as unknown as { count: number } | undefined
    
    const totalMoviesRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'movie' 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as unknown as { count: number } | undefined
    
    const totalEpisodesRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'episode' 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as unknown as { count: number } | undefined
    
    const totalShowsRow = this.db.prepare(`
      SELECT COUNT(DISTINCT series_title) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'episode' 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as unknown as { count: number } | undefined

    const qualityStatsRow = this.db.prepare(`
      SELECT 
        COUNT(CASE WHEN q.is_low_quality = 1 THEN 1 END) as lowQualityCount,
        COUNT(CASE WHEN q.needs_upgrade = 1 THEN 1 END) as needsUpgradeCount,
        AVG(q.overall_score) as averageQualityScore,
        COUNT(CASE WHEN m.type = 'movie' AND q.needs_upgrade = 1 THEN 1 END) as movieNeedsUpgradeCount,
        AVG(CASE WHEN m.type = 'movie' THEN q.overall_score END) as movieAverageQualityScore,
        COUNT(CASE WHEN m.type = 'episode' AND q.needs_upgrade = 1 THEN 1 END) as tvNeedsUpgradeCount,
        AVG(CASE WHEN m.type = 'episode' THEN q.overall_score END) as tvAverageQualityScore
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as unknown as {
      lowQualityCount: number
      needsUpgradeCount: number
      averageQualityScore: number
      movieNeedsUpgradeCount: number
      movieAverageQualityScore: number
      tvNeedsUpgradeCount: number
      tvAverageQualityScore: number
    } | undefined

    return {
      totalItems: totalItemsRow?.count || 0,
      totalMovies: totalMoviesRow?.count || 0,
      totalEpisodes: totalEpisodesRow?.count || 0,
      totalShows: totalShowsRow?.count || 0,
      lowQualityCount: qualityStatsRow?.lowQualityCount || 0,
      needsUpgradeCount: qualityStatsRow?.needsUpgradeCount || 0,
      averageQualityScore: Math.round(qualityStatsRow?.averageQualityScore || 0),
      movieNeedsUpgradeCount: qualityStatsRow?.movieNeedsUpgradeCount || 0,
      movieAverageQualityScore: Math.round(qualityStatsRow?.movieAverageQualityScore || 0),
      tvNeedsUpgradeCount: qualityStatsRow?.tvNeedsUpgradeCount || 0,
      tvAverageQualityScore: Math.round(qualityStatsRow?.tvAverageQualityScore || 0),
    }
  }

  getItemsCountBySource(sourceId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.source_id = ?
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
    `).get(sourceId) as unknown as { count: number } | undefined
    return row?.count || 0
  }

  getSourceStats(): Array<{
    sourceId: string
    displayName: string
    sourceType: string
    itemCount: number
    lastScanAt?: string
  }> {
    const rows = this.db.prepare(`
      SELECT s.source_id, s.display_name, s.source_type, s.last_scan_at, COUNT(m.id) as item_count
      FROM media_sources s
      LEFT JOIN media_items m ON s.source_id = m.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      GROUP BY s.source_id
    `).all() as unknown as any[]

    return rows.map(row => ({
      sourceId: row.source_id,
      displayName: row.display_name,
      sourceType: row.source_type,
      itemCount: row.item_count || 0,
      lastScanAt: row.last_scan_at || undefined,
    }))
  }

  public getMusicCompletenessStats(sourceId?: string): MusicCompletenessStats {
    let sqlTotal = 'SELECT COUNT(*) as count FROM artist_completeness'
    let sqlAnalyzed = 'SELECT COUNT(*) as count FROM artist_completeness WHERE last_sync_at IS NOT NULL'
    let sqlComplete = 'SELECT COUNT(*) as count FROM artist_completeness WHERE completeness_percentage >= 100'
    let sqlIncomplete = 'SELECT COUNT(*) as count FROM artist_completeness WHERE completeness_percentage < 100'
    let sqlMissing = 'SELECT SUM(total_missing) as total FROM (SELECT (JSON_ARRAY_LENGTH(COALESCE(missing_albums, "[]")) + JSON_ARRAY_LENGTH(COALESCE(missing_eps, "[]")) + JSON_ARRAY_LENGTH(COALESCE(missing_singles, "[]"))) as total_missing FROM artist_completeness)'
    let sqlAvg = 'SELECT AVG(completeness_percentage) as avg FROM artist_completeness'

    if (sourceId) {
      const join = ' INNER JOIN music_artists ma ON artist_completeness.artist_name = ma.name AND ma.source_id = ?'
      sqlTotal += join
      sqlAnalyzed += join
      sqlComplete += join
      sqlIncomplete += join
      sqlMissing = `
        SELECT SUM(JSON_ARRAY_LENGTH(COALESCE(ac.missing_albums, "[]")) + JSON_ARRAY_LENGTH(COALESCE(ac.missing_eps, "[]")) + JSON_ARRAY_LENGTH(COALESCE(ac.missing_singles, "[]"))) as total
        FROM artist_completeness ac
        INNER JOIN music_artists ma ON ac.artist_name = ma.name AND ma.source_id = ?
      `
      sqlAvg += join
    }

    const params = sourceId ? [sourceId] : []
    const total = (this.db.prepare(sqlTotal).get(...params) as unknown as { count: number } | undefined)?.count || 0
    const analyzed = (this.db.prepare(sqlAnalyzed).get(...params) as unknown as { count: number } | undefined)?.count || 0
    const complete = (this.db.prepare(sqlComplete).get(...params) as unknown as { count: number } | undefined)?.count || 0
    const incomplete = (this.db.prepare(sqlIncomplete).get(...params) as unknown as { count: number } | undefined)?.count || 0
    const missing = (this.db.prepare(sqlMissing).get(...params) as unknown as { total: number } | undefined)?.total || 0
    const avg = (this.db.prepare(sqlAvg).get(...params) as unknown as { avg: number } | undefined)?.avg || 0

    return {
      totalArtists: total,
      analyzedArtists: analyzed,
      completeArtists: complete,
      incompleteArtists: incomplete,
      totalMissingAlbums: missing,
      averageCompleteness: Math.round(avg)
    }
  }

  public getMusicQualityDistribution(): Record<string, number> {
    const rows = this.db.prepare('SELECT quality_tier, COUNT(*) as count FROM music_quality_scores GROUP BY quality_tier').all() as unknown as Array<{ quality_tier: string; count: number }>
    const distribution: Record<string, number> = {
      HI_RES: 0, LOSSLESS: 0, LOSSY_HIGH: 0, LOSSY_MID: 0, LOSSY_LOW: 0
    }
    for (const row of rows) {
      if (row.quality_tier in distribution) {
        distribution[row.quality_tier] = row.count
      }
    }
    return distribution
  }
}
