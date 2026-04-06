// @ts-nocheck
import type { DatabaseSync } from 'node:sqlite'
import type { MusicArtist, MusicAlbum, MusicTrack, MusicQualityScore, ArtistCompleteness, AlbumCompleteness, MusicFilters } from '../../types/database'
import { BaseRepository } from './BaseRepository'

export class MusicRepository extends BaseRepository<MusicArtist | MusicAlbum | MusicTrack> {
  constructor(db: DatabaseSync) {
    super(db, 'music_tracks') // Default table, methods will override as needed
  }

  getMusicTrackByPath(filePath: string): MusicTrack | null {
    const sql = 'SELECT * FROM music_tracks WHERE file_path = ?'
    return this.queryOne<MusicTrack>(sql, [filePath])
  }

  upsertTrack(track: MusicTrack): number {
    const stmt = this.db.prepare(`
      INSERT INTO music_tracks (
        source_id, source_type, library_id, provider_id, album_id, artist_id,
        album_name, artist_name, title, track_number, disc_number, duration,
        file_path, file_size, container, file_mtime, audio_codec, audio_bitrate,
        sample_rate, bit_depth, channels, is_lossless, is_hi_res,
        musicbrainz_id, genres, added_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        album_id = excluded.album_id,
        artist_id = excluded.artist_id,
        album_name = excluded.album_name,
        artist_name = excluded.artist_name,
        title = excluded.title,
        track_number = excluded.track_number,
        disc_number = excluded.disc_number,
        duration = excluded.duration,
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        container = excluded.container,
        file_mtime = excluded.file_mtime,
        audio_codec = excluded.audio_codec,
        audio_bitrate = excluded.audio_bitrate,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        channels = excluded.channels,
        is_lossless = excluded.is_lossless,
        is_hi_res = excluded.is_hi_res,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id),
        genres = excluded.genres,
        updated_at = datetime('now')
      RETURNING id
    `)

    const row = stmt.get(
      track.source_id,
      track.source_type,
      track.library_id || '',
      track.provider_id,
      track.album_id || null,
      track.artist_id || null,
      track.album_name || null,
      track.artist_name,
      track.title,
      track.track_number || null,
      track.disc_number || null,
      track.duration || null,
      track.file_path || null,
      track.file_size || null,
      track.container || null,
      track.file_mtime || null,
      track.audio_codec,
      track.audio_bitrate || null,
      track.sample_rate || null,
      track.bit_depth || null,
      track.channels || null,
      track.is_lossless ? 1 : 0,
      track.is_hi_res ? 1 : 0,
      track.musicbrainz_id || null,
      track.genres || null,
      track.added_at || null
    ) as { id: number } | undefined

    return row?.id || 0
  }

  upsertMusicTrack(track: MusicTrack): number {
    return this.upsertTrack(track)
  }

  upsertArtist(artist: MusicArtist): number {
    const stmt = this.db.prepare(`
      INSERT INTO music_artists (
        source_id, source_type, library_id, provider_id, name, sort_name,
        musicbrainz_id, genres, country, biography, thumb_url, art_url,
        album_count, track_count, user_fixed_match, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        name = excluded.name,
        sort_name = excluded.sort_name,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_artists.musicbrainz_id),
        genres = excluded.genres,
        country = excluded.country,
        biography = excluded.biography,
        thumb_url = COALESCE(excluded.thumb_url, music_artists.thumb_url),
        art_url = COALESCE(excluded.art_url, music_artists.art_url),
        album_count = excluded.album_count,
        track_count = excluded.track_count,
        user_fixed_match = CASE WHEN music_artists.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        updated_at = datetime('now')
      RETURNING id
    `)

    const row = stmt.get(
      artist.source_id,
      artist.source_type,
      artist.library_id || '',
      artist.provider_id,
      artist.name,
      artist.sort_name || null,
      artist.musicbrainz_id || null,
      artist.genres || null,
      artist.country || null,
      artist.biography || null,
      artist.thumb_url || null,
      artist.art_url || null,
      artist.album_count || null,
      artist.track_count || null,
      artist.user_fixed_match ? 1 : 0
    ) as { id: number } | undefined

    return row?.id || 0
  }

  upsertMusicArtist(artist: MusicArtist): number {
    return this.upsertArtist(artist)
  }

  upsertAlbum(album: MusicAlbum): number {
    const stmt = this.db.prepare(`
      INSERT INTO music_albums (
        source_id, source_type, library_id, provider_id, artist_id, artist_name,
        title, sort_title, year, musicbrainz_id, musicbrainz_release_group_id,
        genres, studio, album_type, track_count, total_duration, total_size,
        best_audio_codec, best_audio_bitrate, best_sample_rate, best_bit_depth,
        avg_audio_bitrate, thumb_url, art_url, release_date, added_at,
        user_fixed_match, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(source_id, provider_id) DO UPDATE SET
        library_id = excluded.library_id,
        artist_id = excluded.artist_id,
        artist_name = excluded.artist_name,
        title = excluded.title,
        sort_title = excluded.sort_title,
        year = excluded.year,
        musicbrainz_id = COALESCE(excluded.musicbrainz_id, music_albums.musicbrainz_id),
        musicbrainz_release_group_id = COALESCE(excluded.musicbrainz_release_group_id, music_albums.musicbrainz_release_group_id),
        genres = excluded.genres,
        studio = excluded.studio,
        album_type = excluded.album_type,
        track_count = excluded.track_count,
        total_duration = excluded.total_duration,
        total_size = excluded.total_size,
        best_audio_codec = excluded.best_audio_codec,
        best_audio_bitrate = excluded.best_audio_bitrate,
        best_sample_rate = excluded.best_sample_rate,
        best_bit_depth = excluded.best_bit_depth,
        avg_audio_bitrate = excluded.avg_audio_bitrate,
        thumb_url = COALESCE(excluded.thumb_url, music_albums.thumb_url),
        art_url = COALESCE(excluded.art_url, music_albums.art_url),
        release_date = excluded.release_date,
        user_fixed_match = CASE WHEN music_albums.user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END,
        updated_at = datetime('now')
      RETURNING id
    `)

    const row = stmt.get(
      album.source_id,
      album.source_type,
      album.library_id || '',
      album.provider_id,
      album.artist_id || null,
      album.artist_name,
      album.title,
      album.sort_title || null,
      album.year || null,
      album.musicbrainz_id || null,
      album.musicbrainz_release_group_id || null,
      album.genres || null,
      album.studio || null,
      album.album_type || null,
      album.track_count || null,
      album.total_duration || null,
      album.total_size || null,
      album.best_audio_codec || null,
      album.best_audio_bitrate || null,
      album.best_sample_rate || null,
      album.best_bit_depth || null,
      album.avg_audio_bitrate || null,
      album.thumb_url || null,
      album.art_url || null,
      album.release_date || null,
      album.added_at || null,
      album.user_fixed_match ? 1 : 0
    ) as { id: number } | undefined

    return row?.id || 0
  }

  upsertMusicAlbum(album: MusicAlbum): number {
    return this.upsertAlbum(album)
  }

  updateMusicAlbumArtwork(sourceIdOrAlbumId: string | number, providerIdOrThumbUrl?: string, artwork?: { thumbUrl?: string; artUrl?: string }): void {
    if (typeof sourceIdOrAlbumId === 'number') {
      const albumId = sourceIdOrAlbumId
      const thumbUrl = providerIdOrThumbUrl as string | undefined
      if (!thumbUrl) return
      this.db.prepare(`UPDATE music_albums SET thumb_url = ?, updated_at = datetime('now') WHERE id = ?`).run(thumbUrl, albumId)
      return
    }

    const sourceId = sourceIdOrAlbumId
    const providerId = providerIdOrThumbUrl as string
    if (!artwork) return

    const updates: string[] = []
    const params: unknown[] = []

    if (artwork.thumbUrl !== undefined) {
      updates.push('thumb_url = ?')
      params.push(artwork.thumbUrl)
    }
    if (artwork.artUrl !== undefined) {
      updates.push('art_url = ?')
      params.push(artwork.artUrl)
    }

    if (updates.length === 0) return

    updates.push("updated_at = datetime('now')")
    params.push(sourceId, providerId)

    const sql = `UPDATE music_albums SET ${updates.join(', ')} WHERE source_id = ? AND provider_id = ?`
    this.db.prepare(sql).run(...params)
  }

  updateMusicArtistArtwork(sourceId: string, providerId: string, artwork: { thumbUrl?: string; artUrl?: string }): void {
    const updates: string[] = []
    const params: unknown[] = []

    if (artwork.thumbUrl !== undefined) {
      updates.push('thumb_url = ?')
      params.push(artwork.thumbUrl)
    }
    if (artwork.artUrl !== undefined) {
      updates.push('art_url = ?')
      params.push(artwork.artUrl)
    }

    if (updates.length === 0) return

    updates.push("updated_at = datetime('now')")
    params.push(sourceId, providerId)

    const sql = `UPDATE music_artists SET ${updates.join(', ')} WHERE source_id = ? AND provider_id = ?`
    this.db.prepare(sql).run(...params)
  }

  getMusicArtists(filters?: MusicFilters): MusicArtist[] {
    let sql = 'SELECT * FROM music_artists WHERE 1=1'
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
      sql += ' AND name LIKE ?'
      params.push(`%${filters.searchQuery}%`)
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        sql += " AND name NOT GLOB '[A-Za-z]*'"
      } else {
        sql += ' AND UPPER(SUBSTR(name, 1, 1)) = ?'
        params.push(filters.alphabetFilter.toUpperCase())
      }
    }

    const artistSortMap: Record<string, string> = { 'name': 'sort_name', 'title': 'sort_name', 'added_at': 'created_at' }
    const sortCol = artistSortMap[filters?.sortBy || ''] || 'sort_name'
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
    return stmt.all(...params) as MusicArtist[]
  }

  countMusicArtists(filters?: MusicFilters): number {
    let sql = 'SELECT COUNT(*) as count FROM music_artists WHERE 1=1'
    const params: unknown[] = []
    if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
    if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    if (filters?.searchQuery) { sql += ' AND name LIKE ?'; params.push(`%${filters.searchQuery}%`) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND name NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(name, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as { count: number } | undefined
    return row?.count || 0
  }

  getMusicArtistById(id: number): MusicArtist | null {
    const stmt = this.db.prepare('SELECT * FROM music_artists WHERE id = ?')
    return (stmt.get(id) as MusicArtist) || null
  }

  getMusicArtistByName(name: string, sourceId: string): MusicArtist | null {
    const stmt = this.db.prepare('SELECT * FROM music_artists WHERE name = ? AND source_id = ?')
    return (stmt.get(name, sourceId) as MusicArtist) || null
  }

  getMusicAlbums(filters?: MusicFilters): MusicAlbum[] {
    let sql = 'SELECT * FROM music_albums WHERE 1=1'
    const params: unknown[] = []

    if (filters?.artistId && filters?.artistName) {
      sql += ' AND (artist_id = ? OR artist_name = ?)'
      params.push(filters.artistId, filters.artistName)
    } else if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    } else if (filters?.artistName) {
      sql += ' AND artist_name = ?'
      params.push(filters.artistName)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.libraryId) {
      sql += ' AND library_id = ?'
      params.push(filters.libraryId)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR artist_name LIKE ?)'
      params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`)
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
    if (filters?.excludeAlbumTypes?.length) {
      const placeholders = filters.excludeAlbumTypes.map(() => '?').join(',')
      sql += ` AND (album_type IS NULL OR album_type NOT IN (${placeholders}))`
      params.push(...filters.excludeAlbumTypes)
    }

    const albumSortMap: Record<string, string> = { 'title': 'COALESCE(sort_title, title)', 'artist': 'artist_name', 'year': 'year', 'added_at': 'created_at' }
    const sortCol = albumSortMap[filters?.sortBy || ''] || 'artist_name'
    const sortDir = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
    if (!filters?.sortBy || filters.sortBy === 'artist') {
      sql += ` ORDER BY ${sortCol} ${sortDir}, year DESC`
    } else {
      sql += ` ORDER BY ${sortCol} ${sortDir}`
    }

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicAlbum[]
  }

  countMusicAlbums(filters?: MusicFilters): number {
    let sql = 'SELECT COUNT(*) as count FROM music_albums WHERE 1=1'
    const params: unknown[] = []
    if (filters?.artistId) { sql += ' AND artist_id = ?'; params.push(filters.artistId) }
    if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
    if (filters?.libraryId) { sql += ' AND library_id = ?'; params.push(filters.libraryId) }
    if (filters?.searchQuery) { sql += ' AND (title LIKE ? OR artist_name LIKE ?)'; params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
    if (filters?.excludeAlbumTypes?.length) {
      const placeholders = filters.excludeAlbumTypes.map(() => '?').join(',')
      sql += ` AND (album_type IS NULL OR album_type NOT IN (${placeholders}))`
      params.push(...filters.excludeAlbumTypes)
    }
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as { count: number } | undefined
    return row?.count || 0
  }

  getMusicAlbumById(id: number): MusicAlbum | null {
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE id = ?')
    return (stmt.get(id) as MusicAlbum) || null
  }

  getMusicAlbumByName(title: string, artistId: number): MusicAlbum | null {
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE title = ? AND artist_id = ?')
    return (stmt.get(title, artistId) as MusicAlbum) || null
  }

  getMusicAlbumsByArtistName(artistName: string, limit = 500): MusicAlbum[] {
    const stmt = this.db.prepare('SELECT * FROM music_albums WHERE artist_name = ? LIMIT ?')
    return stmt.all(artistName, limit) as MusicAlbum[]
  }

  getMusicTracks(filters?: MusicFilters): MusicTrack[] {
    let sql = 'SELECT * FROM music_tracks WHERE 1=1'
    const params: unknown[] = []

    if (filters?.albumId) {
      sql += ' AND album_id = ?'
      params.push(filters.albumId)
    }
    if (filters?.artistId && filters?.artistName) {
      sql += ' AND (artist_id = ? OR artist_name = ?)'
      params.push(filters.artistId, filters.artistName)
    } else if (filters?.artistId) {
      sql += ' AND artist_id = ?'
      params.push(filters.artistId)
    } else if (filters?.artistName) {
      sql += ' AND artist_name = ?'
      params.push(filters.artistName)
    }
    if (filters?.sourceId) {
      sql += ' AND source_id = ?'
      params.push(filters.sourceId)
    }
    if (filters?.searchQuery) {
      sql += ' AND (title LIKE ? OR artist_name LIKE ? OR album_name LIKE ?)'
      params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`, `%${filters.searchQuery}%`)
    }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }

    const trackSortMap: Record<string, string> = { 'title': 'title', 'artist': 'artist_name', 'album': 'album_name', 'codec': 'audio_codec', 'duration': 'duration', 'added_at': 'created_at' }
    if (filters?.sortBy && trackSortMap[filters.sortBy]) {
      const sortCol = trackSortMap[filters.sortBy]
      const sortDir = filters?.sortOrder === 'desc' ? 'DESC' : 'ASC'
      sql += ` ORDER BY ${sortCol} ${sortDir}`
    } else if (filters?.albumId) {
      sql += ' ORDER BY disc_number ASC, track_number ASC'
    } else {
      sql += ' ORDER BY title ASC'
    }

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as MusicTrack[]
  }

  getMusicTracksByAlbumIds(albumIds: number[]): Map<number, MusicTrack[]> {
    const result = new Map<number, MusicTrack[]>()
    if (albumIds.length === 0) return result

    const placeholders = albumIds.map(() => '?').join(',')
    const stmt = this.db.prepare(
      `SELECT * FROM music_tracks WHERE album_id IN (${placeholders}) ORDER BY album_id, disc_number ASC, track_number ASC`
    )
    const rows = stmt.all(...albumIds) as MusicTrack[]

    for (const track of rows) {
      if (track.album_id) {
        const list = result.get(track.album_id)
        if (list) list.push(track)
        else result.set(track.album_id, [track])
      }
    }
    return result
  }

  countMusicTracks(filters?: MusicFilters): number {
    let sql = 'SELECT COUNT(*) as count FROM music_tracks WHERE 1=1'
    const params: unknown[] = []
    if (filters?.albumId) { sql += ' AND album_id = ?'; params.push(filters.albumId) }
    if (filters?.artistId) { sql += ' AND artist_id = ?'; params.push(filters.artistId) }
    if (filters?.sourceId) { sql += ' AND source_id = ?'; params.push(filters.sourceId) }
    if (filters?.searchQuery) { sql += ' AND (title LIKE ? OR artist_name LIKE ? OR album_name LIKE ?)'; params.push(`%${filters.searchQuery}%`, `%${filters.searchQuery}%`, `%${filters.searchQuery}%`) }
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') { sql += " AND title NOT GLOB '[A-Za-z]*'" }
      else { sql += ' AND UPPER(SUBSTR(title, 1, 1)) = ?'; params.push(filters.alphabetFilter.toUpperCase()) }
    }
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as { count: number } | undefined
    return row?.count || 0
  }

  getMusicTrackById(id: number): MusicTrack | null {
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE id = ?')
    return (stmt.get(id) as MusicTrack) || null
  }

  deleteMusicTrack(id: number): void {
    this.db.prepare('DELETE FROM music_tracks WHERE id = ?').run(id)
  }

  updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): void {
    this.db.prepare(`
      UPDATE music_artists SET album_count = ?, track_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(albumCount, trackCount, artistId)
  }

  updateMusicArtistMbid(artistId: number, musicbrainzId: string): void {
    this.db.prepare(`
      UPDATE music_artists SET musicbrainz_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(musicbrainzId, artistId)
  }

  updateMusicAlbumMbid(albumId: number, musicbrainzId: string): void {
    this.db.prepare(`
      UPDATE music_albums SET musicbrainz_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(musicbrainzId, albumId)
  }

  upsertMusicQualityScore(score: MusicQualityScore): void {
    const stmt = this.db.prepare(`
      INSERT INTO music_quality_scores (
        album_id, quality_tier, tier_quality, tier_score,
        codec_score, bitrate_score, needs_upgrade, issues,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(album_id) DO UPDATE SET
        quality_tier = excluded.quality_tier,
        tier_quality = excluded.tier_quality,
        tier_score = excluded.tier_score,
        codec_score = excluded.codec_score,
        bitrate_score = excluded.bitrate_score,
        needs_upgrade = excluded.needs_upgrade,
        issues = excluded.issues,
        updated_at = datetime('now')
    `)
    stmt.run(
      score.album_id, score.quality_tier, score.tier_quality, score.tier_score,
      score.codec_score, score.bitrate_score, score.needs_upgrade ? 1 : 0, score.issues
    )
  }

  getMusicQualityScore(albumId: number): MusicQualityScore | null {
    const stmt = this.db.prepare('SELECT * FROM music_quality_scores WHERE album_id = ?')
    return (stmt.get(albumId) as MusicQualityScore) || null
  }

  getAlbumsNeedingUpgrade(limit?: number, sourceId?: string): MusicAlbum[] {
    let sql = `
      SELECT a.* FROM music_albums a
      INNER JOIN music_quality_scores q ON a.id = q.album_id
      WHERE q.needs_upgrade = 1
    `
    if (sourceId) sql += ` AND a.source_id = ?`
    sql += ` ORDER BY q.tier_score ASC`
    if (limit) sql += ` LIMIT ${limit}`

    const stmt = this.db.prepare(sql)
    return sourceId ? (stmt.all(sourceId) as MusicAlbum[]) : (stmt.all() as MusicAlbum[])
  }

  upsertArtistCompleteness(data: ArtistCompleteness): void {
    const stmt = this.db.prepare(`
      INSERT INTO artist_completeness (
        artist_name, musicbrainz_id, total_albums, owned_albums,
        total_singles, owned_singles, total_eps, owned_eps,
        missing_albums, missing_singles, missing_eps,
        completeness_percentage, efficiency_score, storage_debt_bytes, total_size,
        country, active_years, artist_type,
        thumb_url, last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(artist_name) DO UPDATE SET
        musicbrainz_id = excluded.musicbrainz_id,
        total_albums = excluded.total_albums,
        owned_albums = excluded.owned_albums,
        total_singles = excluded.total_singles,
        owned_singles = excluded.owned_singles,
        total_eps = excluded.total_eps,
        owned_eps = excluded.owned_eps,
        missing_albums = excluded.missing_albums,
        missing_singles = excluded.missing_singles,
        missing_eps = excluded.missing_eps,
        completeness_percentage = excluded.completeness_percentage,
        efficiency_score = excluded.efficiency_score,
        storage_debt_bytes = excluded.storage_debt_bytes,
        total_size = excluded.total_size,
        country = excluded.country,
        active_years = excluded.active_years,
        artist_type = excluded.artist_type,
        thumb_url = excluded.thumb_url,
        last_sync_at = excluded.last_sync_at,
        updated_at = datetime('now')
    `)
    stmt.run(
      data.artist_name, data.musicbrainz_id || null, data.total_albums, data.owned_albums,
      data.total_singles, data.owned_singles, data.total_eps, data.owned_eps,
      data.missing_albums, data.missing_singles, data.missing_eps,
      data.completeness_percentage,
      (data as any).efficiency_score || 0,
      (data as any).storage_debt_bytes || 0,
      (data as any).total_size || 0,
      data.country || null, data.active_years || null,
      data.artist_type || null, data.thumb_url || null, data.last_sync_at || null
    )
  }

  getArtistCompleteness(artistName: string): ArtistCompleteness | null {
    const stmt = this.db.prepare(`
      SELECT ac.*,
             ac.efficiency_score, ac.storage_debt_bytes, ac.total_size
      FROM artist_completeness ac 
      WHERE ac.artist_name = ?
    `)
    return (stmt.get(artistName) as ArtistCompleteness) || null
  }

  getAllArtistCompleteness(sourceId?: string): ArtistCompleteness[] {
    if (sourceId) {
      const stmt = this.db.prepare(`
        SELECT DISTINCT ac.*, 
               ac.efficiency_score, ac.storage_debt_bytes, ac.total_size
        FROM artist_completeness ac
        INNER JOIN music_artists ma ON ac.artist_name = ma.name AND ma.source_id = ?
        ORDER BY ac.artist_name ASC
      `)
      return stmt.all(sourceId) as ArtistCompleteness[]
    }
    const stmt = this.db.prepare('SELECT * FROM artist_completeness ORDER BY artist_name ASC')
    return stmt.all() as ArtistCompleteness[]
  }

  upsertAlbumCompleteness(data: AlbumCompleteness): void {
    const stmt = this.db.prepare(`
      INSERT INTO album_completeness (
        album_id, artist_name, album_title,
        musicbrainz_release_id, musicbrainz_release_group_id,
        total_tracks, owned_tracks, missing_tracks,
        completeness_percentage, efficiency_score, storage_debt_bytes, total_size,
        last_sync_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(album_id) DO UPDATE SET
        artist_name = excluded.artist_name,
        album_title = excluded.album_title,
        musicbrainz_release_id = excluded.musicbrainz_release_id,
        musicbrainz_release_group_id = excluded.musicbrainz_release_group_id,
        total_tracks = excluded.total_tracks,
        owned_tracks = excluded.owned_tracks,
        missing_tracks = excluded.missing_tracks,
        completeness_percentage = excluded.completeness_percentage,
        efficiency_score = excluded.efficiency_score,
        storage_debt_bytes = excluded.storage_debt_bytes,
        total_size = excluded.total_size,
        last_sync_at = excluded.last_sync_at,
        updated_at = datetime('now')
    `)
    stmt.run(
      data.album_id, data.artist_name, data.album_title,
      data.musicbrainz_release_id || null, data.musicbrainz_release_group_id || null,
      data.total_tracks, data.owned_tracks, data.missing_tracks,
      data.completeness_percentage,
      (data as any).efficiency_score || 0,
      (data as any).storage_debt_bytes || 0,
      (data as any).total_size || 0,
      data.last_sync_at || null
    )
  }

  getAlbumCompleteness(albumId: number): AlbumCompleteness | null {
    const stmt = this.db.prepare('SELECT * FROM album_completeness WHERE album_id = ?')
    return (stmt.get(albumId) as AlbumCompleteness) || null
  }

  getAllAlbumCompleteness(): AlbumCompleteness[] {
    const stmt = this.db.prepare('SELECT * FROM album_completeness ORDER BY artist_name, album_title')
    return stmt.all() as AlbumCompleteness[]
  }

  getAlbumCompletenessByArtist(artistName: string): AlbumCompleteness[] {
    const stmt = this.db.prepare('SELECT * FROM album_completeness WHERE artist_name = ?')
    return stmt.all(artistName) as AlbumCompleteness[]
  }

  getIncompleteAlbums(): AlbumCompleteness[] {
    const stmt = this.db.prepare(
      'SELECT * FROM album_completeness WHERE completeness_percentage < 100 ORDER BY completeness_percentage ASC'
    )
    return stmt.all() as AlbumCompleteness[]
  }

  getMusicAlbumsByMusicbrainzIds(ids: string[]): Map<string, MusicAlbum> {
    const result = new Map<string, MusicAlbum>()
    if (ids.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const placeholders = batch.map(() => '?').join(',')
      const stmt = this.db.prepare(`SELECT * FROM music_albums WHERE musicbrainz_id IN (${placeholders})`)
      const rows = stmt.all(...batch) as MusicAlbum[]
      for (const row of rows) {
        if (row.musicbrainz_id) result.set(row.musicbrainz_id, row)
      }
    }
    return result
  }

  getMusicTrackByMusicbrainzId(id: string): MusicTrack | null {
    const stmt = this.db.prepare('SELECT * FROM music_tracks WHERE musicbrainz_id = ? LIMIT 1')
    return (stmt.get(id) as MusicTrack) || null
  }

  getMusicStats(sourceId?: string): {
    totalArtists: number
    totalAlbums: number
    totalTracks: number
    totalSize: number
    avgAudioBitrate: number
  } {
    let sqlArtists = 'SELECT COUNT(*) as count FROM music_artists'
    let sqlAlbums = 'SELECT COUNT(*) as count, SUM(total_size) as total_size, AVG(avg_audio_bitrate) as avg_bitrate FROM music_albums'
    let sqlTracks = 'SELECT COUNT(*) as count FROM music_tracks'
    const params: any[] = []

    if (sourceId) {
      sqlArtists += ' WHERE source_id = ?'
      sqlAlbums += ' WHERE source_id = ?'
      sqlTracks += ' WHERE source_id = ?'
      params.push(sourceId)
    }

    const artistRow = this.db.prepare(sqlArtists).get(...params) as { count: number }
    const albumRow = this.db.prepare(sqlAlbums).get(...params) as { count: number; total_size: number; avg_bitrate: number }
    const trackRow = this.db.prepare(sqlTracks).get(...params) as { count: number }

    return {
      totalArtists: artistRow?.count || 0,
      totalAlbums: albumRow?.count || 0,
      totalTracks: trackRow?.count || 0,
      totalSize: albumRow?.total_size || 0,
      avgAudioBitrate: albumRow?.avg_bitrate || 0
    }
  }
}
