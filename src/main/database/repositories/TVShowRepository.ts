import type { Database } from 'better-sqlite3'
import type { TVShowSummary, TVShowFilters, SeriesCompleteness, MediaItem } from '../../types/database'
import { BaseRepository } from './BaseRepository'

export class TVShowRepository extends BaseRepository<SeriesCompleteness> {
  constructor(db: Database) {
    super(db, 'series_completeness')
  }

  getTVShowSummaries(filters?: TVShowFilters & { completenessFilter?: string }): TVShowSummary[] {
    let sql = `
      SELECT sc.*, 
             (SELECT COUNT(*) FROM media_items m WHERE m.series_title = sc.series_title AND m.type = 'episode' AND m.source_id = sc.source_id) as current_episodes
      FROM series_completeness sc
      WHERE 1=1
    `
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND sc.source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.libraryId) {
      sql += ' AND sc.library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND sc.series_title LIKE ?'
      params.push(`%${filters.searchQuery}%`)
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND sc.series_title NOT GLOB '[A-Za-z]*'"
      } else {
        sql += ' AND UPPER(SUBSTR(sc.series_title, 1, 1)) = ?'
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }
    if (filters?.completenessFilter) {
      if (filters.completenessFilter === 'complete') sql += ' AND sc.completeness_percentage >= 100'
      else if (filters.completenessFilter === 'incomplete') sql += ' AND sc.completeness_percentage < 100'
    }

    const sortMap: Record<string, string> = {
      'title': 'sc.series_title',
      'completeness': 'sc.completeness_percentage',
      'episodes': 'sc.total_episodes',
      'debt': 'sc.storage_debt_bytes',
      'efficiency': 'sc.efficiency_score'
    }
    const sortCol = sortMap[filters?.sortBy || 'title'] || 'sc.series_title'
    const sortDir = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    sql += ` ORDER BY ${sortCol} ${sortDir}`

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as TVShowSummary[]
  }

  countTVShows(filters?: TVShowFilters): number {
    let sql = 'SELECT COUNT(*) as count FROM series_completeness WHERE 1=1'
    const params: unknown[] = []

    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND series_title LIKE ?'
      params.push(`%${filters.searchQuery}%`)
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND series_title NOT GLOB '[A-Za-z]*'"
      } else {
        sql += ' AND UPPER(SUBSTR(series_title, 1, 1)) = ?'
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result?.count || 0
  }

  getTVShowEpisodes(seriesTitle: string, sourceId?: string): MediaItem[] {
    let sql = `
      SELECT m.*, q.quality_tier, q.tier_quality, q.tier_score, q.efficiency_score, q.storage_debt_bytes
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      WHERE m.series_title = ? AND m.type = 'episode'
    `
    const params: unknown[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(sourceId)
    }

    sql += ' ORDER BY m.season_number ASC, m.episode_number ASC'
    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MediaItem[]
  }

  getSeriesCompletenessByTitle(title: string, sourceId: string, libraryId: string): SeriesCompleteness | null {
    const sql = 'SELECT * FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ?'
    return this.queryOne<SeriesCompleteness>(sql, [title, sourceId, libraryId])
  }

  upsertSeriesCompleteness(data: SeriesCompleteness): number {
    const stmt = this.db.prepare(`
      INSERT INTO series_completeness (
        series_title, source_id, library_id, total_seasons, total_episodes,
        owned_seasons, owned_episodes, missing_seasons, missing_episodes,
        completeness_percentage, tmdb_id, poster_url, backdrop_url, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(series_title, source_id, library_id) DO UPDATE SET
        total_seasons = excluded.total_seasons,
        total_episodes = excluded.total_episodes,
        owned_seasons = excluded.owned_seasons,
        owned_episodes = excluded.owned_episodes,
        missing_seasons = excluded.missing_seasons,
        missing_episodes = excluded.missing_episodes,
        completeness_percentage = excluded.completeness_percentage,
        tmdb_id = COALESCE(excluded.tmdb_id, series_completeness.tmdb_id),
        poster_url = COALESCE(excluded.poster_url, series_completeness.poster_url),
        backdrop_url = COALESCE(excluded.backdrop_url, series_completeness.backdrop_url),
        status = COALESCE(excluded.status, series_completeness.status),
        updated_at = datetime('now')
      RETURNING id
    `)

    const row = stmt.get(
      data.series_title,
      data.source_id || '',
      data.library_id || '',
      data.total_seasons,
      data.total_episodes,
      data.owned_seasons,
      data.owned_episodes,
      data.missing_seasons || '[]',
      data.missing_episodes || '[]',
      data.completeness_percentage,
      data.tmdb_id || null,
      data.poster_url || null,
      data.backdrop_url || null,
      data.status || null
    ) as { id: number } | undefined

    return row?.id || 0
  }
}
