// @ts-nocheck
import type { DatabaseSync } from 'node:sqlite'
import type { MediaItem, MediaItemFilters } from '../../types/database'
import { BaseRepository } from './BaseRepository'

export class MediaRepository extends BaseRepository<MediaItem> {
  constructor(db: DatabaseSync) {
    super(db, 'media_items')
  }

  getMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): MediaItem[] {
    let sql = `
      SELECT m.*,
             q.overall_score, q.needs_upgrade,
             q.quality_tier, q.tier_quality, q.tier_score,
             q.efficiency_score, q.storage_debt_bytes, q.issues
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE 1=1
    `
    const params: unknown[] = []

    if (!filters?.includeDisabledLibraries) {
      sql += ' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)'
    }

    if (filters?.type) {
      sql += ' AND m.type = ?'
      params.push(filters.type)
    }
    if (filters?.sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.sourceType) {
      sql += ' AND m.source_type = ?'
      params.push(filters.sourceType)
    }
    if (filters?.libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND (m.title LIKE ? OR m.series_title LIKE ?)'
      const search = `%${filters.searchQuery}%`
      params.push(search, search)
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND m.title NOT GLOB '[A-Za-z]*'"
      } else {
        sql += ' AND UPPER(SUBSTR(m.title, 1, 1)) = ?'
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }
    if (filters?.qualityTier) {
      sql += ' AND q.quality_tier = ?'
      params.push(filters.qualityTier)
    }
    if (filters?.tierQuality) {
      sql += ' AND q.tier_quality = ?'
      params.push(filters.tierQuality)
    }
    if (filters?.efficiencyFilter) {
      if (filters.efficiencyFilter === 'low') sql += ' AND q.efficiency_score < 60'
      else if (filters.efficiencyFilter === 'medium') sql += ' AND q.efficiency_score >= 60 AND q.efficiency_score < 85'
      else if (filters.efficiencyFilter === 'high') sql += ' AND q.efficiency_score >= 85'
    }
    if (filters?.slimDown) {
      // Show highly inefficient or heavily wasteful items
      sql += ' AND (q.efficiency_score < 60 OR q.storage_debt_bytes > 5368709120)' // 5GB debt threshold
    }
    if (filters?.needsUpgrade !== undefined) {
      sql += ' AND q.needs_upgrade = ?'
      params.push(filters.needsUpgrade ? 1 : 0)
      if (filters.needsUpgrade) {
        sql += ` AND m.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)`
      }
    }

    const sortColumnMap: Record<string, string> = {
      'title': 'COALESCE(m.sort_title, m.title)',
      'year': 'm.year',
      'updated_at': 'm.updated_at',
      'created_at': 'm.created_at',
      'tier_score': 'q.tier_score',
      'overall_score': 'q.overall_score',
      'size': 'm.file_size',
      'storage_debt': 'q.storage_debt_bytes',
      'efficiency': 'q.efficiency_score'
    }
    const sortColumn = sortColumnMap[filters?.sortBy || 'title'] || 'COALESCE(m.sort_title, m.title)'
    const sortOrder = filters?.sortOrder?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    sql += ` ORDER BY ${sortColumn} ${sortOrder}`

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MediaItem[]
  }

  getMediaItem(id: number): MediaItem | null {
    const sql = `
      SELECT m.*,
             q.overall_score, q.needs_upgrade,
             q.quality_tier, q.tier_quality, q.tier_score,
             q.efficiency_score, q.storage_debt_bytes, q.issues
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      WHERE m.id = ?
    `
    return this.queryOne<MediaItem>(sql, [id])
  }

  getMediaItemById(id: number): MediaItem | null {
    return this.getMediaItem(id)
  }

  updateMediaItemPathAndStats(mediaItemId: number, newPath: string, analysis: any): void {
    this.db.prepare(`
      UPDATE media_items 
      SET file_path = ?, 
          file_size = ?, 
          duration = ?, 
          resolution = ?, 
          width = ?, 
          height = ?, 
          video_codec = ?, 
          video_bitrate = ?, 
          audio_codec = ?, 
          audio_channels = ?, 
          audio_bitrate = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      newPath,
      analysis.fileSize || 0,
      analysis.duration || 0,
      analysis.video?.resolution || 'unknown',
      analysis.video?.width || 0,
      analysis.video?.height || 0,
      analysis.video?.codec || 'unknown',
      analysis.video?.bitrate || 0,
      analysis.audioTracks?.[0]?.codec || 'unknown',
      analysis.audioTracks?.[0]?.channels || 0,
      analysis.audioTracks?.[0]?.bitrate || 0,
      mediaItemId
    )
  }

  getMediaItemByPath(filePath: string): MediaItem | null {
    const sql = `
      SELECT m.*,
             q.overall_score, q.needs_upgrade,
             q.quality_tier, q.tier_quality, q.tier_score,
             q.efficiency_score, q.storage_debt_bytes, q.issues
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      WHERE m.file_path = ?
    `
    const stmt = this.db.prepare(sql)
    return (stmt.get(filePath) as MediaItem) || null
  }

  getMediaItemByProviderId(providerId: string, sourceId?: string): MediaItem | null {
    let sql = 'SELECT * FROM media_items WHERE plex_id = ?'
    const params: unknown[] = [providerId]

    if (sourceId) {
      sql += ' AND source_id = ?'
      params.push(sourceId)
    }

    const stmt = this.db.prepare(sql)
    return (stmt.get(...params) as MediaItem) || null
  }

  upsertMediaItem(item: MediaItem): number {
    const stmt = this.db.prepare(`
      INSERT INTO media_items (
        source_id, source_type, library_id, plex_id, title, sort_title, year, type,
        series_title, season_number, episode_number, file_path, file_size,
        duration, resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate, video_frame_rate,
        color_bit_depth, hdr_format, color_space, video_profile, video_level,
        audio_profile, audio_sample_rate, has_object_audio, audio_tracks,
        subtitle_tracks, original_language, audio_language,
        container, file_mtime, imdb_id, tmdb_id, series_tmdb_id, poster_url,
        episode_thumb_url, season_poster_url, summary, user_fixed_match,
        quality_tier, tier_quality, tier_score,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        datetime('now'), datetime('now')
      )
      ON CONFLICT(source_id, plex_id) DO UPDATE SET
        library_id = excluded.library_id,
        title = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.title ELSE excluded.title END,
        sort_title = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.sort_title ELSE excluded.sort_title END,
        year = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.year ELSE excluded.year END,
        type = excluded.type,
        series_title = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.series_title ELSE excluded.series_title END,
        season_number = excluded.season_number,
        episode_number = excluded.episode_number,
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        duration = excluded.duration,
        resolution = excluded.resolution,
        width = excluded.width,
        height = excluded.height,
        video_codec = excluded.video_codec,
        video_bitrate = excluded.video_bitrate,
        audio_codec = excluded.audio_codec,
        audio_channels = excluded.audio_channels,
        audio_bitrate = excluded.audio_bitrate,
        video_frame_rate = excluded.video_frame_rate,
        color_bit_depth = excluded.color_bit_depth,
        hdr_format = excluded.hdr_format,
        color_space = excluded.color_space,
        video_profile = excluded.video_profile,
        video_level = excluded.video_level,
        audio_profile = excluded.audio_profile,
        audio_sample_rate = excluded.audio_sample_rate,
        has_object_audio = excluded.has_object_audio,
        audio_tracks = excluded.audio_tracks,
        subtitle_tracks = excluded.subtitle_tracks,
        container = excluded.container,
        file_mtime = excluded.file_mtime,
        original_language = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.original_language ELSE COALESCE(excluded.original_language, media_items.original_language) END,
        audio_language = COALESCE(excluded.audio_language, media_items.audio_language),
        imdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.imdb_id ELSE COALESCE(excluded.imdb_id, media_items.imdb_id) END,
        tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.tmdb_id ELSE COALESCE(excluded.tmdb_id, media_items.tmdb_id) END,
        series_tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.series_tmdb_id ELSE COALESCE(excluded.series_tmdb_id, media_items.series_tmdb_id) END,
        poster_url = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.poster_url ELSE COALESCE(excluded.poster_url, media_items.poster_url) END,
        episode_thumb_url = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.episode_thumb_url ELSE COALESCE(excluded.episode_thumb_url, media_items.episode_thumb_url) END,
        season_poster_url = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.season_poster_url ELSE COALESCE(excluded.season_poster_url, media_items.season_poster_url) END,
        summary = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.summary ELSE COALESCE(excluded.summary, media_items.summary) END,
        user_fixed_match = CASE WHEN media_items.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        quality_tier = COALESCE(excluded.quality_tier, media_items.quality_tier),
        tier_quality = COALESCE(excluded.tier_quality, media_items.tier_quality),
        tier_score = COALESCE(excluded.tier_score, media_items.tier_score),
        updated_at = datetime('now')
      RETURNING id
    `)

    const row = stmt.get(
      item.source_id || 'legacy',
      item.source_type || 'plex',
      item.library_id || null,
      item.plex_id,
      item.title,
      item.sort_title || null,
      item.year || null,
      item.type,
      item.series_title || null,
      item.season_number || null,
      item.episode_number || null,
      item.file_path,
      item.file_size,
      item.duration,
      item.resolution,
      item.width,
      item.height,
      item.video_codec,
      item.video_bitrate,
      item.audio_codec,
      item.audio_channels,
      item.audio_bitrate,
      item.video_frame_rate || null,
      item.color_bit_depth || null,
      item.hdr_format || null,
      item.color_space || null,
      item.video_profile || null,
      item.video_level || null,
      item.audio_profile || null,
      item.audio_sample_rate || null,
      item.has_object_audio ? 1 : 0,
      item.audio_tracks || null,
      item.subtitle_tracks || null,
      item.original_language || null,
      item.audio_language || null,
      item.container || null,
      item.file_mtime || null,
      item.imdb_id || null,
      item.tmdb_id || null,
      item.series_tmdb_id || null,
      item.poster_url || null,
      item.episode_thumb_url || null,
      item.season_poster_url || null,
      item.summary || null,
      item.user_fixed_match ? 1 : 0,
      item.quality_tier || null,
      item.tier_quality || null,
      item.tier_score || 0
    ) as { id: number } | undefined

    return row?.id || 0
  }

  deleteMediaItem(id: number): void {
    const db = this.db
    db.exec('BEGIN')
    try {
      // 1. Fetch item details before deletion to update summaries later
      const item = db.prepare(
        'SELECT tmdb_id, source_id, library_id, type, series_title, season_number, episode_number FROM media_items WHERE id = ?'
      ).get(id) as { tmdb_id?: string; source_id: string; library_id?: string; type: string; series_title?: string; season_number?: number; episode_number?: number } | undefined

      if (item) {
        // Capture collection IDs before deleting associations
        const collections = db.prepare('SELECT collection_id FROM media_item_collections WHERE media_item_id = ?').all(id) as Array<{ collection_id: number }>

        // 2. Perform deletions
        db.prepare('DELETE FROM media_item_versions WHERE media_item_id = ?').run(id)
        db.prepare('DELETE FROM quality_scores WHERE media_item_id = ?').run(id)
        db.prepare('DELETE FROM media_item_collections WHERE media_item_id = ?').run(id)
        db.prepare('DELETE FROM media_items WHERE id = ?').run(id)

        // 3. Update summaries
        const sourceId = item.source_id
        const libraryId = item.library_id || ''

        if (item.type === 'episode' && item.series_title) {
          // Update series completeness
          db.prepare(`
            UPDATE series_completeness SET
              owned_episodes = (SELECT COUNT(*) FROM media_items WHERE series_title = ? AND source_id = ? AND library_id = ? AND type = 'episode'),
              owned_seasons = (SELECT COUNT(DISTINCT season_number) FROM media_items WHERE series_title = ? AND source_id = ? AND library_id = ? AND type = 'episode'),
              completeness_percentage = CASE WHEN total_episodes > 0
                THEN ROUND(CAST((SELECT COUNT(*) FROM media_items WHERE series_title = ? AND source_id = ? AND library_id = ? AND type = 'episode') AS REAL) * 100.0 / total_episodes)
                ELSE 0 END,
              updated_at = datetime('now')
            WHERE series_title = ? AND source_id = ? AND library_id = ?
          `).run(
            item.series_title, sourceId, libraryId,
            item.series_title, sourceId, libraryId,
            item.series_title, sourceId, libraryId,
            item.series_title, sourceId, libraryId
          )

          // Cleanup series completeness if no more episodes exist for it
          db.prepare(
            'DELETE FROM series_completeness WHERE series_title = ? AND source_id = ? AND library_id = ? AND owned_episodes <= 0'
          ).run(item.series_title, sourceId, libraryId)
        }

        if (item.type === 'movie' && collections.length > 0) {
          // Update collection completeness for each affected collection
          const updateStmt = db.prepare(`
            UPDATE movie_collections SET
              owned_movies = (
                SELECT COUNT(DISTINCT media_item_id) FROM media_item_collections
                WHERE collection_id = movie_collections.id
              ),
              completeness_percentage = CASE WHEN total_movies > 0
                THEN ROUND(CAST((SELECT COUNT(DISTINCT media_item_id) FROM media_item_collections WHERE collection_id = movie_collections.id) AS REAL) * 100.0 / total_movies)
                ELSE 0 END,
              updated_at = datetime('now')
            WHERE id = ?
          `)

          for (const coll of collections) {
            updateStmt.run(coll.collection_id)
          }
        }
      }      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  deleteMediaItemsForSource(sourceId: string): void {
    const db = this.db
    db.exec('BEGIN')
    try {
      db.prepare(`
        DELETE FROM media_item_versions WHERE media_item_id IN (
          SELECT id FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)
      
      db.prepare(`
        DELETE FROM quality_scores WHERE media_item_id IN (
          SELECT id FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)

      db.prepare(`
        DELETE FROM media_item_collections WHERE media_item_id IN (
          SELECT id FROM media_items WHERE source_id = ?
        )
      `).run(sourceId)

      db.prepare('DELETE FROM media_items WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM series_completeness WHERE source_id = ?').run(sourceId)
      db.prepare('DELETE FROM movie_collections WHERE source_id = ?').run(sourceId)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  updateSeriesMatch(
    seriesTitle: string,
    sourceId: string,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string
  ): number {
    const params: unknown[] = [tmdbId, 1]
    let sql = 'UPDATE media_items SET series_tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }
    if (newSeriesTitle) {
      sql += ', series_title = ?'
      params.push(newSeriesTitle)
    }

    sql += " WHERE series_title = ? AND source_id = ? AND type = 'episode'"
    params.push(seriesTitle, sourceId)

    this.db.prepare(sql).run(...params)

    if (newSeriesTitle && newSeriesTitle !== seriesTitle) {
      this.db.prepare(
        'UPDATE series_completeness SET series_title = ? WHERE series_title = ? AND source_id = ?'
      ).run(newSeriesTitle, seriesTitle, sourceId)
    }

    const titleToQuery = newSeriesTitle || seriesTitle
    const countStmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE series_title = ? AND source_id = ? AND type = 'episode'"
    )
    return (countStmt.get(titleToQuery, sourceId) as { count: number }).count
  }

  updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number
  ): void {
    const params: unknown[] = [tmdbId, 1]
    let sql = 'UPDATE media_items SET tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }
    if (title) {
      sql += ', title = ?'
      params.push(title)
    }
    if (year !== undefined) {
      sql += ', year = ?'
      params.push(year)
    }

    sql += " WHERE id = ? AND type = 'movie'"
    params.push(mediaItemId)

    this.db.prepare(sql).run(...params)
  }

  updateMovieWithTMDBId(mediaItemId: number, tmdbId: string): void {
    this.db.prepare(
      "UPDATE media_items SET tmdb_id = ? WHERE id = ? AND type = 'movie'"
    ).run(tmdbId, mediaItemId)
  }

  removeStaleMediaItems(validPlexIds: Set<string>, type: 'movie' | 'episode'): number {
    const db = this.db
    
    db.exec('BEGIN')
    try {
      if (validPlexIds.size === 0) {
        const result = db.prepare('DELETE FROM media_items WHERE type = ?').run(type)
        db.exec('COMMIT')
        return Number(result.changes)
      }

      // Use a temporary table for maximum performance with large sets
      db.exec('CREATE TEMPORARY TABLE IF NOT EXISTS valid_plex_ids (plex_id TEXT)')
      db.exec('DELETE FROM valid_plex_ids')
      
      const insertStmt = db.prepare('INSERT INTO valid_plex_ids (plex_id) VALUES (?)')
      for (const id of validPlexIds) {
        insertStmt.run(id)
      }

      const result = db.prepare(`
        DELETE FROM media_items 
        WHERE type = ? AND plex_id NOT IN (SELECT plex_id FROM valid_plex_ids)
      `).run(type)

      db.exec('COMMIT')
      return Number(result.changes)
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  updateMediaItemArtwork(
    id: number,
    artwork: { posterUrl?: string; episodeThumbUrl?: string; seasonPosterUrl?: string }
  ): void {
    const updates: string[] = []
    const params: unknown[] = []

    if (artwork.posterUrl !== undefined) {
      updates.push('poster_url = ?')
      params.push(artwork.posterUrl)
    }
    if (artwork.episodeThumbUrl !== undefined) {
      updates.push('episode_thumb_url = ?')
      params.push(artwork.episodeThumbUrl)
    }
    if (artwork.seasonPosterUrl !== undefined) {
      updates.push('season_poster_url = ?')
      params.push(artwork.seasonPosterUrl)
    }

    if (updates.length === 0) return

    updates.push("updated_at = datetime('now')")
    params.push(id)

    const sql = `UPDATE media_items SET ${updates.join(', ')} WHERE id = ?`
    this.db.prepare(sql).run(...params)
  }

  getMediaItemsByTmdbIds(tmdbIds: string[]): Map<string, MediaItem> {
    const result = new Map<string, MediaItem>()
    if (tmdbIds.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < tmdbIds.length; i += batchSize) {
      const batch = tmdbIds.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const stmt = this.db.prepare(`SELECT * FROM media_items WHERE tmdb_id IN (${placeholders})`)
      const rows = stmt.all(...batch) as MediaItem[]
      for (const row of rows) {
        if (row.tmdb_id) result.set(row.tmdb_id, row)
      }
    }
    return result
  }

  getEpisodeCountBySeriesTmdbId(seriesTmdbId: string): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_tmdb_id = ?"
    )
    return (stmt.get(seriesTmdbId) as { count: number }).count
  }

  getEpisodeCountForSeason(seriesTitle: string, seasonNumber: number): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ?"
    )
    return (stmt.get(seriesTitle, seasonNumber) as { count: number }).count
  }

  getEpisodeCountForSeasonEpisode(seriesTitle: string, seasonNumber: number, episodeNumber: number): number {
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_title = ? AND season_number = ? AND episode_number = ?"
    )
    return (stmt.get(seriesTitle, seasonNumber, episodeNumber) as { count: number }).count
  }

  getLetterOffset(
    table: 'movies' | 'tvshows' | 'artists' | 'albums',
    letter: string,
    filters?: { sourceId?: string; libraryId?: string }
  ): number {
    // SECURITY: Explicit allowlist validation to prevent SQL injection or misdirection.
    // The allowlist includes both internal UI table identifiers and actual database tables.
    const allowedTables = ['movies', 'tvshows', 'artists', 'albums', 'media_items', 'music_artists', 'music_albums', 'movie_collections'];
    if (!allowedTables.includes(table)) {
      throw new Error(`Invalid table identifier: ${table}`);
    }

    if (letter === '#') return 0

    const upperLetter = letter.toUpperCase()
    let sql: string
    const params: unknown[] = []

    if (table === 'movies') {
      sql = `
        SELECT COUNT(*) as count FROM media_items m
        LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
        WHERE m.type = 'movie' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)
          AND UPPER(SUBSTR(COALESCE(m.sort_title, m.title), 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND m.library_id = ?'; params.push(filters.libraryId) }
    } else if (table === 'tvshows') {
      sql = `
        SELECT COUNT(DISTINCT COALESCE(m.series_title, 'Unknown Series')) as count FROM media_items m
        WHERE m.type = 'episode'
          AND UPPER(SUBSTR(COALESCE(m.series_title, 'Unknown Series'), 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND m.source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND m.library_id = ?'; params.push(filters.libraryId) }
    } else if (table === 'artists') {
      sql = `
        SELECT COUNT(*) as count FROM music_artists
        WHERE UPPER(SUBSTR(COALESCE(sort_name, name), 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    } else {
      sql = `
        SELECT COUNT(*) as count FROM music_albums
        WHERE UPPER(SUBSTR(title, 1, 1)) < ?
      `
      params.push(upperLetter)
      if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
      if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    }

    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as { count: number }
    return result?.count || 0
  }

  getEpisodesForSeries(
    seriesTitle: string,
    sourceId?: string,
    libraryId?: string
  ): MediaItem[] {
    let sql = `SELECT m.*,
                      q.overall_score, q.needs_upgrade,
                      q.quality_tier, q.tier_quality, q.tier_score,
                      q.efficiency_score, q.storage_debt_bytes, q.issues
FROM media_items m
LEFT JOIN quality_scores q ON m.id = q.media_item_id
WHERE m.type = 'episode' AND m.series_title = ?`
    const params: unknown[] = [seriesTitle]

    if (sourceId) {
      sql += ' AND m.source_id = ?'
      params.push(sourceId)
    }
    if (libraryId) {
      sql += ' AND m.library_id = ?'
      params.push(libraryId)
    }

    sql += ' ORDER BY m.season_number ASC, m.episode_number ASC'

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MediaItem[]
  }

}
