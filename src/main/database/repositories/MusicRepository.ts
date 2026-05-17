import { eq, and, or, like, desc, asc, sql, inArray, isNull, lt } from 'drizzle-orm'
import type { MusicArtist, MusicAlbum, MusicTrack, MusicQualityScore, ArtistCompleteness, AlbumCompleteness, MusicFilters } from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'
import { PathUtils } from '@main/services/utils/PathUtils'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'

export class MusicRepository extends BaseRepository<typeof schema.musicTracks> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'music_tracks', drizzle, schema.musicTracks)
  }

  async getTrackByPath(filePath: string): Promise<MusicTrack | null> {
    const dbPath = PathUtils.toDatabasePath(filePath)
    const row = await this.drizzle.select()
      .from(schema.musicTracks)
      .where(eq(schema.musicTracks.filePath, dbPath))
      .get()
    return row ? this.mapDrizzleToTrack(row) : null
  }

  async getMusicTracksByAlbumIds(albumIds: number[]): Promise<Map<number, MusicTrack[]>> {
    const result = new Map<number, MusicTrack[]>()
    if (!albumIds || albumIds.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < albumIds.length; i += batchSize) {
      const batch = albumIds.slice(i, i + batchSize)
      const rows = await this.drizzle.select()
        .from(schema.musicTracks)
        .where(inArray(schema.musicTracks.albumId, batch))
        .orderBy(schema.musicTracks.albumId, asc(schema.musicTracks.discNumber), asc(schema.musicTracks.trackNumber))
        .all()
      
      for (const row of rows) {
        if (row.albumId) {
          const tracks = result.get(row.albumId) || []
          tracks.push(this.mapDrizzleToTrack(row))
          result.set(row.albumId, tracks)
        }
      }
    }
    return result
  }

  async upsertTrack(track: MusicTrack): Promise<number> {
    const data = {
      sourceId: track.source_id,
      sourceType: track.source_type,
      libraryId: track.library_id || '',
      providerId: track.provider_id,
      albumId: track.album_id ?? null,
      artistId: track.artist_id ?? null,
      albumName: track.album_name ?? null,
      artistName: track.artist_name,
      title: track.title,
      trackNumber: track.track_number ?? null,
      discNumber: track.disc_number ?? 1,
      duration: track.duration ?? null,
      filePath: PathUtils.toDatabasePath(track.file_path || ''),
      fileSize: track.file_size ?? null,
      container: track.container ?? null,
      fileMtime: track.file_mtime ?? null,
      audioCodec: track.audio_codec,
      audioBitrate: track.audio_bitrate ?? null,
      sampleRate: track.sample_rate ?? null,
      bitDepth: track.bit_depth ?? null,
      channels: track.channels ?? 2,
      isLossless: track.is_lossless ? 1 : 0,
      isHiRes: track.is_hi_res ? 1 : 0,
      musicbrainzId: track.musicbrainz_id ?? null,
      genres: track.genres ?? null,
      mood: track.mood ?? null,
      addedAt: track.added_at ?? null,
    }

    return await this.upsertWithProviderId(
      schema.musicTracks,
      data,
      [schema.musicTracks.sourceId, schema.musicTracks.providerId],
      { ...data, musicbrainzId: sql`COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id)` }
    )
  }

  async upsertArtist(artist: MusicArtist): Promise<number> {
    const data = {
      sourceId: artist.source_id,
      sourceType: artist.source_type,
      libraryId: artist.library_id || '',
      providerId: artist.provider_id,
      name: artist.name,
      sortName: artist.sort_name || null,
      musicbrainzId: artist.musicbrainz_id || null,
      genres: artist.genres || null,
      mood: artist.mood || null,
      country: artist.country || null,
      biography: artist.biography || null,
      thumbUrl: artist.thumb_url || null,
      artUrl: artist.art_url || null,
      albumCount: artist.album_count || 0,
      trackCount: artist.track_count || 0,
      userFixedMatch: artist.user_fixed_match ? 1 : 0,
    }

    return await this.upsertWithProviderId(
      schema.musicArtists,
      data,
      [schema.musicArtists.sourceId, schema.musicArtists.providerId],
      {
        ...data,
        name: sql`CASE WHEN user_fixed_match = 1 THEN name ELSE excluded.name END`,
        sortName: sql`CASE WHEN user_fixed_match = 1 THEN sort_name ELSE excluded.sort_name END`,
        musicbrainzId: sql`CASE WHEN user_fixed_match = 1 THEN musicbrainz_id ELSE COALESCE(excluded.musicbrainz_id, music_artists.musicbrainz_id) END`,
        thumbUrl: sql`CASE WHEN user_fixed_match = 1 THEN thumb_url ELSE COALESCE(excluded.thumb_url, music_artists.thumb_url) END`,
        artUrl: sql`CASE WHEN user_fixed_match = 1 THEN art_url ELSE COALESCE(excluded.art_url, music_artists.art_url) END`,
        userFixedMatch: sql`CASE WHEN user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END`,
      }
    )
  }

  async upsertAlbum(album: MusicAlbum): Promise<number> {
    const data = {
      sourceId: album.source_id,
      sourceType: album.source_type,
      libraryId: album.library_id || '',
      providerId: album.provider_id,
      artistId: album.artist_id ?? null,
      artistName: album.artist_name,
      title: album.title,
      sortTitle: album.sort_title || null,
      year: album.year ?? null,
      musicbrainzId: album.musicbrainz_id || null,
      musicbrainzReleaseGroupId: album.musicbrainz_release_group_id || null,
      genres: album.genres || null,
      mood: album.mood || null,
      studio: album.studio || null,
      albumType: album.album_type || null,
      trackCount: album.track_count || 0,
      totalDuration: album.total_duration || 0,
      totalSize: album.total_size || 0,
      bestAudioCodec: album.best_audio_codec || null,
      bestAudioBitrate: album.best_audio_bitrate || null,
      bestSampleRate: album.best_sample_rate || null,
      bestBitDepth: album.best_bit_depth || null,
      avgAudioBitrate: album.avg_audio_bitrate || null,
      thumbUrl: album.thumb_url || null,
      artUrl: album.art_url || null,
      releaseDate: album.release_date || null,
      addedAt: album.added_at || null,
      userFixedMatch: album.user_fixed_match ? 1 : 0,
    }

    return await this.upsertWithProviderId(
      schema.musicAlbums,
      data,
      [schema.musicAlbums.sourceId, schema.musicAlbums.providerId],
      {
        ...data,
        title: sql`CASE WHEN user_fixed_match = 1 THEN title ELSE excluded.title END`,
        sortTitle: sql`CASE WHEN user_fixed_match = 1 THEN sort_title ELSE excluded.sort_title END`,
        year: sql`CASE WHEN user_fixed_match = 1 THEN year ELSE excluded.year END`,
        musicbrainzId: sql`CASE WHEN user_fixed_match = 1 THEN musicbrainz_id ELSE COALESCE(excluded.musicbrainz_id, music_albums.musicbrainz_id) END`,
        musicbrainzReleaseGroupId: sql`CASE WHEN user_fixed_match = 1 THEN musicbrainz_release_group_id ELSE COALESCE(excluded.musicbrainz_release_group_id, music_albums.musicbrainz_release_group_id) END`,
        thumbUrl: sql`CASE WHEN user_fixed_match = 1 THEN thumb_url ELSE COALESCE(excluded.thumb_url, music_albums.thumb_url) END`,
        artUrl: sql`CASE WHEN user_fixed_match = 1 THEN art_url ELSE COALESCE(excluded.art_url, music_albums.art_url) END`,
        userFixedMatch: sql`CASE WHEN user_fixed_match = 1 THEN 1 ELSE excluded.user_fixed_match END`,
      }
    )
  }

  async updateMusicAlbumArtwork(sourceIdOrAlbumId: string | number, providerIdOrThumbUrl?: string, artwork?: { thumbUrl?: string; artUrl?: string }): Promise<void> {
    if (typeof sourceIdOrAlbumId === 'number') {
      const albumId = sourceIdOrAlbumId
      const thumbUrl = providerIdOrThumbUrl as string | undefined
      if (!thumbUrl) return
      await this.drizzle.update(schema.musicAlbums)
        .set({ thumbUrl, updatedAt: sql`(datetime('now'))` })
        .where(eq(schema.musicAlbums.id, albumId))
      return
    }

    const sourceId = sourceIdOrAlbumId
    const providerId = providerIdOrThumbUrl as string
    if (!artwork) return

    const data: any = { updatedAt: sql`(datetime('now'))` }
    if (artwork.thumbUrl !== undefined) data.thumbUrl = artwork.thumbUrl
    if (artwork.artUrl !== undefined) data.artUrl = artwork.artUrl

    await this.drizzle.update(schema.musicAlbums)
      .set(data)
      .where(and(
        eq(schema.musicAlbums.sourceId, sourceId),
        eq(schema.musicAlbums.providerId, providerId)
      ))
  }

  async updateMusicArtistArtwork(sourceId: string, providerId: string, artwork: { thumbUrl?: string; artUrl?: string }): Promise<void> {
    const data: any = { updatedAt: sql`(datetime('now'))` }
    if (artwork.thumbUrl !== undefined) data.thumbUrl = artwork.thumbUrl
    if (artwork.artUrl !== undefined) data.artUrl = artwork.artUrl

    await this.drizzle.update(schema.musicArtists)
      .set(data)
      .where(and(
        eq(schema.musicArtists.sourceId, sourceId),
        eq(schema.musicArtists.providerId, providerId)
      ))
  }

  async getArtists(filters?: MusicFilters): Promise<MusicArtist[]> {
    const conditions = []
    if (filters?.sourceId) conditions.push(eq(schema.musicArtists.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.musicArtists.libraryId, filters.libraryId))
    if (filters?.searchQuery) conditions.push(like(schema.musicArtists.name, `%${filters.searchQuery}%`))
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`name NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(name, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }
    if (filters?.mood) conditions.push(like(schema.musicArtists.mood, `%${filters.mood}%`))
    if (filters?.genre) conditions.push(like(schema.musicArtists.genres, `%${filters.genre}%`))

    const sortMap: any = { 'name': schema.musicArtists.sortName, 'title': schema.musicArtists.sortName, 'added_at': schema.musicArtists.createdAt }
    const sortCol = sortMap[filters?.sortBy || ''] || schema.musicArtists.sortName
    const sortOrder = filters?.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol)

    const query = this.drizzle.select().from(schema.musicArtists)
    if (conditions.length > 0) query.where(and(...conditions))
    query.orderBy(sortOrder)
    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    return this.mapDrizzleToArtists(rows)
  }

  async countMusicArtists(filters?: MusicFilters): Promise<number> {
    const conditions = []
    if (filters?.sourceId) conditions.push(eq(schema.musicArtists.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.musicArtists.libraryId, filters.libraryId))
    if (filters?.searchQuery) conditions.push(like(schema.musicArtists.name, `%${filters.searchQuery}%`))
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`name NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(name, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }

    const query = this.drizzle.select({ count: sql<number>`count(*)` }).from(schema.musicArtists)
    if (conditions.length > 0) query.where(and(...conditions))
    const res = await query.get()
    return res?.count || 0
  }

  async getArtistById(id: number): Promise<MusicArtist | null> {
    const row = await this.drizzle.select().from(schema.musicArtists).where(eq(schema.musicArtists.id, id)).get()
    return row ? this.mapDrizzleToArtists([row])[0] : null
  }

  async getMusicArtistByName(name: string, sourceId: string): Promise<MusicArtist | null> {
    const row = await this.drizzle.select().from(schema.musicArtists).where(and(eq(schema.musicArtists.name, name), eq(schema.musicArtists.sourceId, sourceId))).get()
    return row ? this.mapDrizzleToArtists([row])[0] : null
  }

  async getAlbums(filters?: MusicFilters): Promise<MusicAlbum[]> {
    const conditions = []
    if (filters?.artistId && filters?.artistName) conditions.push(or(eq(schema.musicAlbums.artistId, filters.artistId), eq(schema.musicAlbums.artistName, filters.artistName)))
    else if (filters?.artistId) conditions.push(eq(schema.musicAlbums.artistId, filters.artistId))
    else if (filters?.artistName) conditions.push(eq(schema.musicAlbums.artistName, filters.artistName))
    
    if (filters?.sourceId) conditions.push(eq(schema.musicAlbums.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.musicAlbums.libraryId, filters.libraryId))
    if (filters?.searchQuery) conditions.push(or(like(schema.musicAlbums.title, `%${filters.searchQuery}%`), like(schema.musicAlbums.artistName, `%${filters.searchQuery}%`)))
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`title NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }
    if (filters?.excludeAlbumTypes?.length) conditions.push(or(isNull(schema.musicAlbums.albumType), sql`${schema.musicAlbums.albumType} NOT IN (${sql.join(filters.excludeAlbumTypes, sql`,`)})`))
    if (filters?.mood) conditions.push(like(schema.musicAlbums.mood, `%${filters.mood}%`))
    if (filters?.genre) conditions.push(like(schema.musicAlbums.genres, `%${filters.genre}%`))

    const sortMap: any = { 'title': sql`COALESCE(${schema.musicAlbums.sortTitle}, ${schema.musicAlbums.title})`, 'artist': schema.musicAlbums.artistName, 'year': schema.musicAlbums.year, 'added_at': schema.musicAlbums.createdAt }
    const sortCol = sortMap[filters?.sortBy || ''] || schema.musicAlbums.artistName
    const sortOrder = filters?.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol)

    const query = this.drizzle.select().from(schema.musicAlbums)
    if (conditions.length > 0) query.where(and(...conditions))
    query.orderBy(sortOrder)
    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    return this.mapDrizzleToAlbums(rows)
  }

  async getMusicAlbums(filters: MusicFilters = {}): Promise<MusicAlbum[]> {
    return this.getAlbums(filters)
  }

  async countMusicAlbums(filters?: MusicFilters): Promise<number> {
    const conditions = []
    if (filters?.artistId) conditions.push(eq(schema.musicAlbums.artistId, filters.artistId))
    if (filters?.sourceId) conditions.push(eq(schema.musicAlbums.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.musicAlbums.libraryId, filters.libraryId))
    if (filters?.searchQuery) conditions.push(or(like(schema.musicAlbums.title, `%${filters.searchQuery}%`), like(schema.musicAlbums.artistName, `%${filters.searchQuery}%`)))
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`title NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }
    if (filters?.excludeAlbumTypes?.length) conditions.push(or(isNull(schema.musicAlbums.albumType), sql`${schema.musicAlbums.albumType} NOT IN (${sql.join(filters.excludeAlbumTypes, sql`,`)})`))

    const query = this.drizzle.select({ count: sql<number>`count(*)` }).from(schema.musicAlbums)
    if (conditions.length > 0) query.where(and(...conditions))
    const res = await query.get()
    return res?.count || 0
  }

  async getAlbumById(id: number): Promise<MusicAlbum | null> {
    const row = await this.drizzle.select().from(schema.musicAlbums).where(eq(schema.musicAlbums.id, id)).get()
    return row ? this.mapDrizzleToAlbums([row])[0] : null
  }

  async getAlbumsByIds(ids: number[]): Promise<MusicAlbum[]> {
    if (ids.length === 0) return []
    const result: MusicAlbum[] = []
    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const rows = await this.drizzle.select().from(schema.musicAlbums).where(inArray(schema.musicAlbums.id, batch)).all()
      result.push(...this.mapDrizzleToAlbums(rows))
    }
    return result
  }

  async getAlbumByName(title: string, artistId: number): Promise<MusicAlbum | null> {
    const row = await this.drizzle.select().from(schema.musicAlbums).where(and(eq(schema.musicAlbums.title, title), eq(schema.musicAlbums.artistId, artistId))).get()
    return row ? this.mapDrizzleToAlbums([row])[0] : null
  }

  async getAlbumsByArtistName(artistName: string, limit = 500): Promise<MusicAlbum[]> {
    const rows = await this.drizzle.select().from(schema.musicAlbums).where(eq(schema.musicAlbums.artistName, artistName)).limit(limit).all()
    return this.mapDrizzleToAlbums(rows)
  }

  async getTracks(filters?: MusicFilters): Promise<MusicTrack[]> {
    const conditions = []
    if (filters?.albumId) conditions.push(eq(schema.musicTracks.albumId, filters.albumId))
    if (filters?.artistId && filters?.artistName) conditions.push(or(eq(schema.musicTracks.artistId, filters.artistId), eq(schema.musicTracks.artistName, filters.artistName)))
    else if (filters?.artistId) conditions.push(eq(schema.musicTracks.artistId, filters.artistId))
    else if (filters?.artistName) conditions.push(eq(schema.musicTracks.artistName, filters.artistName))
    if (filters?.sourceId) conditions.push(eq(schema.musicTracks.sourceId, filters.sourceId))
    if (filters?.searchQuery) conditions.push(or(like(schema.musicTracks.title, `%${filters.searchQuery}%`), like(schema.musicTracks.artistName, `%${filters.searchQuery}%`), like(schema.musicTracks.albumName, `%${filters.searchQuery}%`)))
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`title NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }
    if (filters?.mood) conditions.push(like(schema.musicTracks.mood, `%${filters.mood}%`))
    if (filters?.genre) conditions.push(like(schema.musicTracks.genres, `%${filters.genre}%`))

    const sortMap: any = { 'title': schema.musicTracks.title, 'artist': schema.musicTracks.artistName, 'album': schema.musicTracks.albumName, 'codec': schema.musicTracks.audioCodec, 'duration': schema.musicTracks.duration, 'added_at': schema.musicTracks.createdAt }
    const query = this.drizzle.select().from(schema.musicTracks)
    if (conditions.length > 0) query.where(and(...conditions))
    
    if (filters?.sortBy && sortMap[filters.sortBy]) {
      const sortCol = sortMap[filters.sortBy]
      query.orderBy(filters.sortOrder === 'desc' ? desc(sortCol) : asc(sortCol))
    } else if (filters?.albumId) {
      query.orderBy(asc(schema.musicTracks.discNumber), asc(schema.musicTracks.trackNumber))
    } else {
      query.orderBy(asc(schema.musicTracks.title))
    }

    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    return this.mapDrizzleToTrackList(rows)
  }

  async getMusicTracks(filters: MusicFilters = {}): Promise<MusicTrack[]> {
    return this.getTracks(filters)
  }

  async countMusicTracks(filters?: MusicFilters): Promise<number> {
    const conditions = []
    if (filters?.albumId) conditions.push(eq(schema.musicTracks.albumId, filters.albumId))
    if (filters?.artistId) conditions.push(eq(schema.musicTracks.artistId, filters.artistId))
    if (filters?.sourceId) conditions.push(eq(schema.musicTracks.sourceId, filters.sourceId))
    if (filters?.searchQuery) {
      conditions.push(this.buildSearchFilter([schema.musicTracks.title, schema.musicTracks.artistName, schema.musicTracks.albumName], filters.searchQuery))
    }
    if (filters?.alphabetFilter) {
      conditions.push(this.buildAlphabetFilter(schema.musicTracks.title, filters.alphabetFilter))
    }

    return await this.countInternal(and(...conditions))
  }

  async getTrackById(id: number): Promise<MusicTrack | null> {
    const row = await this.drizzle.select().from(schema.musicTracks).where(eq(schema.musicTracks.id, id)).get()
    return row ? this.mapDrizzleToTrack(row) : null
  }

  async deleteMusicTrack(id: number): Promise<void> {
    await this.drizzle.delete(schema.musicTracks).where(eq(schema.musicTracks.id, id))
  }

  async updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): Promise<void> {
    await this.drizzle.update(schema.musicArtists)
      .set({ albumCount, trackCount, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.musicArtists.id, artistId))
  }

  async updateAllMusicArtistCounts(sourceId?: string): Promise<void> {
    // Note: Drizzle subquery update syntax is a bit restrictive for this pattern, using sql tag for reliability
    let sqlStr = sql`
      UPDATE music_artists SET
        album_count = (SELECT COUNT(*) FROM music_albums WHERE artist_id = music_artists.id),
        track_count = (SELECT COUNT(*) FROM music_tracks WHERE artist_id = music_artists.id),
        updated_at = (datetime('now'))
    `
    if (sourceId) sqlStr = sql`${sqlStr} WHERE source_id = ${sourceId}`
    await this.drizzle.run(sqlStr)
  }

  async updateMusicArtistMbid(artistId: number, musicbrainzId: string): Promise<void> {
    await this.drizzle.update(schema.musicArtists).set({ musicbrainzId, updatedAt: sql`(datetime('now'))` }).where(eq(schema.musicArtists.id, artistId))
  }

  async updateMusicAlbumMbid(albumId: number, musicbrainzId: string): Promise<void> {
    await this.drizzle.update(schema.musicAlbums).set({ musicbrainzId, updatedAt: sql`(datetime('now'))` }).where(eq(schema.musicAlbums.id, albumId))
  }

  async upsertMusicQualityScore(score: MusicQualityScore): Promise<void> {
    await this.upsertQualityScore(score)
  }

  async upsertQualityScore(score: MusicQualityScore): Promise<void> {
    await this.drizzle.insert(schema.musicQualityScores)
      .values({
        albumId: score.album_id,
        qualityTier: score.quality_tier || 'LOSSY_MID',
        tierQuality: score.tier_quality || 'MEDIUM',
        tierScore: score.tier_score || 0,
        codecScore: score.codec_score || 0,
        bitrateScore: score.bitrate_score || 0,
        efficiencyScore: score.efficiency_score || 0,
        storageDebtBytes: score.storage_debt_bytes || 0,
        needsUpgrade: score.needs_upgrade ? 1 : 0,
        issues: score.issues || '[]',
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .onConflictDoUpdate({
        target: schema.musicQualityScores.albumId,
        set: {
          qualityTier: score.quality_tier,
          tierQuality: score.tier_quality,
          tierScore: score.tier_score,
          codecScore: score.codec_score,
          bitrateScore: score.bitrate_score,
          efficiencyScore: score.efficiency_score || 0,
          storageDebtBytes: score.storage_debt_bytes || 0,
          needsUpgrade: score.needs_upgrade ? 1 : 0,
          issues: score.issues || '[]',
          updatedAt: sql`(datetime('now'))`
        }
      })
  }

  async getQualityScore(albumId: number): Promise<MusicQualityScore | null> {
    const row = await this.drizzle.select().from(schema.musicQualityScores).where(eq(schema.musicQualityScores.albumId, albumId)).get()
    return row ? this.mapDrizzleToQualityScore(row) : null
  }

  async getQualityScoresByAlbumIds(albumIds: number[]): Promise<Map<number, MusicQualityScore>> {
    const result = new Map<number, MusicQualityScore>()
    if (albumIds.length === 0) return result
    const batchSize = 500
    for (let i = 0; i < albumIds.length; i += batchSize) {
      const batch = albumIds.slice(i, i + batchSize)
      const rows = await this.drizzle.select().from(schema.musicQualityScores).where(inArray(schema.musicQualityScores.albumId, batch)).all()
      rows.forEach(r => result.set(r.albumId, this.mapDrizzleToQualityScore(r)))
    }
    return result
  }

  async getAlbumsNeedingUpgrade(limit?: number, sourceId?: string): Promise<MusicAlbum[]> {
    const conditions = [eq(schema.musicQualityScores.needsUpgrade, 1)]
    if (sourceId) conditions.push(eq(schema.musicAlbums.sourceId, sourceId))

    const query = this.drizzle.select({ album: schema.musicAlbums })
      .from(schema.musicAlbums)
      .innerJoin(schema.musicQualityScores, eq(schema.musicAlbums.id, schema.musicQualityScores.albumId))
      .where(and(...conditions))
      .orderBy(asc(schema.musicQualityScores.tierScore))
    
    if (limit) query.limit(limit)

    const rows = await query.all()
    return this.mapDrizzleToAlbums(rows.map(r => r.album))
  }

  async upsertArtistCompleteness(data: ArtistCompleteness): Promise<void> {
    await this.drizzle.insert(schema.artistCompleteness)
      .values({
        artistName: data.artist_name,
        musicbrainzId: data.musicbrainz_id || null,
        libraryId: data.library_id || '',
        totalAlbums: data.total_albums || 0,
        ownedAlbums: data.owned_albums || 0,
        totalSingles: data.total_singles || 0,
        ownedSingles: data.owned_singles || 0,
        totalEps: data.total_eps || 0,
        ownedEps: data.owned_eps || 0,
        missingAlbums: data.missing_albums || '[]',
        missingSingles: data.missing_singles || '[]',
        missingEps: data.missing_eps || '[]',
        completenessPercentage: data.completeness_percentage || 0,
        efficiencyScore: data.efficiency_score || 0,
        storageDebtBytes: data.storage_debt_bytes || 0,
        totalSize: data.total_size || 0,
        country: data.country || null,
        activeYears: data.active_years || null,
        artistType: data.artist_type || null,
        thumbUrl: data.thumb_url || null,
        lastSyncAt: data.last_sync_at || null,
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .onConflictDoUpdate({
        target: schema.artistCompleteness.artistName,
        set: {
          musicbrainzId: data.musicbrainz_id || null,
          totalAlbums: data.total_albums || 0,
          ownedAlbums: data.owned_albums || 0,
          totalSingles: data.total_singles || 0,
          ownedSingles: data.owned_singles || 0,
          totalEps: data.total_eps || 0,
          ownedEps: data.owned_eps || 0,
          missingAlbums: data.missing_albums || '[]',
          missingSingles: data.missing_singles || '[]',
          missingEps: data.missing_eps || '[]',
          completenessPercentage: data.completeness_percentage || 0,
          efficiencyScore: data.efficiency_score || 0,
          storageDebtBytes: data.storage_debt_bytes || 0,
          totalSize: data.total_size || 0,
          country: data.country || null,
          activeYears: data.active_years || null,
          artistType: data.artist_type || null,
          thumbUrl: data.thumb_url || null,
          lastSyncAt: data.last_sync_at || null,
          updatedAt: sql`(datetime('now'))`
        }
      })
  }

  async getArtistCompleteness(artistName: string): Promise<ArtistCompleteness | null> {
    const row = await this.drizzle.select().from(schema.artistCompleteness).where(eq(schema.artistCompleteness.artistName, artistName)).get()
    return row ? this.mapDrizzleToArtistCompleteness(row) : null
  }

  async getAllArtistCompleteness(sourceId?: string): Promise<ArtistCompleteness[]> {
    if (sourceId) {
      const rows = await this.drizzle.selectDistinct({ ac: schema.artistCompleteness })
        .from(schema.artistCompleteness)
        .innerJoin(schema.musicArtists, and(eq(schema.artistCompleteness.artistName, schema.musicArtists.name), eq(schema.musicArtists.sourceId, sourceId)))
        .orderBy(asc(schema.artistCompleteness.artistName))
        .all()
      return rows.map(r => this.mapDrizzleToArtistCompleteness(r.ac))
    }
    const rows = await this.drizzle.select().from(schema.artistCompleteness).orderBy(asc(schema.artistCompleteness.artistName)).all()
    return rows.map(r => this.mapDrizzleToArtistCompleteness(r))
  }

  async upsertAlbumCompleteness(data: AlbumCompleteness): Promise<void> {
    await this.drizzle.insert(schema.albumCompleteness)
      .values({
        albumId: data.album_id,
        artistName: data.artist_name,
        albumTitle: data.album_title,
        musicbrainzReleaseId: data.musicbrainz_release_id || null,
        musicbrainzReleaseGroupId: data.musicbrainz_release_group_id || null,
        totalTracks: data.total_tracks || 0,
        ownedTracks: data.owned_tracks || 0,
        missingTracks: data.missing_tracks || '[]',
        completenessPercentage: data.completeness_percentage || 0,
        efficiencyScore: data.efficiency_score || 0,
        storageDebtBytes: data.storage_debt_bytes || 0,
        totalSize: data.total_size || 0,
        lastSyncAt: data.last_sync_at || null,
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`
      })
      .onConflictDoUpdate({
        target: schema.albumCompleteness.albumId,
        set: {
          artistName: data.artist_name,
          albumTitle: data.album_title,
          musicbrainzReleaseId: data.musicbrainz_release_id || null,
          musicbrainzReleaseGroupId: data.musicbrainz_release_group_id || null,
          totalTracks: data.total_tracks || 0,
          ownedTracks: data.owned_tracks || 0,
          missingTracks: data.missing_tracks || '[]',
          completenessPercentage: data.completeness_percentage || 0,
          efficiencyScore: data.efficiency_score || 0,
          storageDebtBytes: data.storage_debt_bytes || 0,
          totalSize: data.total_size || 0,
          lastSyncAt: data.last_sync_at || null,
          updatedAt: sql`(datetime('now'))`
        }
      })
  }

  async getAlbumCompleteness(albumId: number): Promise<AlbumCompleteness | null> {
    const row = await this.drizzle.select().from(schema.albumCompleteness).where(eq(schema.albumCompleteness.albumId, albumId)).get()
    return row ? this.mapDrizzleToAlbumCompleteness(row) : null
  }

  async getAllAlbumCompleteness(): Promise<AlbumCompleteness[]> {
    const rows = await this.drizzle.select().from(schema.albumCompleteness).orderBy(asc(schema.albumCompleteness.artistName), asc(schema.albumCompleteness.albumTitle)).all()
    return rows.map(r => this.mapDrizzleToAlbumCompleteness(r))
  }

  async getAlbumCompletenessByArtist(artistName: string): Promise<AlbumCompleteness[]> {
    const rows = await this.drizzle.select().from(schema.albumCompleteness).where(eq(schema.albumCompleteness.artistName, artistName)).all()
    return rows.map(r => this.mapDrizzleToAlbumCompleteness(r))
  }

  async getIncompleteAlbums(): Promise<AlbumCompleteness[]> {
    const rows = await this.drizzle.select().from(schema.albumCompleteness).where(lt(schema.albumCompleteness.completenessPercentage, 100)).orderBy(asc(schema.albumCompleteness.completenessPercentage)).all()
    return rows.map(r => this.mapDrizzleToAlbumCompleteness(r))
  }

  async getAlbumsByMusicbrainzIds(ids: string[]): Promise<Map<string, MusicAlbum>> {
    const result = new Map<string, MusicAlbum>()
    if (ids.length === 0) return result
    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const rows = await this.drizzle.select().from(schema.musicAlbums).where(inArray(schema.musicAlbums.musicbrainzId, batch)).all()
      rows.forEach(r => { if (r.musicbrainzId) result.set(r.musicbrainzId, this.mapDrizzleToAlbums([r])[0]) })
    }
    return result
  }

  async getTrackByMusicbrainzId(id: string): Promise<MusicTrack | null> {
    const row = await this.drizzle.select().from(schema.musicTracks).where(eq(schema.musicTracks.musicbrainzId, id)).limit(1).get()
    return row ? this.mapDrizzleToTrack(row) : null
  }

  async deleteTrack(id: number): Promise<void> {
    await this.delete(id)
  }

  async removeStaleProviderTracks(sourceId: string, libraryId: string, validProviderIds: Set<string>): Promise<number> {
    const where = and(
      eq(schema.musicTracks.sourceId, sourceId),
      eq(schema.musicTracks.libraryId, libraryId)
    )
    return await this.reconcileStaleItems(where, schema.musicTracks.providerId, validProviderIds)
  }

  async removeStaleProviderAlbums(sourceId: string, libraryId: string, validProviderIds: Set<string>): Promise<number> {
    const existing = await this.drizzle.select({ id: schema.musicAlbums.id, providerId: schema.musicAlbums.providerId })
      .from(schema.musicAlbums)
      .where(and(eq(schema.musicAlbums.sourceId, sourceId), eq(schema.musicAlbums.libraryId, libraryId)))
    
    const staleIds = existing.filter(t => !validProviderIds.has(t.providerId)).map(t => t.id)
    if (staleIds.length > 0) {
      await this.db.execute({ sql: `DELETE FROM music_albums WHERE id IN (${staleIds.join(',')})`, args: [] })
    }
    return staleIds.length
  }

  async removeStaleProviderArtists(sourceId: string, validProviderIds: Set<string>): Promise<number> {
    const existing = await this.drizzle.select({ id: schema.musicArtists.id, providerId: schema.musicArtists.providerId })
      .from(schema.musicArtists)
      .where(eq(schema.musicArtists.sourceId, sourceId))
    
    const staleIds = existing.filter(t => !validProviderIds.has(t.providerId)).map(t => t.id)
    if (staleIds.length > 0) {
      await this.db.execute({ sql: `DELETE FROM music_artists WHERE id IN (${staleIds.join(',')})`, args: [] })
    }
    return staleIds.length
  }

  private mapDrizzleToTrack(r: any): MusicTrack {
    return { ...r, source_id: r.sourceId, source_type: r.sourceType, library_id: r.libraryId, provider_id: r.providerId, album_id: r.albumId, artist_id: r.artistId, album_name: r.albumName, artist_name: r.artistName, track_number: r.trackNumber, disc_number: r.discNumber, file_path: r.filePath, file_size: r.fileSize, file_mtime: r.fileMtime, audio_codec: r.audioCodec, audio_bitrate: r.audioBitrate, sample_rate: r.sampleRate, bit_depth: r.bitDepth, is_lossless: r.isLossless === 1, is_hi_res: r.isHiRes === 1, musicbrainz_id: r.musicbrainzId, added_at: r.addedAt, created_at: r.createdAt, updated_at: r.updatedAt }
  }

  private mapDrizzleToTrackList(rows: any[]): MusicTrack[] {
    return rows.map(r => this.mapDrizzleToTrack(r))
  }

  private mapDrizzleToArtists(rows: any[]): MusicArtist[] {
    return rows.map(r => ({ ...r, source_id: r.sourceId, source_type: r.sourceType, library_id: r.libraryId, provider_id: r.providerId, sort_name: r.sortName, musicbrainz_id: r.musicbrainzId, thumb_url: r.thumbUrl, art_url: r.artUrl, user_fixed_match: r.userFixedMatch === 1, album_count: r.albumCount, track_count: r.trackCount, created_at: r.createdAt, updated_at: r.updatedAt }))
  }

  private mapDrizzleToAlbums(rows: any[]): MusicAlbum[] {
    return rows.map(r => ({ ...r, source_id: r.sourceId, source_type: r.sourceType, library_id: r.libraryId, provider_id: r.providerId, artist_id: r.artistId, artist_name: r.artistName, sort_title: r.sortTitle, musicbrainz_id: r.musicbrainzId, musicbrainz_release_group_id: r.musicbrainzReleaseGroupId, album_type: r.albumType, track_count: r.trackCount, total_duration: r.totalDuration, total_size: r.totalSize, best_audio_codec: r.bestAudioCodec, best_audio_bitrate: r.bestAudioBitrate, best_sample_rate: r.bestSampleRate, best_bit_depth: r.bestBitDepth, avg_audio_bitrate: r.avgAudioBitrate, thumb_url: r.thumbUrl, art_url: r.artUrl, user_fixed_match: r.userFixedMatch === 1, release_date: r.releaseDate, added_at: r.addedAt, created_at: r.createdAt, updated_at: r.updatedAt }))
  }

  private mapDrizzleToQualityScore(r: any): MusicQualityScore {
    return { id: r.id, album_id: r.albumId, quality_tier: r.qualityTier, tier_quality: r.tierQuality, tier_score: r.tierScore, codec_score: r.codecScore, bitrate_score: r.bitrateScore, efficiency_score: r.efficiencyScore, storage_debt_bytes: r.storageDebtBytes, needs_upgrade: r.needsUpgrade === 1, issues: r.issues, created_at: r.createdAt, updated_at: r.updatedAt }
  }

  private mapDrizzleToArtistCompleteness(r: any): ArtistCompleteness {
    return { artist_name: r.artistName, musicbrainz_id: r.musicbrainzId || undefined, library_id: r.libraryId, total_albums: r.totalAlbums, owned_albums: r.ownedAlbums, total_singles: r.totalSingles, owned_singles: r.ownedSingles, total_eps: r.totalEps, owned_eps: r.ownedEps, missing_albums: r.missingAlbums, missing_singles: r.missingSingles, missing_eps: r.missingEps, completeness_percentage: r.completenessPercentage, efficiency_score: r.efficiencyScore, storage_debt_bytes: r.storageDebtBytes, total_size: r.totalSize, country: r.country || undefined, active_years: r.activeYears || undefined, artist_type: r.artistType || undefined, thumb_url: r.thumbUrl || undefined, last_sync_at: r.lastSyncAt || undefined, created_at: r.createdAt, updated_at: r.updatedAt }
  }

  private mapDrizzleToAlbumCompleteness(r: any): AlbumCompleteness {
    return { album_id: r.albumId, artist_name: r.artistName, album_title: r.albumTitle, musicbrainz_release_id: r.musicbrainzReleaseId || undefined, musicbrainz_release_group_id: r.musicbrainzReleaseGroupId || undefined, total_tracks: r.totalTracks, owned_tracks: r.ownedTracks, missing_tracks: r.missingTracks, completeness_percentage: r.completenessPercentage, efficiency_score: r.efficiencyScore, storage_debt_bytes: r.storageDebtBytes, total_size: r.totalSize, last_sync_at: r.lastSyncAt || undefined, created_at: r.createdAt, updated_at: r.updatedAt }
  }
}
