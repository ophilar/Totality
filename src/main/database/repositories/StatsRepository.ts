import type { DatabaseSync } from 'node:sqlite'
import type { DashboardSummary, MediaItem, MusicAlbum, MovieCollection, SeriesCompleteness, ArtistCompleteness } from '../../types/database'

export class StatsRepository {
  constructor(private db: DatabaseSync) {}

  public getDashboardSummary(sourceId?: string): DashboardSummary {
    const params: any[] = []
    const sourceFilter = sourceId ? 'AND m.source_id = ?' : ''
    if (sourceId) params.push(sourceId)

    // 1. Settings
    const settings = this.db.prepare("SELECT key, value FROM settings WHERE key IN ('completeness_include_eps', 'completeness_include_singles', 'dashboard_upgrade_sort', 'dashboard_collection_sort', 'dashboard_series_sort', 'dashboard_artist_sort')").all() as any[]
    const settingsMap = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {} as any)

    const uSort = settingsMap['dashboard_upgrade_sort'] || 'quality'
    let upgradeOrderBy = 'q.tier_score ASC'
    if (uSort === 'efficiency') upgradeOrderBy = 'q.efficiency_score ASC, q.storage_debt_bytes DESC'
    else if (uSort === 'recent') upgradeOrderBy = 'm.created_at DESC'
    else if (uSort === 'title') upgradeOrderBy = 'm.title ASC'

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
    const movieUpgrades = (this.db.prepare(movieUpgradesSql).all(...params) as any) as MediaItem[]

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
    const tvUpgrades = (this.db.prepare(tvUpgradesSql).all(...params) as any) as MediaItem[]

    // 4. Music Upgrades
    let musicUpgradeOrderBy = 'q.tier_score ASC'
    if (uSort === 'efficiency') musicUpgradeOrderBy = 'q.efficiency_score ASC, q.storage_debt_bytes DESC'
    else if (uSort === 'recent') musicUpgradeOrderBy = 'a.created_at DESC'
    else if (uSort === 'title') musicUpgradeOrderBy = 'a.title ASC'

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
    const musicUpgrades = (this.db.prepare(musicUpgradesSql).all(...(sourceId ? [sourceId] : [])) as any) as MusicAlbum[]

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
    const incompleteCollectionsRaw = (this.db.prepare(collectionsSql).all(...(sourceId ? [sourceId] : [])) as any) as MovieCollection[]

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
    const incompleteSeriesRaw = (this.db.prepare(seriesSql).all(...(sourceId ? [sourceId] : [])) as any) as SeriesCompleteness[]

    // 7. Incomplete Artists
    const artistsSql = `
      SELECT ac.* FROM artist_completeness ac
      JOIN media_sources s ON ac.artist_name = (SELECT name FROM music_artists WHERE name = ac.artist_name LIMIT 1) -- This is a bit complex due to artist_name join
      -- Simplified: just check if the artist exists in any enabled source
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
    const incompleteArtistsRaw = (this.db.prepare(artistsSql).all() as any) as ArtistCompleteness[]

    // Fetch Exclusions for filtering JSON arrays
    const collEx = this.db.prepare("SELECT reference_key, parent_key FROM exclusions WHERE exclusion_type = 'collection_movie'").all() as any[]
    const serEx = this.db.prepare("SELECT reference_key, parent_key FROM exclusions WHERE exclusion_type = 'series_episode'").all() as any[]
    const artEx = this.db.prepare("SELECT reference_key, parent_key FROM exclusions WHERE exclusion_type = 'artist_album'").all() as any[]

    // Process Collections exclusions
    const incompleteCollections: MovieCollection[] = []
    for (const c of incompleteCollectionsRaw) {
      const missing = JSON.parse(c.missing_movies)
      const filtered = missing.filter((m: any) => !collEx.some(ex => ex.reference_key === String(m.tmdb_id) && ex.parent_key === String(c.tmdb_collection_id)))
      const owned = c.owned_movies
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
      const missing = JSON.parse(s.missing_episodes)
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
        const items = JSON.parse(json)
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
    const storageWaste = (this.db.prepare(wasteSql).all(...params) as any) as MediaItem[]

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
    const allSources = this.db.prepare('SELECT is_enabled FROM media_sources').all() as any[]

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
    const params: any[] = []
    const sourceFilter = sourceId ? 'AND m.source_id = ?' : ''
    if (sourceId) params.push(sourceId)

    const totalItemsRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as any
    
    const totalMoviesRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'movie' 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as any
    
    const totalEpisodesRow = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'episode' 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as any
    
    const totalShowsRow = this.db.prepare(`
      SELECT COUNT(DISTINCT series_title) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.type = 'episode' 
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
      ${sourceFilter}
    `).get(...params) as any

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
    `).get(...params) as any

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

  getMediaItemsCountBySource(sourceId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM media_items m
      JOIN media_sources s ON m.source_id = s.source_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE m.source_id = ?
      AND s.is_enabled = 1 AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
    `).get(sourceId) as any
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
    `).all() as any[]

    return rows.map(row => ({
      sourceId: row.source_id,
      displayName: row.display_name,
      sourceType: row.source_type,
      itemCount: row.item_count || 0,
      lastScanAt: row.last_scan_at || undefined,
    }))
  }
}
