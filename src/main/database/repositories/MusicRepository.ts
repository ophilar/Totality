import { eq, and, or, like, desc, asc, sql, inArray, isNull, lt } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import type {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicQualityScore,
  ArtistCompleteness,
  AlbumCompleteness,
  MusicFilters,
  ProviderType,
  MusicQualityTier,
  AlbumType,
} from '@main/types/database'
import { BaseRepository } from '@main/database/repositories/BaseRepository'
import { PathUtils } from '@main/services/utils/PathUtils'

import { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { Client } from '@libsql/client'
import * as schema from '@main/database/drizzleSchema'

interface ArtistCompletenessRow {
  artistName: string
  musicbrainzId?: string | null
  libraryId: string
  totalAlbums: number
  ownedAlbums: number
  totalSingles: number
  ownedSingles: number
  totalEps: number
  ownedEps: number
  missingAlbums: string
  missingSingles: string
  missingEps: string
  completenessPercentage: number
  efficiencyScore?: number | null
  storageDebtBytes?: number | null
  totalSize?: number | null
  country?: string | null
  activeYears?: string | null
  artistType?: string | null
  thumbUrl?: string | null
  lastSyncAt?: string | null
  createdAt: string
  updatedAt: string
}

type MusicTrackRow = typeof schema.musicTracks.$inferSelect
type MusicArtistRow = typeof schema.musicArtists.$inferSelect
type MusicAlbumRow = typeof schema.musicAlbums.$inferSelect
type MusicQualityRow = typeof schema.musicQualityScores.$inferSelect
interface ArtistStatsRow {
  totalArtists: number
  completeArtists: number
  incompleteArtists: number
  totalMissingAlbums: number
  averageCompleteness: number
}

type NonNullRow<T extends object> = {
  [K in keyof T]: Exclude<T[K], null> | undefined
}

function withoutNulls<T extends object>(row: T): NonNullRow<T> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value === null ? undefined : value])
  ) as NonNullRow<T>
}

function requiredString(value: string | null | undefined, field: string): string {
  if (value === null || value === undefined) throw new Error(`Music row is missing ${field}`)
  return value
}
export class MusicRepository extends BaseRepository<typeof schema.musicTracks> {
  constructor(db: Client, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'music_tracks', drizzle, schema.musicTracks)
  }

  async getTrackByPath(filePath: string): Promise<MusicTrack | null> {
    const dbPath = PathUtils.toDatabasePath(filePath)
    const row = await this.drizzle
      .select()
      .from(schema.musicTracks)
      .where(eq(schema.musicTracks.filePath, dbPath))
      .get()
    return row ? this.mapDrizzleToTrack(row) : null
  }

  async getTracksByPaths(filePaths: string[]): Promise<MusicTrack[]> {
    if (!filePaths || filePaths.length === 0) return []
    const dbPaths = filePaths.map((fp) => PathUtils.toDatabasePath(fp))
    const result: MusicTrack[] = []
    const batchSize = 500

    for (let i = 0; i < dbPaths.length; i += batchSize) {
      const batch = dbPaths.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select()
        .from(schema.musicTracks)
        .where(inArray(schema.musicTracks.filePath, batch))
        .all()

      result.push(...rows.map((r) => this.mapDrizzleToTrack(r)))
    }

    return result
  }

  async getMusicTracksByAlbumIds(albumIds: number[]): Promise<Map<number, MusicTrack[]>> {
    const result = new Map<number, MusicTrack[]>()
    if (!albumIds || albumIds.length === 0) return result

    const batchSize = 500
    for (let i = 0; i < albumIds.length; i += batchSize) {
      const batch = albumIds.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select()
        .from(schema.musicTracks)
        .where(inArray(schema.musicTracks.albumId, batch))
        .orderBy(
          schema.musicTracks.albumId,
          asc(schema.musicTracks.discNumber),
          asc(schema.musicTracks.trackNumber)
        )
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
      {
        ...data,
        musicbrainzId: sql`COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id)`,
      }
    )
  }

  async upsertTracks(tracks: MusicTrack[]): Promise<number> {
    if (!tracks || tracks.length === 0) return 0
    const dataList = tracks.map((track) => ({
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
    }))

    const updateFields = {
      sourceId: sql`excluded.source_id`,
      sourceType: sql`excluded.source_type`,
      libraryId: sql`excluded.library_id`,
      providerId: sql`excluded.provider_id`,
      albumId: sql`excluded.album_id`,
      artistId: sql`excluded.artist_id`,
      albumName: sql`excluded.album_name`,
      artistName: sql`excluded.artist_name`,
      title: sql`excluded.title`,
      trackNumber: sql`excluded.track_number`,
      discNumber: sql`excluded.disc_number`,
      duration: sql`excluded.duration`,
      filePath: sql`excluded.file_path`,
      fileSize: sql`excluded.file_size`,
      container: sql`excluded.container`,
      fileMtime: sql`excluded.file_mtime`,
      audioCodec: sql`excluded.audio_codec`,
      audioBitrate: sql`excluded.audio_bitrate`,
      sampleRate: sql`excluded.sample_rate`,
      bitDepth: sql`excluded.bit_depth`,
      channels: sql`excluded.channels`,
      isLossless: sql`excluded.is_lossless`,
      isHiRes: sql`excluded.is_hi_res`,
      musicbrainzId: sql`COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id)`,
      genres: sql`excluded.genres`,
      mood: sql`excluded.mood`,
      addedAt: sql`excluded.added_at`,
    }

    return await this.bulkUpsertWithProviderId(
      schema.musicTracks,
      dataList,
      [schema.musicTracks.sourceId, schema.musicTracks.providerId],
      updateFields
    )
  }

  async bulkUpsertTracks(tracks: MusicTrack[]): Promise<number> {
    if (!tracks.length) return 0


    const trackDataList = tracks.map((track) => ({
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
      createdAt: sql`(datetime('now'))` as unknown as string,
      updatedAt: sql`(datetime('now'))` as unknown as string,
    }))

    const chunkSize = 200
    let insertedCount = 0

    for (let i = 0; i < trackDataList.length; i += chunkSize) {
      const batch = trackDataList.slice(i, i + chunkSize)
      await this.drizzle
        .insert(schema.musicTracks)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.musicTracks.sourceId, schema.musicTracks.providerId],
          set: {
            libraryId: sql`excluded.library_id`,
            albumId: sql`excluded.album_id`,
            artistId: sql`excluded.artist_id`,
            albumName: sql`excluded.album_name`,
            artistName: sql`excluded.artist_name`,
            title: sql`excluded.title`,
            trackNumber: sql`excluded.track_number`,
            discNumber: sql`excluded.disc_number`,
            duration: sql`excluded.duration`,
            filePath: sql`excluded.file_path`,
            fileSize: sql`excluded.file_size`,
            container: sql`excluded.container`,
            fileMtime: sql`excluded.file_mtime`,
            audioCodec: sql`excluded.audio_codec`,
            audioBitrate: sql`excluded.audio_bitrate`,
            sampleRate: sql`excluded.sample_rate`,
            bitDepth: sql`excluded.bit_depth`,
            channels: sql`excluded.channels`,
            isLossless: sql`excluded.is_lossless`,
            isHiRes: sql`excluded.is_hi_res`,
            genres: sql`excluded.genres`,
            mood: sql`excluded.mood`,
            addedAt: sql`excluded.added_at`,
            musicbrainzId: sql`COALESCE(excluded.musicbrainz_id, music_tracks.musicbrainz_id)`,
            updatedAt: sql`(datetime('now'))`,
          },
        })
      insertedCount += batch.length
    }

    return insertedCount
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
      year:
        album.year != null && !isNaN(album.year) && album.year >= 1800 && album.year <= 2100
          ? Math.floor(album.year)
          : null,
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

  async updateMusicAlbumArtwork(
    sourceIdOrAlbumId: string | number,
    providerIdOrThumbUrl?: string,
    artwork?: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    if (typeof sourceIdOrAlbumId === 'number') {
      const albumId = sourceIdOrAlbumId
      const thumbUrl = providerIdOrThumbUrl as string | undefined
      if (!thumbUrl) return
      await this.drizzle
        .update(schema.musicAlbums)
        .set({ thumbUrl, updatedAt: sql`(datetime('now'))` })
        .where(eq(schema.musicAlbums.id, albumId))
      return
    }

    const sourceId = sourceIdOrAlbumId
    const providerId = providerIdOrThumbUrl as string
    if (!artwork) return

    const data: { updatedAt: SQL; thumbUrl?: string; artUrl?: string } = {
      updatedAt: sql`(datetime('now'))`,
    }
    if (artwork.thumbUrl !== undefined) data.thumbUrl = artwork.thumbUrl
    if (artwork.artUrl !== undefined) data.artUrl = artwork.artUrl

    await this.drizzle
      .update(schema.musicAlbums)
      .set(data)
      .where(
        and(
          eq(schema.musicAlbums.sourceId, sourceId),
          eq(schema.musicAlbums.providerId, providerId)
        )
      )
  }

  async updateMusicArtistArtwork(
    sourceId: string,
    providerId: string,
    artwork: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    const data: { updatedAt: SQL; thumbUrl?: string; artUrl?: string } = {
      updatedAt: sql`(datetime('now'))`,
    }
    if (artwork.thumbUrl !== undefined) data.thumbUrl = artwork.thumbUrl
    if (artwork.artUrl !== undefined) data.artUrl = artwork.artUrl

    await this.drizzle
      .update(schema.musicArtists)
      .set(data)
      .where(
        and(
          eq(schema.musicArtists.sourceId, sourceId),
          eq(schema.musicArtists.providerId, providerId)
        )
      )
  }

  async getArtists(filters?: MusicFilters): Promise<MusicArtist[]> {
    const conditions = []
    if (filters?.sourceId) conditions.push(eq(schema.musicArtists.sourceId, filters.sourceId))
    if (filters?.libraryId) conditions.push(eq(schema.musicArtists.libraryId, filters.libraryId))
    if (filters?.searchQuery)
      conditions.push(like(schema.musicArtists.name, `%${filters.searchQuery}%`))
    if (filters?.alphabetFilter) {
      if (filters.alphabetFilter === '#') conditions.push(sql`name NOT GLOB '[A-Za-z]*'`)
      else conditions.push(eq(sql`UPPER(SUBSTR(name, 1, 1))`, filters.alphabetFilter.toUpperCase()))
    }
    if (filters?.mood) conditions.push(like(schema.musicArtists.mood, `%${filters.mood}%`))
    if (filters?.genre) conditions.push(like(schema.musicArtists.genres, `%${filters.genre}%`))

    const sortMap: Record<string, AnyColumn | SQL> = {
      name: schema.musicArtists.sortName,
      title: schema.musicArtists.sortName,
      added_at: schema.musicArtists.createdAt,
      album_count: schema.musicArtists.albumCount,
      track_count: schema.musicArtists.trackCount,
    }
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
    if (filters?.searchQuery)
      conditions.push(like(schema.musicArtists.name, `%${filters.searchQuery}%`))
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
    const row = await this.drizzle
      .select()
      .from(schema.musicArtists)
      .where(eq(schema.musicArtists.id, id))
      .get()
    return row ? this.mapDrizzleToArtists([row])[0] : null
  }

  async getMusicArtistByName(name: string, sourceId: string): Promise<MusicArtist | null> {
    const row = await this.drizzle
      .select()
      .from(schema.musicArtists)
      .where(and(eq(schema.musicArtists.name, name), eq(schema.musicArtists.sourceId, sourceId)))
      .get()
    return row ? this.mapDrizzleToArtists([row])[0] : null
  }

  private buildAlbumConditions(filters?: MusicFilters): SQL[] {
    const conditions: SQL[] = []
    if (!filters) return conditions

    if (filters.artistId && filters.artistName) {
      conditions.push(
        or(
          eq(schema.musicAlbums.artistId, filters.artistId),
          eq(schema.musicAlbums.artistName, filters.artistName)
        )!
      )
    } else if (filters.artistId) {
      conditions.push(eq(schema.musicAlbums.artistId, filters.artistId))
    } else if (filters.artistName) {
      conditions.push(eq(schema.musicAlbums.artistName, filters.artistName))
    }

    if (filters.sourceId) conditions.push(eq(schema.musicAlbums.sourceId, filters.sourceId))
    if (filters.libraryId) conditions.push(eq(schema.musicAlbums.libraryId, filters.libraryId))
    if (filters.searchQuery) {
      conditions.push(
        or(
          like(schema.musicAlbums.title, `%${filters.searchQuery}%`),
          like(schema.musicAlbums.artistName, `%${filters.searchQuery}%`)
        )!
      )
    }
    if (filters.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        conditions.push(sql`title NOT GLOB '[A-Za-z]*'`)
      } else {
        conditions.push(eq(sql`UPPER(SUBSTR(title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
      }
    }
    if (filters.excludeAlbumTypes?.length) {
      conditions.push(
        or(
          isNull(schema.musicAlbums.albumType),
          sql`${schema.musicAlbums.albumType} NOT IN (${sql.join(filters.excludeAlbumTypes, sql`,`)})`
        )!
      )
    }
    if (filters.mood) conditions.push(like(schema.musicAlbums.mood, `%${filters.mood}%`))
    if (filters.genre) conditions.push(like(schema.musicAlbums.genres, `%${filters.genre}%`))

    return conditions
  }

  async getAlbums(filters?: MusicFilters): Promise<MusicAlbum[]> {
    const conditions = this.buildAlbumConditions(filters)

    const sortMap: Record<string, AnyColumn | SQL> = {
      title: sql`COALESCE(${schema.musicAlbums.sortTitle}, ${schema.musicAlbums.title})`,
      artist: schema.musicAlbums.artistName,
      year: schema.musicAlbums.year,
      added_at: schema.musicAlbums.createdAt,
      size: schema.musicAlbums.totalSize,
      storage_debt: schema.musicAlbums.totalSize,
    }
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
    const conditions = this.buildAlbumConditions(filters)

    const query = this.drizzle.select({ count: sql<number>`count(*)` }).from(schema.musicAlbums)
    if (conditions.length > 0) query.where(and(...conditions))
    const res = await query.get()
    return res?.count || 0
  }

  async getAlbumById(id: number): Promise<MusicAlbum | null> {
    const row = await this.drizzle
      .select()
      .from(schema.musicAlbums)
      .where(eq(schema.musicAlbums.id, id))
      .get()
    return row ? this.mapDrizzleToAlbums([row])[0] : null
  }

  async getAlbumsByIds(ids: number[]): Promise<MusicAlbum[]> {
    if (ids.length === 0) return []
    const result: MusicAlbum[] = []
    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select()
        .from(schema.musicAlbums)
        .where(inArray(schema.musicAlbums.id, batch))
        .all()
      result.push(...this.mapDrizzleToAlbums(rows))
    }
    return result
  }

  async getAlbumByName(title: string, artistId: number): Promise<MusicAlbum | null> {
    const row = await this.drizzle
      .select()
      .from(schema.musicAlbums)
      .where(and(eq(schema.musicAlbums.title, title), eq(schema.musicAlbums.artistId, artistId)))
      .get()
    return row ? this.mapDrizzleToAlbums([row])[0] : null
  }

  async getAlbumsByArtistName(artistName: string, limit = 500): Promise<MusicAlbum[]> {
    const rows = await this.drizzle
      .select()
      .from(schema.musicAlbums)
      .where(eq(schema.musicAlbums.artistName, artistName))
      .limit(limit)
      .all()
    return this.mapDrizzleToAlbums(rows)
  }

  private buildTrackConditions(filters?: MusicFilters): SQL[] {
    const conditions: SQL[] = []
    if (!filters) return conditions

    if (filters.albumId) conditions.push(eq(schema.musicTracks.albumId, filters.albumId))
    if (filters.artistId && filters.artistName) {
      conditions.push(
        or(
          eq(schema.musicTracks.artistId, filters.artistId),
          eq(schema.musicTracks.artistName, filters.artistName)
        )!
      )
    } else if (filters.artistId) {
      conditions.push(eq(schema.musicTracks.artistId, filters.artistId))
    } else if (filters.artistName) {
      conditions.push(eq(schema.musicTracks.artistName, filters.artistName))
    }

    if (filters.sourceId) conditions.push(eq(schema.musicTracks.sourceId, filters.sourceId))
    if (filters.searchQuery) {
      conditions.push(
        or(
          like(schema.musicTracks.title, `%${filters.searchQuery}%`),
          like(schema.musicTracks.artistName, `%${filters.searchQuery}%`),
          like(schema.musicTracks.albumName, `%${filters.searchQuery}%`)
        )!
      )
    }
    if (filters.alphabetFilter) {
      if (filters.alphabetFilter === '#') {
        conditions.push(sql`title NOT GLOB '[A-Za-z]*'`)
      } else {
        conditions.push(eq(sql`UPPER(SUBSTR(title, 1, 1))`, filters.alphabetFilter.toUpperCase()))
      }
    }
    if (filters.mood) conditions.push(like(schema.musicTracks.mood, `%${filters.mood}%`))
    if (filters.genre) conditions.push(like(schema.musicTracks.genres, `%${filters.genre}%`))

    return conditions
  }

  async getTracks(filters?: MusicFilters): Promise<MusicTrack[]> {
    const conditions = this.buildTrackConditions(filters)

    const sortMap: Record<string, AnyColumn | SQL> = {
      title: schema.musicTracks.title,
      artist: schema.musicTracks.artistName,
      album: schema.musicTracks.albumName,
      codec: schema.musicTracks.audioCodec,
      duration: schema.musicTracks.duration,
      added_at: schema.musicTracks.createdAt,
    }
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
    const conditions = this.buildTrackConditions(filters)
    return await this.countInternal(conditions.length > 0 ? and(...conditions) : undefined)
  }

  async getTrackById(id: number): Promise<MusicTrack | null> {
    const row = await this.drizzle
      .select()
      .from(schema.musicTracks)
      .where(eq(schema.musicTracks.id, id))
      .get()
    return row ? this.mapDrizzleToTrack(row) : null
  }

  async deleteMusicTrack(id: number): Promise<void> {
    await this.drizzle.delete(schema.musicTracks).where(eq(schema.musicTracks.id, id))
  }

  async deleteMusicTracks(ids: number[]): Promise<void> {
    if (!ids || ids.length === 0) return
    const chunkSize = 500
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      await this.drizzle
        .delete(schema.musicTracks)
        .where(inArray(schema.musicTracks.id, chunk))
    }
  }

  async updateMusicArtistCounts(
    artistId: number,
    albumCount: number,
    trackCount: number
  ): Promise<void> {
    await this.drizzle
      .update(schema.musicArtists)
      .set({ albumCount, trackCount, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.musicArtists.id, artistId))
  }

  async updateMusicArtistCountsBatch(artistIds: number[]): Promise<void> {
    if (!artistIds || artistIds.length === 0) return
    const batchSize = 500
    for (let i = 0; i < artistIds.length; i += batchSize) {
      const batch = artistIds.slice(i, i + batchSize)
      await this.drizzle
        .update(schema.musicArtists)
        .set({
          albumCount: sql`(SELECT COUNT(*) FROM music_albums WHERE artist_id = music_artists.id)`,
          trackCount: sql`(SELECT COUNT(*) FROM music_tracks WHERE artist_id = music_artists.id)`,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(inArray(schema.musicArtists.id, batch))
    }
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
    await this.drizzle
      .update(schema.musicArtists)
      .set({ musicbrainzId, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.musicArtists.id, artistId))
  }

  async updateMusicAlbumMbid(albumId: number, musicbrainzId: string): Promise<void> {
    await this.drizzle
      .update(schema.musicAlbums)
      .set({ musicbrainzId, updatedAt: sql`(datetime('now'))` })
      .where(eq(schema.musicAlbums.id, albumId))
  }

  async fixArtistMatch(artistId: number, musicbrainzId: string): Promise<void> {
    await this.drizzle
      .update(schema.musicArtists)
      .set({
        musicbrainzId,
        userFixedMatch: 1,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(schema.musicArtists.id, artistId))
  }

  async fixAlbumMatch(albumId: number, musicbrainzReleaseGroupId: string): Promise<void> {
    await this.drizzle
      .update(schema.musicAlbums)
      .set({
        musicbrainzReleaseGroupId,
        userFixedMatch: 1,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(schema.musicAlbums.id, albumId))
  }

  async upsertMusicQualityScore(score: MusicQualityScore): Promise<void> {
    await this.upsertQualityScore(score)
  }

  async upsertQualityScore(score: MusicQualityScore): Promise<void> {
    await this.drizzle
      .insert(schema.musicQualityScores)
      .values({
        albumId: score.album_id,
        qualityTier: score.quality_tier || 'LOSSY_MID',
        tierQuality: score.tier_quality || 'MEDIUM',
        tierScore: score.tier_score,
        codecScore: score.codec_score,
        bitrateScore: score.bitrate_score,
        efficiencyScore: score.efficiency_score,
        storageDebtBytes: score.storage_debt_bytes,
        evidenceStatus: score.evidence_status,
        confidence: score.confidence,
        savingsBasis: score.savings_basis,
        needsUpgrade: score.needs_upgrade ? 1 : 0,
        issues: score.issues || '[]',
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`,
      })
      .onConflictDoUpdate({
        target: schema.musicQualityScores.albumId,
        set: {
          qualityTier: score.quality_tier,
          tierQuality: score.tier_quality,
          tierScore: score.tier_score,
          codecScore: score.codec_score,
          bitrateScore: score.bitrate_score,
          efficiencyScore: score.efficiency_score,
          storageDebtBytes: score.storage_debt_bytes,
          evidenceStatus: score.evidence_status,
          confidence: score.confidence,
          savingsBasis: score.savings_basis,
          needsUpgrade: score.needs_upgrade ? 1 : 0,
          issues: score.issues || '[]',
          updatedAt: sql`(datetime('now'))`,
        },
      })
  }

  async upsertQualityScores(scores: MusicQualityScore[]): Promise<void> {
    if (scores.length === 0) return

    const chunkSize = 500
    for (let i = 0; i < scores.length; i += chunkSize) {
      const chunk = scores.slice(i, i + chunkSize)

      const values = chunk.map(score => ({
        albumId: score.album_id,
        qualityTier: score.quality_tier || 'LOSSY_MID',
        tierQuality: score.tier_quality || 'MEDIUM',
        tierScore: score.tier_score,
        codecScore: score.codec_score,
        bitrateScore: score.bitrate_score,
        efficiencyScore: score.efficiency_score,
        storageDebtBytes: score.storage_debt_bytes,
        evidenceStatus: score.evidence_status,
        confidence: score.confidence,
        savingsBasis: score.savings_basis,
        needsUpgrade: score.needs_upgrade ? 1 : 0,
        issues: score.issues || '[]',
        createdAt: sql`(datetime('now'))`,
        updatedAt: sql`(datetime('now'))`,
      }))

      await this.drizzle
        .insert(schema.musicQualityScores)
        .values(values)
        .onConflictDoUpdate({
          target: schema.musicQualityScores.albumId,
          set: {
            qualityTier: sql`excluded.quality_tier`,
            tierQuality: sql`excluded.tier_quality`,
            tierScore: sql`excluded.tier_score`,
            codecScore: sql`excluded.codec_score`,
            bitrateScore: sql`excluded.bitrate_score`,
            efficiencyScore: sql`excluded.efficiency_score`,
            storageDebtBytes: sql`excluded.storage_debt_bytes`,
            evidenceStatus: sql`excluded.evidence_status`,
            confidence: sql`excluded.confidence`,
            savingsBasis: sql`excluded.savings_basis`,
            needsUpgrade: sql`excluded.needs_upgrade`,
            issues: sql`excluded.issues`,
            updatedAt: sql`(datetime('now'))`,
          },
        })
    }
  }

  async getQualityScore(albumId: number): Promise<MusicQualityScore | null> {
    const row = await this.drizzle
      .select()
      .from(schema.musicQualityScores)
      .where(eq(schema.musicQualityScores.albumId, albumId))
      .get()
    return row ? this.mapDrizzleToQualityScore(row) : null
  }

  async getQualityScoresByAlbumIds(albumIds: number[]): Promise<Map<number, MusicQualityScore>> {
    const result = new Map<number, MusicQualityScore>()
    if (albumIds.length === 0) return result
    const batchSize = 500
    for (let i = 0; i < albumIds.length; i += batchSize) {
      const batch = albumIds.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select()
        .from(schema.musicQualityScores)
        .where(inArray(schema.musicQualityScores.albumId, batch))
        .all()
      rows.forEach((r) => result.set(r.albumId, this.mapDrizzleToQualityScore(r)))
    }
    return result
  }

  async getAlbumsNeedingUpgrade(limit?: number, sourceId?: string): Promise<MusicAlbum[]> {
    const conditions = [eq(schema.musicQualityScores.needsUpgrade, 1)]
    if (sourceId) conditions.push(eq(schema.musicAlbums.sourceId, sourceId))

    const query = this.drizzle
      .select({ album: schema.musicAlbums })
      .from(schema.musicAlbums)
      .innerJoin(
        schema.musicQualityScores,
        eq(schema.musicAlbums.id, schema.musicQualityScores.albumId)
      )
      .where(and(...conditions))
      .orderBy(asc(schema.musicQualityScores.tierScore))

    if (limit) query.limit(limit)

    const rows = await query.all()
    return this.mapDrizzleToAlbums(rows.map((r) => r.album))
  }

  async upsertArtistCompleteness(data: ArtistCompleteness): Promise<void> {
    await this.drizzle
      .insert(schema.artistCompleteness)
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
        updatedAt: sql`(datetime('now'))`,
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
          updatedAt: sql`(datetime('now'))`,
        },
      })
  }

  async getArtistCompleteness(artistName: string): Promise<ArtistCompleteness | null> {
    const row = await this.drizzle
      .select()
      .from(schema.artistCompleteness)
      .where(eq(schema.artistCompleteness.artistName, artistName))
      .get()
    return row ? this.mapDrizzleToArtistCompleteness(row) : null
  }

  async getAllArtistCompleteness(
    sourceId?: string,
    epsEnabled = true,
    singlesEnabled = true
  ): Promise<{
    stats: {
      totalArtists: number
      analyzedArtists: number
      completeArtists: number
      incompleteArtists: number
      totalMissingAlbums: number
      averageCompleteness: number
    }
    artists: ArtistCompleteness[]
  }> {
    const epsWeight = epsEnabled ? 2 : 0
    const singlesWeight = singlesEnabled ? 1 : 0

    // Fetch individual artists with on-the-fly completeness calculations
    const artistsQuery = sql`
      SELECT 
        ac.id,
        ac.artist_name as artistName,
        ac.musicbrainz_id as musicbrainzId,
        ac.library_id as libraryId,
        ac.total_albums as totalAlbums,
        ac.owned_albums as ownedAlbums,
        ac.total_singles as totalSingles,
        ac.owned_singles as ownedSingles,
        ac.total_eps as totalEps,
        ac.owned_eps as ownedEps,
        ac.missing_albums as missingAlbums,
        ac.missing_singles as missingSingles,
        ac.missing_eps as missingEps,
        ac.country,
        ac.active_years as activeYears,
        ac.artist_type as artistType,
        ac.thumb_url as thumbUrl,
        ac.efficiency_score as efficiencyScore,
        ac.storage_debt_bytes as storageDebtBytes,
        ac.total_size as totalSize,
        ac.last_sync_at as lastSyncAt,
        ac.created_at as createdAt,
        ac.updated_at as updatedAt,
        CASE 
          WHEN (ac.total_albums * 3 + ${epsWeight} * ac.total_eps + ${singlesWeight} * ac.total_singles) > 0 
          THEN ROUND((CAST(ac.owned_albums * 3 + ${epsWeight} * ac.owned_eps + ${singlesWeight} * ac.owned_singles AS REAL) / (ac.total_albums * 3 + ${epsWeight} * ac.total_eps + ${singlesWeight} * ac.total_singles)) * 100)
          ELSE 100
        END AS completenessPercentage
      FROM artist_completeness ac
      ${sourceId ? sql`INNER JOIN music_artists ma ON ac.artist_name = ma.name WHERE ma.source_id = ${sourceId}` : sql``}
      ORDER BY ac.artist_name ASC
    `

    const artistRows = await this.drizzle.all<ArtistCompletenessRow>(artistsQuery)

    // Fetch aggregated summary stats directly from the database using SUM/COUNT
    const statsQuery = sql`
      SELECT
        COUNT(*) AS totalArtists,
        SUM(CASE WHEN pct >= 100 THEN 1 ELSE 0 END) AS completeArtists,
        SUM(CASE WHEN pct < 100 THEN 1 ELSE 0 END) AS incompleteArtists,
        SUM(missing_count) AS totalMissingAlbums,
        COALESCE(ROUND(AVG(pct)), 0) AS averageCompleteness
      FROM (
        SELECT
          CASE 
            WHEN (ac.total_albums * 3 + ${epsWeight} * ac.total_eps + ${singlesWeight} * ac.total_singles) > 0 
            THEN ROUND((CAST(ac.owned_albums * 3 + ${epsWeight} * ac.owned_eps + ${singlesWeight} * ac.owned_singles AS REAL) / (ac.total_albums * 3 + ${epsWeight} * ac.total_eps + ${singlesWeight} * ac.total_singles)) * 100)
            ELSE 100
          END AS pct,
          (
            (CASE WHEN ac.total_albums > ac.owned_albums THEN ac.total_albums - ac.owned_albums ELSE 0 END) +
            CASE WHEN ${epsEnabled} THEN (CASE WHEN ac.total_eps > ac.owned_eps THEN ac.total_eps - ac.owned_eps ELSE 0 END) ELSE 0 END +
            CASE WHEN ${singlesEnabled} THEN (CASE WHEN ac.total_singles > ac.owned_singles THEN ac.total_singles - ac.owned_singles ELSE 0 END) ELSE 0 END
          ) AS missing_count
        FROM artist_completeness ac
        ${sourceId ? sql`INNER JOIN music_artists ma ON ac.artist_name = ma.name WHERE ma.source_id = ${sourceId}` : sql``}
      )
    `

    const statsRow = (await this.drizzle.get<ArtistStatsRow>(statsQuery)) || {
      totalArtists: 0,
      completeArtists: 0,
      incompleteArtists: 0,
      totalMissingAlbums: 0,
      averageCompleteness: 0,
    }

    return {
      stats: {
        totalArtists: Number(statsRow.totalArtists || 0),
        analyzedArtists: Number(statsRow.totalArtists || 0),
        completeArtists: Number(statsRow.completeArtists || 0),
        incompleteArtists: Number(statsRow.incompleteArtists || 0),
        totalMissingAlbums: Number(statsRow.totalMissingAlbums || 0),
        averageCompleteness: Number(statsRow.averageCompleteness || 0),
      },
      artists: artistRows.map((r) => this.mapDrizzleToArtistCompleteness(r)),
    }
  }

  async upsertAlbumCompleteness(data: AlbumCompleteness): Promise<void> {
    await this.drizzle
      .insert(schema.albumCompleteness)
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
        updatedAt: sql`(datetime('now'))`,
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
          updatedAt: sql`(datetime('now'))`,
        },
      })
  }

  async getAlbumCompleteness(albumId: number): Promise<AlbumCompleteness | null> {
    const row = await this.drizzle
      .select()
      .from(schema.albumCompleteness)
      .where(eq(schema.albumCompleteness.albumId, albumId))
      .get()
    return row ? this.mapDrizzleToAlbumCompleteness(row) : null
  }

  async getAllAlbumCompleteness(): Promise<AlbumCompleteness[]> {
    const rows = await this.drizzle
      .select()
      .from(schema.albumCompleteness)
      .orderBy(asc(schema.albumCompleteness.artistName), asc(schema.albumCompleteness.albumTitle))
      .all()
    return rows.map((r) => this.mapDrizzleToAlbumCompleteness(r))
  }

  async getAlbumCompletenessByArtist(artistName: string): Promise<AlbumCompleteness[]> {
    const rows = await this.drizzle
      .select()
      .from(schema.albumCompleteness)
      .where(eq(schema.albumCompleteness.artistName, artistName))
      .all()
    return rows.map((r) => this.mapDrizzleToAlbumCompleteness(r))
  }

  async getIncompleteAlbums(): Promise<AlbumCompleteness[]> {
    const rows = await this.drizzle
      .select()
      .from(schema.albumCompleteness)
      .where(lt(schema.albumCompleteness.completenessPercentage, 100))
      .orderBy(asc(schema.albumCompleteness.completenessPercentage))
      .all()
    return rows.map((r) => this.mapDrizzleToAlbumCompleteness(r))
  }

  async getAlbumsByMusicbrainzIds(ids: string[]): Promise<Map<string, MusicAlbum>> {
    const result = new Map<string, MusicAlbum>()
    if (ids.length === 0) return result
    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select()
        .from(schema.musicAlbums)
        .where(inArray(schema.musicAlbums.musicbrainzId, batch))
        .all()
      rows.forEach((r) => {
        if (r.musicbrainzId) result.set(r.musicbrainzId, this.mapDrizzleToAlbums([r])[0])
      })
    }
    return result
  }

  async getTrackByMusicbrainzId(id: string): Promise<MusicTrack | null> {
    const row = await this.drizzle
      .select()
      .from(schema.musicTracks)
      .where(eq(schema.musicTracks.musicbrainzId, id))
      .limit(1)
      .get()
    return row ? this.mapDrizzleToTrack(row) : null
  }

  async getTracksByMusicbrainzIds(ids: string[]): Promise<Map<string, MusicTrack>> {
    const result = new Map<string, MusicTrack>()
    if (ids.length === 0) return result
    const batchSize = 500
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const rows = await this.drizzle
        .select()
        .from(schema.musicTracks)
        .where(inArray(schema.musicTracks.musicbrainzId, batch))
        .all()
      rows.forEach((r) => {
        if (r.musicbrainzId) result.set(r.musicbrainzId, this.mapDrizzleToTrack(r))
      })
    }
    return result
  }

  async deleteTrack(id: number): Promise<void> {
    await this.delete(id)
  }

  async removeStaleProviderTracks(
    sourceId: string,
    libraryId: string,
    validProviderIds: Set<string>
  ): Promise<number> {
    const where = and(
      eq(schema.musicTracks.sourceId, sourceId),
      eq(schema.musicTracks.libraryId, libraryId)
    )
    return await this.reconcileStaleItems(where!, schema.musicTracks.providerId, validProviderIds)
  }

  async removeStaleProviderAlbums(
    sourceId: string,
    libraryId: string,
    validProviderIds: Set<string>
  ): Promise<number> {
    const existing = await this.drizzle
      .select({ id: schema.musicAlbums.id, providerId: schema.musicAlbums.providerId })
      .from(schema.musicAlbums)
      .where(
        and(eq(schema.musicAlbums.sourceId, sourceId), eq(schema.musicAlbums.libraryId, libraryId))
      )

    const staleIds = existing.filter((t) => !validProviderIds.has(t.providerId)).map((t) => t.id)
    if (staleIds.length > 0) {
      const batchSize = 500
      for (let i = 0; i < staleIds.length; i += batchSize) {
        const batch = staleIds.slice(i, i + batchSize)
        const placeholders = batch.map(() => '?').join(',')
        await this.db.execute({
          sql: `DELETE FROM music_albums WHERE id IN (${placeholders})`,
          args: batch,
        })
      }
    }
    return staleIds.length
  }

  async removeStaleProviderArtists(
    sourceId: string,
    validProviderIds: Set<string>
  ): Promise<number> {
    const existing = await this.drizzle
      .select({ id: schema.musicArtists.id, providerId: schema.musicArtists.providerId })
      .from(schema.musicArtists)
      .where(eq(schema.musicArtists.sourceId, sourceId))

    const staleIds = existing.filter((t) => !validProviderIds.has(t.providerId)).map((t) => t.id)
    if (staleIds.length > 0) {
      const batchSize = 500
      for (let i = 0; i < staleIds.length; i += batchSize) {
        const batch = staleIds.slice(i, i + batchSize)
        const placeholders = batch.map(() => '?').join(',')
        await this.db.execute({
          sql: `DELETE FROM music_artists WHERE id IN (${placeholders})`,
          args: batch,
        })
      }
    }
    return staleIds.length
  }

  private mapDrizzleToTrack(r: MusicTrackRow): MusicTrack {
    return {
      ...withoutNulls(r),
      title: requiredString(r.title, 'title'),
      source_id: r.sourceId,
      source_type: r.sourceType as ProviderType,
      library_id: r.libraryId ?? undefined,
      provider_id: r.providerId,
      album_id: r.albumId ?? undefined,
      artist_id: r.artistId ?? undefined,
      album_name: r.albumName ?? undefined,
      artist_name: r.artistName ?? undefined,
      duration: r.duration ?? undefined,
      container: r.container ?? undefined,
      track_number: r.trackNumber ?? undefined,
      disc_number: r.discNumber ?? undefined,
      file_path: r.filePath ?? undefined,
      file_size: r.fileSize ?? undefined,
      file_mtime: r.fileMtime ?? undefined,
      audio_codec: r.audioCodec ?? undefined,
      audio_bitrate: r.audioBitrate ?? undefined,
      sample_rate: r.sampleRate ?? undefined,
      bit_depth: r.bitDepth ?? undefined,
      is_lossless: r.isLossless === 1,
      is_hi_res: r.isHiRes === 1,
      musicbrainz_id: r.musicbrainzId ?? undefined,
      added_at: r.addedAt ?? undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }
  }

  private mapDrizzleToTrackList(rows: MusicTrackRow[]): MusicTrack[] {
    return rows.map((r) => this.mapDrizzleToTrack(r))
  }

  private mapDrizzleToArtists(rows: MusicArtistRow[]): MusicArtist[] {
    return rows.map((r) => ({
      ...withoutNulls(r),
      name: requiredString(r.name, 'name'),
      source_id: r.sourceId,
      source_type: r.sourceType as ProviderType,
      library_id: r.libraryId ?? undefined,
      provider_id: r.providerId,
      sort_name: r.sortName ?? undefined,
      musicbrainz_id: r.musicbrainzId ?? undefined,
      thumb_url: r.thumbUrl ?? undefined,
      art_url: r.artUrl ?? undefined,
      genres: r.genres ?? undefined,
      mood: r.mood ?? undefined,
      country: r.country ?? undefined,
      user_fixed_match: r.userFixedMatch === 1,
      track_count: r.trackCount ?? undefined,
      album_count: r.albumCount ?? undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }))
  }

  private mapDrizzleToAlbums(rows: MusicAlbumRow[]): MusicAlbum[] {
    return rows.map((r) => ({
      ...withoutNulls(r),
      title: requiredString(r.title, 'title'),
      source_id: r.sourceId,
      source_type: r.sourceType as ProviderType,
      library_id: r.libraryId ?? undefined,
      provider_id: r.providerId,
      artist_id: r.artistId ?? undefined,
      artist_name: r.artistName ?? undefined,
      sort_title: r.sortTitle ?? undefined,
      musicbrainz_id: r.musicbrainzId ?? undefined,
      musicbrainz_release_group_id: r.musicbrainzReleaseGroupId ?? undefined,
      album_type: r.albumType as AlbumType | undefined,
      year:
        r.year != null && !isNaN(r.year) && r.year >= 1800 && r.year <= 2100
          ? Math.floor(r.year)
          : undefined,
      genres: r.genres ?? undefined,
      mood: r.mood ?? undefined,
      track_count: r.trackCount ?? undefined,
      total_duration: r.totalDuration ?? undefined,
      total_size: r.totalSize ?? undefined,
      best_audio_codec: r.bestAudioCodec ?? undefined,
      best_audio_bitrate: r.bestAudioBitrate ?? undefined,
      best_sample_rate: r.bestSampleRate ?? undefined,
      best_bit_depth: r.bestBitDepth ?? undefined,
      avg_audio_bitrate: r.avgAudioBitrate ?? undefined,
      thumb_url: r.thumbUrl ?? undefined,
      art_url: r.artUrl ?? undefined,
      user_fixed_match: r.userFixedMatch === 1,
      release_date: r.releaseDate ?? undefined,
      added_at: r.addedAt ?? undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }))
  }

  private mapDrizzleToQualityScore(r: MusicQualityRow): MusicQualityScore {
    return {
      id: r.id,
      album_id: r.albumId,
      quality_tier: r.qualityTier as MusicQualityTier,
      tier_quality: r.tierQuality as 'LOW' | 'MEDIUM' | 'HIGH',
      tier_score: r.tierScore,
      codec_score: r.codecScore,
      bitrate_score: r.bitrateScore,
      efficiency_score: r.efficiencyScore,
      storage_debt_bytes: r.storageDebtBytes,
      evidence_status: r.evidenceStatus as MusicQualityScore['evidence_status'],
      confidence: r.confidence as MusicQualityScore['confidence'],
      savings_basis: r.savingsBasis as MusicQualityScore['savings_basis'],
      needs_upgrade: r.needsUpgrade === 1,
      issues: r.issues,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }
  }

  private mapDrizzleToArtistCompleteness(r: ArtistCompletenessRow): ArtistCompleteness {
    return {
      artist_name: r.artistName,
      musicbrainz_id: r.musicbrainzId || undefined,
      library_id: r.libraryId,
      total_albums: r.totalAlbums,
      owned_albums: r.ownedAlbums,
      total_singles: r.totalSingles,
      owned_singles: r.ownedSingles,
      total_eps: r.totalEps,
      owned_eps: r.ownedEps,
      missing_albums: r.missingAlbums,
      missing_singles: r.missingSingles,
      missing_eps: r.missingEps,
      completeness_percentage: r.completenessPercentage,
      efficiency_score: r.efficiencyScore ?? undefined,
      storage_debt_bytes: r.storageDebtBytes ?? undefined,
      total_size: r.totalSize ?? undefined,
      country: r.country || undefined,
      active_years: r.activeYears || undefined,
      artist_type: r.artistType || undefined,
      thumb_url: r.thumbUrl || undefined,
      last_sync_at: r.lastSyncAt || undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }
  }

  private mapDrizzleToAlbumCompleteness(
    r: typeof schema.albumCompleteness.$inferSelect
  ): AlbumCompleteness {
    return {
      album_id: r.albumId,
      artist_name: r.artistName,
      album_title: r.albumTitle,
      musicbrainz_release_id: r.musicbrainzReleaseId || undefined,
      musicbrainz_release_group_id: r.musicbrainzReleaseGroupId || undefined,
      total_tracks: r.totalTracks,
      owned_tracks: r.ownedTracks,
      missing_tracks: r.missingTracks,
      completeness_percentage: r.completenessPercentage,
      efficiency_score: r.efficiencyScore ?? undefined,
      storage_debt_bytes: r.storageDebtBytes ?? undefined,
      total_size: r.totalSize ?? undefined,
      last_sync_at: r.lastSyncAt || undefined,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }
  }
}
