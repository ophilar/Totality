import type { Database } from 'sql.js'
import type {
  MediaItem,
  SeriesCompleteness,
  TVShowSummary,
  TVShowFilters,
} from '../../../types/database'

type SaveCallback = () => Promise<void>

export class CompletenessRepository {
  constructor(
    private getDb: () => Database | null,
    private save: SaveCallback
  ) {}

  private get db(): Database {
    const db = this.getDb()
    if (!db) throw new Error('Database not initialized')
    return db
  }

  private rowsToObjects<T>(result: { columns: string[]; values: unknown[][] }): T[] {
    const { columns, values } = result
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col, index) => {
        obj[col] = row[index]
      })
      return obj as T
    })
  }

  /**
   * Insert or update series completeness data
   */
  async upsertSeriesCompleteness(
    data: Omit<SeriesCompleteness, 'id' | 'created_at' | 'updated_at'>
  ): Promise<number> {
    const sourceId = data.source_id || null
    const libraryId = data.library_id || null

    // Check if record exists - handle NULL values properly
    const checkSql = sourceId === null && libraryId === null
      ? `SELECT id FROM series_completeness WHERE series_title = ? AND source_id IS NULL AND library_id IS NULL`
      : sourceId === null
      ? `SELECT id FROM series_completeness WHERE series_title = ? AND source_id IS NULL AND library_id = ?`
      : libraryId === null
      ? `SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id IS NULL`
      : `SELECT id FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?`

    const checkParams = sourceId === null && libraryId === null
      ? [data.series_title]
      : sourceId === null
      ? [data.series_title, libraryId]
      : libraryId === null
      ? [data.series_title, sourceId]
      : [data.series_title, sourceId, libraryId]

    const existing = this.db.exec(checkSql, checkParams)
    const existingId = existing.length > 0 && existing[0].values.length > 0
      ? existing[0].values[0][0] as number
      : null

    if (existingId !== null) {
      // Update existing record
      const updateSql = `
        UPDATE series_completeness SET
          total_seasons = ?,
          total_episodes = ?,
          owned_seasons = ?,
          owned_episodes = ?,
          missing_seasons = ?,
          missing_episodes = ?,
          completeness_percentage = ?,
          tmdb_id = ?,
          poster_url = ?,
          backdrop_url = ?,
          status = ?
        WHERE id = ?
      `
      this.db.run(updateSql, [
        data.total_seasons,
        data.total_episodes,
        data.owned_seasons,
        data.owned_episodes,
        data.missing_seasons,
        data.missing_episodes,
        data.completeness_percentage,
        data.tmdb_id || null,
        data.poster_url || null,
        data.backdrop_url || null,
        data.status || null,
        existingId,
      ])
      await this.save()
      return existingId
    } else {
      // Insert new record
      const insertSql = `
        INSERT INTO series_completeness (
          series_title, source_id, library_id, total_seasons, total_episodes, owned_seasons, owned_episodes,
          missing_seasons, missing_episodes, completeness_percentage,
          tmdb_id, poster_url, backdrop_url, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      this.db.run(insertSql, [
        data.series_title,
        sourceId,
        libraryId,
        data.total_seasons,
        data.total_episodes,
        data.owned_seasons,
        data.owned_episodes,
        data.missing_seasons,
        data.missing_episodes,
        data.completeness_percentage,
        data.tmdb_id || null,
        data.poster_url || null,
        data.backdrop_url || null,
        data.status || null,
      ])

      const result = this.db.exec('SELECT last_insert_rowid() as id')
      const id = result[0].values[0][0] as number

      await this.save()
      return id
    }
  }

  /**
   * Get all series completeness records (deduplicated by series_title)
   * Returns the entry with the best completeness for each unique series
   */
  getSeriesCompleteness(sourceId?: string): SeriesCompleteness[] {
    const sourceFilter = sourceId ? ' AND source_id = ?' : ''

    // Get deduplicated series - for each series_title, return the entry with highest completeness
    const result = this.db.exec(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE 1=1${sourceFilter}
        GROUP BY series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE 1=1${sourceFilter}
      GROUP BY sc.series_title
      ORDER BY sc.series_title ASC
    `, sourceId ? [sourceId, sourceId] : [])
    if (!result.length) return []

    return this.rowsToObjects<SeriesCompleteness>(result[0])
  }

  /**
   * Get all series completeness records (for skip-recently-analyzed checks)
   * @param sourceId Optional source ID to filter by
   * @param libraryId Optional library ID to filter by
   */
  getAllSeriesCompleteness(sourceId?: string, libraryId?: string): SeriesCompleteness[] {
    let sql = 'SELECT * FROM series_completeness WHERE 1=1'
    const params: (string | null)[] = []

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<SeriesCompleteness>(result[0])
  }

  /**
   * Get series completeness by title
   * @param seriesTitle The series title to find
   * @param sourceId Optional source ID to filter by
   * @param libraryId Optional library ID to filter by
   */
  getSeriesCompletenessByTitle(seriesTitle: string, sourceId?: string, libraryId?: string): SeriesCompleteness | null {
    let sql = 'SELECT * FROM series_completeness WHERE series_title = ?'
    const params: (string | null)[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND library_id = ?'
      params.push(libraryId)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return null

    const items = this.rowsToObjects<SeriesCompleteness>(result[0])
    return items[0] || null
  }

  /**
   * Get incomplete series (completeness < 100%, deduplicated by series_title)
   * Only includes series with TMDB matches since we can't determine completeness without them
   * @param sourceId Optional source ID to filter by
   */
  getIncompleteSeries(sourceId?: string): SeriesCompleteness[] {
    const sourceFilter = sourceId ? ' AND source_id = ?' : ''
    const params: (string | null)[] = sourceId ? [sourceId, sourceId] : []

    // Get deduplicated incomplete series with TMDB matches
    const result = this.db.exec(`
      SELECT sc.*
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE tmdb_id IS NOT NULL${sourceFilter}
        GROUP BY series_title
        HAVING max_pct < 100
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL${sourceFilter}
      GROUP BY sc.series_title
      ORDER BY sc.completeness_percentage ASC
    `, params)
    if (!result.length) return []

    return this.rowsToObjects<SeriesCompleteness>(result[0])
  }

  /**
   * Delete series completeness record
   */
  async deleteSeriesCompleteness(id: number): Promise<boolean> {
    this.db.run('DELETE FROM series_completeness WHERE id = ?', [id])
    await this.save()
    return true
  }

  /**
   * Get TV shows grouped by series_title with pagination support
   */
  getTVShows(filters?: TVShowFilters): TVShowSummary[] {
    let sql = `
      SELECT
        COALESCE(m.series_title, 'Unknown Series') as series_title,
        MIN(m.sort_title) as sort_title,
        COUNT(*) as episode_count,
        COUNT(DISTINCT m.season_number) as season_count,
        MAX(m.poster_url) as poster_url,
        MIN(m.source_id) as source_id,
        MIN(m.source_type) as source_type
      FROM media_items m
      WHERE m.type = 'episode'
    `
    const params: (string | number)[] = []

    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    sql += " GROUP BY COALESCE(m.series_title, 'Unknown Series')"

    // Sorting
    const sortOrder = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    switch (filters?.sortBy) {
      case 'episode_count':
        sql += ` ORDER BY episode_count ${sortOrder}`
        break
      case 'season_count':
        sql += ` ORDER BY season_count ${sortOrder}`
        break
      default:
        sql += ` ORDER BY COALESCE(sort_title, series_title) ${sortOrder}`
    }

    // Pagination
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
      if (filters.offset) {
        sql += ' OFFSET ?'
        params.push(filters.offset)
      }
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []
    return this.rowsToObjects<TVShowSummary>(result[0])
  }

  /**
   * Count distinct TV shows matching filters
   */
  countTVShows(filters?: TVShowFilters): number {
    let sql = `
      SELECT COUNT(DISTINCT COALESCE(m.series_title, 'Unknown Series')) as count
      FROM media_items m
      WHERE m.type = 'episode'
    `
    const params: (string | number)[] = []

    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    const result = this.db.exec(sql, params)
    if (!result.length || !result[0].values.length) return 0
    return Number(result[0].values[0][0]) || 0
  }

  /**
   * Count total TV episodes matching filters
   */
  countTVEpisodes(filters?: TVShowFilters): number {
    let sql = `
      SELECT COUNT(*) as count
      FROM media_items m
      WHERE m.type = 'episode'
    `
    const params: (string | number)[] = []

    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }

    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }

    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND COALESCE(m.series_title, 'Unknown Series') NOT GLOB '[A-Za-z]*'"
      } else {
        sql += " AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) = ?"
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    if (filters?.searchQuery) {
      sql += " AND COALESCE(m.series_title, 'Unknown Series') LIKE '%' || ? || '%'"
      params.push(filters.searchQuery)
    }

    const result = this.db.exec(sql, params)
    if (!result.length || !result[0].values.length) return 0
    return Number(result[0].values[0][0]) || 0
  }

  /**
   * Get the offset (count of items before) a given letter for alphabet jump navigation.
   */
  getLetterOffset(
    table: 'movies' | 'tvshows' | 'artists' | 'albums',
    letter: string,
    filters?: { sourceId?: string; libraryId?: string }
  ): number {
    if (letter === '#') return 0

    const upperLetter = letter.toUpperCase()
    let sql: string
    const params: (string | number)[] = [upperLetter]

    if (table === 'movies') {
      sql = `
        SELECT COUNT(*) as count FROM media_items m
        LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
        WHERE m.type = 'movie' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
          AND UPPER(SUBSTR(COALESCE(m.sort_title, m.title), 1, 1)) < ?
      `
      if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND m.library_id = ?'; params.push(filters.libraryId) }
    } else if (table === 'tvshows') {
      sql = `
        SELECT COUNT(DISTINCT COALESCE(m.series_title, 'Unknown Series')) as count FROM media_items m
        WHERE m.type = 'episode'
          AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) < ?
      `
      if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND m.library_id = ?'; params.push(filters.libraryId) }
    } else if (table === 'artists') {
      sql = `
        SELECT COUNT(*) as count FROM music_artists
        WHERE UPPER(SUBSTR(COALESCE(sort_name, name), 1, 1)) < ?
      `
      if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    } else {
      sql = `
        SELECT COUNT(*) as count FROM music_albums
        WHERE UPPER(SUBSTR(title, 1, 1)) < ?
      `
      if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    }

    const result = this.db.exec(sql, params)
    if (!result.length || !result[0].values.length) return 0
    return Number(result[0].values[0][0]) || 0
  }

  /**
   * Get all episodes for a specific series
   * @param seriesTitle The series title to find episodes for
   * @param sourceId Optional source ID to filter by
   * @param libraryId Optional library ID to filter by
   */
  getEpisodesForSeries(seriesTitle: string, sourceId?: string, libraryId?: string): MediaItem[] {
    let sql = `
      SELECT m.*, q.overall_score, q.needs_upgrade, q.quality_tier, q.tier_quality, q.tier_score, q.issues
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      WHERE m.type = 'episode' AND m.series_title = ?`
    const params: (string | null)[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(libraryId)
    }

    sql += ' ORDER BY m.season_number ASC, m.episode_number ASC'

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<MediaItem>(result[0])
  }

  /**
   * Get series completeness statistics
   *
   * Note: Same series can exist in multiple sources. We deduplicate by series_title
   * and use the best (highest) completeness percentage for each unique series.
   * Series without TMDB matches (tmdb_id IS NULL) are excluded from incomplete count
   * since we can't determine their actual completeness.
   */
  getSeriesCompletenessStats(): {
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  } {
    const stats = {
      totalSeries: 0,
      completeSeries: 0,
      incompleteSeries: 0,
      totalMissingEpisodes: 0,
      averageCompleteness: 0,
    }

    // Get unique series with their best completeness (highest percentage)
    // This handles duplicates across multiple sources
    let result = this.db.exec(`
      SELECT
        series_title,
        MAX(completeness_percentage) as best_completeness,
        tmdb_id
      FROM series_completeness
      GROUP BY series_title
    `)

    if (!result.length || !result[0].values) return stats

    const uniqueSeries = result[0].values

    // Count total unique series (only those with TMDB matches)
    const seriesWithTmdb = uniqueSeries.filter(row => row[2] !== null)
    stats.totalSeries = seriesWithTmdb.length

    // Complete series (100% with TMDB match)
    stats.completeSeries = seriesWithTmdb.filter(row => (row[1] as number) === 100).length

    // Incomplete series (< 100% with TMDB match)
    stats.incompleteSeries = seriesWithTmdb.filter(row => (row[1] as number) < 100).length

    // Average completeness (only series with TMDB matches)
    if (seriesWithTmdb.length > 0) {
      const totalCompleteness = seriesWithTmdb.reduce((sum, row) => sum + (row[1] as number), 0)
      stats.averageCompleteness = Math.round(totalCompleteness / seriesWithTmdb.length)
    }

    // Calculate total missing episodes
    // For each unique series, use the entry with the best completeness to get missing episodes
    // This avoids counting missing episodes from duplicate entries
    result = this.db.exec(`
      SELECT sc.missing_episodes
      FROM series_completeness sc
      INNER JOIN (
        SELECT series_title, MAX(completeness_percentage) as max_pct
        FROM series_completeness
        WHERE tmdb_id IS NOT NULL
        GROUP BY series_title
      ) best ON sc.series_title = best.series_title AND sc.completeness_percentage = best.max_pct
      WHERE sc.tmdb_id IS NOT NULL
      GROUP BY sc.series_title
    `)

    if (result.length && result[0].values) {
      result[0].values.forEach((row) => {
        try {
          const missing = JSON.parse(row[0] as string)
          stats.totalMissingEpisodes += Array.isArray(missing) ? missing.length : 0
        } catch {
          // Ignore parse errors
        }
      })
    }

    return stats
  }
}
