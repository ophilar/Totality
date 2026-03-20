import type { Database } from 'sql.js'
import type { MediaItem, MediaItemFilters, MediaItemVersion, QualityScore } from '../../../types/database'

type SaveCallback = () => Promise<void>

export class MediaRepository {
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

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  async upsertMediaItem(item: MediaItem): Promise<number> {
    const sourceId = item.source_id || 'legacy'
    const sourceType = item.source_type || 'plex'

    const existingResult = this.db.exec(
      'SELECT id FROM media_items WHERE source_id = ? AND plex_id = ?',
      [sourceId, item.plex_id]
    )
    const existingId = existingResult.length > 0 && existingResult[0].values.length > 0
      ? existingResult[0].values[0][0] as number
      : null

    const sql = `
      INSERT INTO media_items (
        source_id, source_type, library_id,
        plex_id, title, sort_title, year, type, series_title, season_number, episode_number,
        file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate,
        video_frame_rate, color_bit_depth, hdr_format, color_space, video_profile, video_level,
        audio_profile, audio_sample_rate, has_object_audio, audio_tracks,
        subtitle_tracks,
        container,
        imdb_id, tmdb_id, series_tmdb_id, poster_url, episode_thumb_url, season_poster_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, plex_id) DO UPDATE SET
        source_type = excluded.source_type,
        library_id = excluded.library_id,
        title = excluded.title,
        sort_title = excluded.sort_title,
        year = excluded.year,
        type = excluded.type,
        series_title = excluded.series_title,
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
        imdb_id = excluded.imdb_id,
        tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.tmdb_id ELSE COALESCE(excluded.tmdb_id, media_items.tmdb_id) END,
        series_tmdb_id = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.series_tmdb_id ELSE COALESCE(excluded.series_tmdb_id, media_items.series_tmdb_id) END,
        poster_url = CASE WHEN media_items.user_fixed_match = 1 THEN media_items.poster_url ELSE COALESCE(excluded.poster_url, media_items.poster_url) END,
        episode_thumb_url = COALESCE(excluded.episode_thumb_url, media_items.episode_thumb_url),
        season_poster_url = COALESCE(excluded.season_poster_url, media_items.season_poster_url)
    `

    this.db.run(sql, [
      sourceId,
      sourceType,
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
      item.container || null,
      item.imdb_id || null,
      item.tmdb_id || null,
      item.series_tmdb_id || null,
      item.poster_url || null,
      item.episode_thumb_url || null,
      item.season_poster_url || null,
    ])

    let id: number
    if (existingId !== null) {
      id = existingId
    } else {
      const result = this.db.exec('SELECT last_insert_rowid() as id')
      id = result[0].values[0][0] as number
    }

    await this.save()
    return id
  }

  getMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): MediaItem[] {
    let sql = `
      SELECT m.*,
             q.overall_score, q.needs_upgrade,
             q.quality_tier, q.tier_quality, q.tier_score, q.issues
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE 1=1
    `

    const params: (string | number)[] = []

    if (!filters?.includeDisabledLibraries) {
      sql += ' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)'
    }

    if (filters?.type) {
      sql += ' AND m.type = ?'
      params.push(filters.type)
    }

    if (filters?.minQualityScore !== undefined) {
      sql += ' AND q.overall_score >= ?'
      params.push(filters.minQualityScore)
    }

    if (filters?.maxQualityScore !== undefined) {
      sql += ' AND q.overall_score <= ?'
      params.push(filters.maxQualityScore)
    }

    if (filters?.needsUpgrade !== undefined) {
      sql += ' AND q.needs_upgrade = ?'
      params.push(filters.needsUpgrade ? 1 : 0)
      if (filters.needsUpgrade) {
        sql += ` AND m.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)`
      }
    }

    if (filters?.searchQuery) {
      sql += ' AND (m.title LIKE ? OR m.series_title LIKE ?)'
      const searchTerm = `%${filters.searchQuery}%`
      params.push(searchTerm, searchTerm)
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

    const sortColumnMap: Record<string, string> = {
      'title': 'COALESCE(m.sort_title, m.title)',
      'year': 'm.year',
      'updated_at': 'm.updated_at',
      'created_at': 'm.created_at',
      'tier_score': 'q.tier_score',
      'overall_score': 'q.overall_score'
    }
    const sortColumn = sortColumnMap[filters?.sortBy || 'title'] || 'COALESCE(m.sort_title, m.title)'
    const sortOrder = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    sql += ` ORDER BY ${sortColumn} ${sortOrder}`

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }

    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    return this.rowsToObjects<MediaItem>(result[0])
  }

  countMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): number {
    let sql = `
      SELECT COUNT(*) as count
      FROM media_items m
      LEFT JOIN quality_scores q ON m.id = q.media_item_id
      LEFT JOIN library_scans ls ON m.source_id = ls.source_id AND m.library_id = ls.library_id
      WHERE 1=1
    `

    const params: (string | number)[] = []

    if (!filters?.includeDisabledLibraries) {
      sql += ' AND (ls.is_enabled = 1 OR ls.is_enabled IS NULL)'
    }

    if (filters?.type) {
      sql += ' AND m.type = ?'
      params.push(filters.type)
    }

    if (filters?.minQualityScore !== undefined) {
      sql += ' AND q.overall_score >= ?'
      params.push(filters.minQualityScore)
    }

    if (filters?.maxQualityScore !== undefined) {
      sql += ' AND q.overall_score <= ?'
      params.push(filters.maxQualityScore)
    }

    if (filters?.needsUpgrade !== undefined) {
      sql += ' AND q.needs_upgrade = ?'
      params.push(filters.needsUpgrade ? 1 : 0)
      if (filters.needsUpgrade) {
        sql += ` AND m.id NOT IN (SELECT reference_id FROM exclusions WHERE exclusion_type = 'media_upgrade' AND reference_id IS NOT NULL)`
      }
    }

    if (filters?.searchQuery) {
      sql += ' AND (m.title LIKE ? OR m.series_title LIKE ?)'
      const searchTerm = `%${filters.searchQuery}%`
      params.push(searchTerm, searchTerm)
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

    const result = this.db.exec(sql, params)
    if (!result.length || !result[0].values.length) return 0

    return result[0].values[0][0] as number
  }

  getMediaItemById(id: number): MediaItem | null {
    const result = this.db.exec('SELECT * FROM media_items WHERE id = ?', [id])
    if (!result.length) return null

    const items = this.rowsToObjects<MediaItem>(result[0])
    return items[0] || null
  }

  getMediaItemsByTmdbIds(tmdbIds: string[]): Map<string, MediaItem> {
    const resultMap = new Map<string, MediaItem>()
    if (tmdbIds.length === 0) return resultMap

    const batchSize = 500
    for (let i = 0; i < tmdbIds.length; i += batchSize) {
      const batch = tmdbIds.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const result = this.db.exec(
        `SELECT * FROM media_items WHERE tmdb_id IN (${placeholders})`,
        batch,
      )
      if (result.length > 0) {
        const rows = this.rowsToObjects<MediaItem>(result[0])
        for (const row of rows) {
          if (row.tmdb_id) resultMap.set(row.tmdb_id, row)
        }
      }
    }
    return resultMap
  }

  getEpisodeCountBySeriesTmdbId(seriesTmdbId: string): number {
    const result = this.db.exec(
      "SELECT COUNT(*) as count FROM media_items WHERE type = 'episode' AND series_tmdb_id = ?",
      [seriesTmdbId],
    )
    if (!result.length) return 0
    return (result[0].values[0][0] as number) || 0
  }

  getMediaItemByPath(filePath: string): MediaItem | null {
    const result = this.db.exec('SELECT * FROM media_items WHERE file_path = ?', [filePath])
    if (!result.length) return null

    const items = this.rowsToObjects<MediaItem>(result[0])
    return items[0] || null
  }

  async deleteMediaItem(id: number): Promise<void> {
    this.db.run('DELETE FROM media_item_versions WHERE media_item_id = ?', [id])
    this.db.run('DELETE FROM quality_scores WHERE media_item_id = ?', [id])
    this.db.run('DELETE FROM media_item_collections WHERE media_item_id = ?', [id])
    this.db.run('DELETE FROM media_items WHERE id = ?', [id])
    await this.save()
  }

  // ============================================================================
  // MEDIA ITEM VERSIONS
  // ============================================================================

  upsertMediaItemVersion(version: MediaItemVersion): number {
    const existing = this.db.exec(
      'SELECT id FROM media_item_versions WHERE media_item_id = ? AND file_path = ?',
      [version.media_item_id, version.file_path]
    )

    if (existing.length > 0 && existing[0].values.length > 0) {
      const existingId = existing[0].values[0][0] as number
      this.db.run(`
        UPDATE media_item_versions SET
          version_source = ?, edition = ?, label = ?,
          file_size = ?, duration = ?,
          resolution = ?, width = ?, height = ?, video_codec = ?, video_bitrate = ?,
          audio_codec = ?, audio_channels = ?, audio_bitrate = ?,
          video_frame_rate = ?, color_bit_depth = ?, hdr_format = ?, color_space = ?,
          video_profile = ?, video_level = ?, audio_profile = ?, audio_sample_rate = ?,
          has_object_audio = ?, audio_tracks = ?, subtitle_tracks = ?, container = ?, file_mtime = ?,
          quality_tier = ?, tier_quality = ?, tier_score = ?, is_best = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `, [
        version.version_source || 'primary', version.edition || null, version.label || null,
        version.file_size, version.duration,
        version.resolution, version.width, version.height, version.video_codec, version.video_bitrate,
        version.audio_codec, version.audio_channels, version.audio_bitrate,
        version.video_frame_rate || null, version.color_bit_depth || null,
        version.hdr_format || null, version.color_space || null,
        version.video_profile || null, version.video_level || null,
        version.audio_profile || null, version.audio_sample_rate || null,
        version.has_object_audio ? 1 : 0, version.audio_tracks || null,
        version.subtitle_tracks || null, version.container || null, version.file_mtime || null,
        version.quality_tier || null, version.tier_quality || null, version.tier_score || 0,
        version.is_best ? 1 : 0,
        existingId
      ])
      return existingId
    }

    this.db.run(`
      INSERT INTO media_item_versions (
        media_item_id, version_source, edition, label,
        file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate,
        video_frame_rate, color_bit_depth, hdr_format, color_space,
        video_profile, video_level, audio_profile, audio_sample_rate,
        has_object_audio, audio_tracks, subtitle_tracks, container, file_mtime,
        quality_tier, tier_quality, tier_score, is_best
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      version.media_item_id, version.version_source || 'primary',
      version.edition || null, version.label || null,
      version.file_path, version.file_size, version.duration,
      version.resolution, version.width, version.height, version.video_codec, version.video_bitrate,
      version.audio_codec, version.audio_channels, version.audio_bitrate,
      version.video_frame_rate || null, version.color_bit_depth || null,
      version.hdr_format || null, version.color_space || null,
      version.video_profile || null, version.video_level || null,
      version.audio_profile || null, version.audio_sample_rate || null,
      version.has_object_audio ? 1 : 0, version.audio_tracks || null,
      version.subtitle_tracks || null, version.container || null, version.file_mtime || null,
      version.quality_tier || null, version.tier_quality || null, version.tier_score || 0,
      version.is_best ? 1 : 0
    ])

    const result = this.db.exec('SELECT last_insert_rowid()')
    return (result[0]?.values[0]?.[0] as number) || 0
  }

  getMediaItemVersions(mediaItemId: number): MediaItemVersion[] {
    const result = this.db.exec(
      'SELECT * FROM media_item_versions WHERE media_item_id = ? ORDER BY is_best DESC, tier_score DESC',
      [mediaItemId]
    )

    if (!result.length || !result[0].values.length) return []

    const columns = result[0].columns
    return result[0].values.map(row => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col, i) => { obj[col] = row[i] })
      return {
        id: obj.id as number,
        media_item_id: obj.media_item_id as number,
        version_source: obj.version_source as string,
        edition: obj.edition as string | undefined,
        label: obj.label as string | undefined,
        file_path: obj.file_path as string,
        file_size: obj.file_size as number,
        duration: obj.duration as number,
        resolution: obj.resolution as string,
        width: obj.width as number,
        height: obj.height as number,
        video_codec: obj.video_codec as string,
        video_bitrate: obj.video_bitrate as number,
        audio_codec: obj.audio_codec as string,
        audio_channels: obj.audio_channels as number,
        audio_bitrate: obj.audio_bitrate as number,
        video_frame_rate: obj.video_frame_rate as number | undefined,
        color_bit_depth: obj.color_bit_depth as number | undefined,
        hdr_format: obj.hdr_format as string | undefined,
        color_space: obj.color_space as string | undefined,
        video_profile: obj.video_profile as string | undefined,
        video_level: obj.video_level as number | undefined,
        audio_profile: obj.audio_profile as string | undefined,
        audio_sample_rate: obj.audio_sample_rate as number | undefined,
        has_object_audio: !!(obj.has_object_audio as number),
        audio_tracks: obj.audio_tracks as string | undefined,
        subtitle_tracks: obj.subtitle_tracks as string | undefined,
        container: obj.container as string | undefined,
        file_mtime: obj.file_mtime as number | undefined,
        quality_tier: obj.quality_tier as string | undefined,
        tier_quality: obj.tier_quality as string | undefined,
        tier_score: obj.tier_score as number | undefined,
        is_best: !!(obj.is_best as number),
        created_at: obj.created_at as string,
        updated_at: obj.updated_at as string,
      }
    })
  }

  deleteMediaItemVersions(mediaItemId: number): void {
    this.db.run('DELETE FROM media_item_versions WHERE media_item_id = ?', [mediaItemId])
  }

  syncMediaItemVersions(mediaItemId: number, versions: MediaItemVersion[]): void {
    const currentFilePaths = versions.map(v => v.file_path).filter(Boolean)

    if (currentFilePaths.length > 0) {
      const placeholders = currentFilePaths.map(() => '?').join(',')
      this.db.run(
        `DELETE FROM media_item_versions WHERE media_item_id = ? AND file_path NOT IN (${placeholders})`,
        [mediaItemId, ...currentFilePaths]
      )
    } else {
      this.db.run('DELETE FROM media_item_versions WHERE media_item_id = ?', [mediaItemId])
    }

    for (const version of versions) {
      this.upsertMediaItemVersion(version)
    }

    this.updateBestVersion(mediaItemId)
  }

  updateBestVersion(mediaItemId: number): void {
    const versions = this.getMediaItemVersions(mediaItemId)
    if (versions.length === 0) return

    const tierRank = (tier?: string): number => {
      switch (tier) {
        case '4K': return 4
        case '1080p': return 3
        case '720p': return 2
        default: return 1
      }
    }

    const sorted = [...versions].sort((a, b) => {
      const rankDiff = tierRank(b.quality_tier) - tierRank(a.quality_tier)
      if (rankDiff !== 0) return rankDiff
      return (b.tier_score || 0) - (a.tier_score || 0)
    })

    const best = sorted[0]

    this.db.run('UPDATE media_item_versions SET is_best = 0 WHERE media_item_id = ?', [mediaItemId])
    if (best.id) {
      this.db.run('UPDATE media_item_versions SET is_best = 1 WHERE id = ?', [best.id])
    }

    this.db.run(`
      UPDATE media_items SET
        file_path = ?, file_size = ?, duration = ?,
        resolution = ?, width = ?, height = ?,
        video_codec = ?, video_bitrate = ?,
        audio_codec = ?, audio_channels = ?, audio_bitrate = ?,
        video_frame_rate = ?, color_bit_depth = ?, hdr_format = ?, color_space = ?,
        video_profile = ?, video_level = ?,
        audio_profile = ?, audio_sample_rate = ?, has_object_audio = ?,
        audio_tracks = ?, subtitle_tracks = ?, container = ?, file_mtime = ?,
        version_count = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [
      best.file_path, best.file_size, best.duration,
      best.resolution, best.width, best.height,
      best.video_codec, best.video_bitrate,
      best.audio_codec, best.audio_channels, best.audio_bitrate,
      best.video_frame_rate || null, best.color_bit_depth || null,
      best.hdr_format || null, best.color_space || null,
      best.video_profile || null, best.video_level || null,
      best.audio_profile || null, best.audio_sample_rate || null,
      best.has_object_audio ? 1 : 0,
      best.audio_tracks || null, best.subtitle_tracks || null,
      best.container || null, best.file_mtime || null,
      versions.length,
      mediaItemId
    ])
  }

  async updateMediaItemArtwork(
    sourceId: string,
    plexId: string,
    artwork: {
      posterUrl?: string
      episodeThumbUrl?: string
      seasonPosterUrl?: string
    }
  ): Promise<void> {
    const updates: string[] = []
    const params: (string | null)[] = []

    if (artwork.posterUrl !== undefined) {
      updates.push('poster_url = ?')
      params.push(artwork.posterUrl || null)
    }
    if (artwork.episodeThumbUrl !== undefined) {
      updates.push('episode_thumb_url = ?')
      params.push(artwork.episodeThumbUrl || null)
    }
    if (artwork.seasonPosterUrl !== undefined) {
      updates.push('season_poster_url = ?')
      params.push(artwork.seasonPosterUrl || null)
    }

    if (updates.length === 0) return

    params.push(sourceId, plexId)

    const sql = `UPDATE media_items SET ${updates.join(', ')} WHERE source_id = ? AND plex_id = ?`
    this.db.run(sql, params)
    await this.save()
  }

  async updateSeriesMatch(
    seriesTitle: string,
    sourceId: string,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string
  ): Promise<number> {
    const params: (string | number | null)[] = [tmdbId, 1] // 1 = user_fixed_match
    let sql = 'UPDATE media_items SET series_tmdb_id = ?, user_fixed_match = ?'

    if (posterUrl) {
      sql += ', poster_url = ?'
      params.push(posterUrl)
    }

    if (newSeriesTitle) {
      sql += ', series_title = ?'
      params.push(newSeriesTitle)
    }

    sql += ' WHERE series_title = ? AND source_id = ? AND type = ?'
    params.push(seriesTitle, sourceId, 'episode')

    this.db.run(sql, params)

    if (newSeriesTitle && newSeriesTitle !== seriesTitle) {
      this.db.run(
        'UPDATE series_completeness SET series_title = ? WHERE series_title = ? AND source_id = ?',
        [newSeriesTitle, seriesTitle, sourceId]
      )
    }

    await this.save()

    const titleToQuery = newSeriesTitle || seriesTitle
    const result = this.db.exec(
      'SELECT COUNT(*) FROM media_items WHERE series_title = ? AND source_id = ? AND type = ?',
      [titleToQuery, sourceId, 'episode']
    )

    return result[0]?.values[0]?.[0] as number || 0
  }

  async updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number
  ): Promise<void> {
    const params: (string | number | null)[] = [tmdbId, 1] // 1 = user_fixed_match
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

    sql += ' WHERE id = ? AND type = ?'
    params.push(mediaItemId, 'movie')

    this.db.run(sql, params)
    await this.save()
  }

  async updateMovieWithTMDBId(
    mediaItemId: number,
    tmdbId: string
  ): Promise<void> {
    this.db.run(
      'UPDATE media_items SET tmdb_id = ? WHERE id = ? AND type = ?',
      [tmdbId, mediaItemId, 'movie']
    )
    await this.save()
  }

  async removeStaleMediaItems(validPlexIds: Set<string>, type: 'movie' | 'episode'): Promise<number> {
    const result = this.db.exec(
      'SELECT id, plex_id, title FROM media_items WHERE type = ?',
      [type]
    )

    if (!result[0]?.values) return 0

    const itemsToDelete: Array<{ id: number; plex_id: string; title: string }> = []

    for (const row of result[0].values) {
      const id = row[0] as number
      const plexId = row[1] as string
      const title = row[2] as string

      if (plexId && !validPlexIds.has(plexId)) {
        itemsToDelete.push({ id, plex_id: plexId, title })
      }
    }

    if (itemsToDelete.length === 0) return 0

    for (const item of itemsToDelete) {
      this.db.run('DELETE FROM quality_scores WHERE media_item_id = ?', [item.id])
      this.db.run('DELETE FROM media_items WHERE id = ?', [item.id])
    }

    await this.save()
    return itemsToDelete.length
  }

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  async upsertQualityScore(score: QualityScore): Promise<number> {
    const sql = `
      INSERT INTO quality_scores (
        media_item_id,
        quality_tier, tier_quality, tier_score, bitrate_tier_score, audio_tier_score,
        overall_score, resolution_score, bitrate_score, audio_score,
        is_low_quality, needs_upgrade, issues
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_item_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        bitrate_tier_score = excluded.bitrate_tier_score,
        audio_tier_score = excluded.audio_tier_score,
        overall_score = excluded.overall_score,
        resolution_score = excluded.resolution_score,
        bitrate_score = excluded.bitrate_score,
        audio_score = excluded.audio_score,
        is_low_quality = excluded.is_low_quality,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues
    `

    this.db.run(sql, [
      score.media_item_id,
      score.quality_tier,
      score.tier_quality,
      score.tier_score,
      score.bitrate_tier_score,
      score.audio_tier_score,
      score.overall_score,
      score.resolution_score,
      score.bitrate_score,
      score.audio_score,
      score.is_low_quality ? 1 : 0,
      score.needs_upgrade ? 1 : 0,
      score.issues,
    ])

    const result = this.db.exec('SELECT last_insert_rowid() as id')
    const id = result[0].values[0][0] as number

    await this.save()
    return id
  }

  getQualityScores(): QualityScore[] {
    const result = this.db.exec('SELECT * FROM quality_scores ORDER BY overall_score ASC')
    if (!result.length) return []

    return this.rowsToObjects<QualityScore>(result[0])
  }

  getQualityScoreByMediaId(mediaItemId: number): QualityScore | null {
    const result = this.db.exec('SELECT * FROM quality_scores WHERE media_item_id = ?', [
      mediaItemId,
    ])
    if (!result.length) return null

    const scores = this.rowsToObjects<QualityScore>(result[0])
    return scores[0] || null
  }

  // ============================================================================
  // GLOBAL SEARCH
  // ============================================================================

  globalSearch(query: string, maxResults = 5): {
    movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
    artists: Array<{ id: number; name: string; thumb_url?: string }>
    albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
    tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string }>
  } {
    if (!query || query.length < 2) {
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }

    const searchQuery = `%${query.toLowerCase()}%`

    const toArray = <T>(result: { columns: string[]; values: (number | string | Uint8Array | null)[][] }[]): T[] => {
      if (!result || result.length === 0) return []
      const { columns, values } = result[0]
      return values.map((row) => {
        const obj: Record<string, number | string | Uint8Array | null> = {}
        columns.forEach((col: string, i: number) => {
          obj[col] = row[i]
        })
        return obj as T
      })
    }

    const movies = toArray<{ id: number; title: string; year?: number; poster_url?: string }>(
      this.db.exec(`
        SELECT id, title, year, poster_url
        FROM media_items
        WHERE type = 'movie' AND LOWER(title) LIKE ?
        ORDER BY title
        LIMIT ?
      `, [searchQuery, maxResults])
    )

    const tvShows = toArray<{ id: number; title: string; poster_url?: string }>(
      this.db.exec(`
        SELECT MIN(id) as id, series_title as title, MIN(poster_url) as poster_url
        FROM media_items
        WHERE type = 'episode' AND series_title IS NOT NULL AND LOWER(series_title) LIKE ?
        GROUP BY series_title
        ORDER BY series_title
        LIMIT ?
      `, [searchQuery, maxResults])
    )

    const episodes = toArray<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>(
      this.db.exec(`
        SELECT id, title, series_title, season_number, episode_number, episode_thumb_url as poster_url
        FROM media_items
        WHERE type = 'episode' AND (LOWER(title) LIKE ? OR LOWER(series_title) LIKE ?)
        ORDER BY series_title, season_number, episode_number
        LIMIT ?
      `, [searchQuery, searchQuery, maxResults])
    )

    const artists = toArray<{ id: number; name: string; thumb_url?: string }>(
      this.db.exec(`
        SELECT id, name, thumb_url
        FROM music_artists
        WHERE LOWER(name) LIKE ?
        ORDER BY name
        LIMIT ?
      `, [searchQuery, maxResults])
    )

    const albums = toArray<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>(
      this.db.exec(`
        SELECT id, title, artist_name, year, thumb_url
        FROM music_albums
        WHERE LOWER(title) LIKE ? OR LOWER(artist_name) LIKE ?
        ORDER BY title
        LIMIT ?
      `, [searchQuery, searchQuery, maxResults])
    )

    const tracks = toArray<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string }>(
      this.db.exec(`
        SELECT t.id, t.title, t.album_id, a.title as album_title, a.artist_name, a.thumb_url as album_thumb_url
        FROM music_tracks t
        LEFT JOIN music_albums a ON t.album_id = a.id
        WHERE LOWER(t.title) LIKE ?
        ORDER BY t.title
        LIMIT ?
      `, [searchQuery, maxResults])
    )

    return { movies, tvShows, episodes, artists, albums, tracks }
  }
}
