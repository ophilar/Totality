import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * Music IPC Handlers
 */

import { getDatabase } from '@main/database/BetterSQLiteService'
import { getMusicBrainzService } from '@main/services/MusicBrainzService'
import { getSourceManager } from '@main/services/SourceManager'
import { createProgressUpdater } from '@main/ipc/utils/progressUpdater'
import { createValidatedIpcHandler, createIpcHandler, createValidatedIpcHandlerWithEvent, createIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import {
  PositiveIntSchema,
  NonEmptyStringSchema,
  SourceIdSchema,
  LibraryIdSchema,
  MusicFiltersSchema,
} from '@main/validation/schemas'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'
import { getWindowFromEvent } from '@main/ipc/utils/safeSend'

import { registerListHandlers } from '@main/ipc/utils/genericHandlers'
import { MusicAlbum, MusicTrack } from '@main/types/database'

import { getStatsCacheService } from '@main/services/StatsCacheService'

export function registerMusicHandlers(): void {
  const db = getDatabase()
  const manager = getSourceManager()

  // Register generic list/count handlers
  registerListHandlers('music:artists', (f) => db.music.getArtists(f), (f) => db.music.countMusicArtists(f), MusicFiltersSchema, {
    listAlias: 'music:getArtists',
    countAlias: 'music:countArtists'
  })
  registerListHandlers('music:albums', (f) => db.music.getAlbums(f), (f) => db.music.countMusicAlbums(f), MusicFiltersSchema, {
    listAlias: 'music:getAlbums',
    countAlias: 'music:countAlbums'
  })
  registerListHandlers('music:tracks', (f) => db.music.getTracks(f), (f) => db.music.countMusicTracks(f), MusicFiltersSchema, {
    listAlias: 'music:getTracks',
    countAlias: 'music:countTracks'
  })

  // ============================================================================
  // MUSIC LIBRARY SCANNING
  // ============================================================================

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.MUSIC.SCAN_LIBRARY, z.tuple([SourceIdSchema, LibraryIdSchema]), async (event, sourceId, libraryId) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:scanProgress', 'music')
    try {
      const res = await manager.scanLibrary(sourceId, libraryId, (p) => onProgress(p, { sourceId, libraryId }))
      getStatsCacheService().invalidate()
      return res
    } finally { flush() }
  })

  createIpcHandlerWithEvent('music:scanAll', async (event: any) => {
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:scanProgress', 'music')
    try {
      const results = await manager.scanAllSources((sId, sName, p) => onProgress(p, { sourceId: sId, sourceName: sName }))
      getStatsCacheService().invalidate()
      return Array.from(results.entries()).map(([key, value]) => ({ key, ...value }))
    } finally { flush() }
  })

  // ============================================================================
  // MUSIC METADATA & UTILS
  // ============================================================================

  createValidatedIpcHandler('music:getArtist', PositiveIntSchema, async (id) => {
    return await db.music.getArtist(id)
  })

  createValidatedIpcHandler('music:getAlbum', PositiveIntSchema, async (id) => {
    return await db.music.getAlbum(id)
  })

  createValidatedIpcHandler('music:getTrack', PositiveIntSchema, async (id) => {
    return await db.music.getTrack(id)
  })

  createValidatedIpcHandler('music:getAlbumTracks', PositiveIntSchema, async (albumId) => {
    return await db.music.getTracks({ albumId, limit: 1000 })
  })

  createValidatedIpcHandler('music:getArtistAlbums', PositiveIntSchema, async (artistId) => {
    return await db.music.getAlbums({ artistId, limit: 1000 })
  })

  createValidatedIpcHandler('music:searchArtists', NonEmptyStringSchema, async (query) => {
    return await db.music.searchArtists(query)
  })

  createValidatedIpcHandler('music:searchAlbums', NonEmptyStringSchema, async (query) => {
    return await db.music.searchAlbums(query)
  })

  createValidatedIpcHandler('music:searchTracks', NonEmptyStringSchema, async (query) => {
    return await db.music.searchTracks(query)
  })

  createIpcHandler('music:getGenres', async () => {
    return await db.music.getGenres()
  })

  createIpcHandler('music:getStats', async (sourceId?: string) => {
    return await db.stats.getMusicStats(sourceId)
  })

  createIpcHandler('music:getAlbumsNeedingUpgrade', async (limit?: number, sourceId?: string) => {
    return await db.music.getAlbumsNeedingUpgrade(limit, sourceId)
  })

  createIpcHandler(IPC_CHANNELS.MUSIC.GET_ALL_ARTIST_COMPLETENESS, async (sourceId?: string) => {
    const epsVal = await db.config.getSetting('completeness_include_eps')
    const singlesVal = await db.config.getSetting('completeness_include_singles')
    const epsEnabled = epsVal !== 'false'
    const singlesEnabled = singlesVal !== 'false'
    const cacheKey = `${sourceId || 'all'}-${epsEnabled}-${singlesEnabled}`
    return await getStatsCacheService().getMusicCompleteness(cacheKey, () =>
      db.music.getAllArtistCompleteness(sourceId, epsEnabled, singlesEnabled)
    )
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.GET_ALBUM_COMPLETENESS, PositiveIntSchema, async (albumId) => {
    return await db.music.getAlbumCompleteness(albumId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.ANALYZE_ARTIST, PositiveIntSchema, async (artistId) => {
    // Analysis is now handled by completeness background jobs, but we trigger a refresh
    return await db.music.getArtistCompleteness(artistId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.ANALYZE_ALBUM, PositiveIntSchema, async (albumId) => {
    return await db.music.getAlbumCompleteness(albumId)
  })

  // ============================================================================
  // MUSICBRAINZ & SYNC
  // ============================================================================

  createValidatedIpcHandler('music:searchMusicBrainz', z.tuple([z.string(), z.enum(['artist', 'release', 'recording', 'release-group'])]), async (query, type) => {
    const mb = getMusicBrainzService()
    if (type === 'artist') return await mb.searchArtist(query)
    if (type === 'release') {
       const parts = query.split(' - ')
       const artist = parts[0] || query
       const album = parts[1] || query
       return await mb.searchRelease(artist, album)
    }
    return []
  })

  createValidatedIpcHandler('music:getMusicBrainzArtist', z.string(), async (mbid) => {
    return await getMusicBrainzService().getArtistDetails(mbid)
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.SEARCH_MB_ARTIST, z.string(), async (name) => {
    return await getMusicBrainzService().searchArtist(name)
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.SEARCH_MB_RELEASE, z.tuple([z.string(), z.string()]), async (artistName, albumTitle) => {
    return await getMusicBrainzService().searchRelease(artistName, albumTitle)
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.GET_ARTIST_COMPLETENESS, z.string(), async (artistName) => {
    return await db.music.getArtistCompleteness(artistName)
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.ANALYZE_ARTIST_COMPLETENESS, PositiveIntSchema, async (artistId) => {
    const artist = await db.music.getArtist(artistId)
    if (!artist) throw new Error(`Artist with ID ${artistId} not found`)
    const albums = await db.music.getAlbums({ artistId, limit: 1000 })
    const ownedTitles = albums.map((a: MusicAlbum) => a.title)
    const ownedMbIds = albums.map((a: MusicAlbum) => a.musicbrainz_id).filter((id: string | undefined): id is string => !!id)
    const completeness = await getMusicBrainzService().analyzeArtistCompleteness(
      artist.name,
      artist.musicbrainz_id || undefined,
      ownedTitles,
      ownedMbIds
    )
    await db.music.upsertArtistCompleteness(completeness)
    getStatsCacheService().invalidate()
    return completeness
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.ANALYZE_ALBUM_TRACK_COMPLETENESS, PositiveIntSchema, async (albumId) => {
    const album = await db.music.getAlbum(albumId)
    if (!album) throw new Error(`Album with ID ${albumId} not found`)
    const tracks = await db.music.getTracks({ albumId, limit: 1000 })
    const ownedTrackTitles = tracks.map((t: MusicTrack) => t.title)
    const completeness = await getMusicBrainzService().analyzeAlbumTrackCompleteness(
      albumId,
      album.artist_name,
      album.title,
      album.musicbrainz_release_group_id || album.musicbrainz_id || undefined,
      ownedTrackTitles
    )
    if (completeness) {
      await db.music.upsertAlbumCompleteness(completeness)
    }
    getStatsCacheService().invalidate()
    return completeness
  })

  createValidatedIpcHandler(IPC_CHANNELS.MUSIC.FIX_ARTIST_MATCH, z.tuple([PositiveIntSchema, NonEmptyStringSchema]), async (artistId, musicbrainzId) => {
    await db.music.fixArtistMatch(artistId, musicbrainzId)
    getStatsCacheService().invalidate()
    return { success: true }
  })

  createValidatedIpcHandler('music:fixAlbumMatch', z.tuple([PositiveIntSchema, NonEmptyStringSchema]), async (albumId, musicbrainzReleaseGroupId) => {
    await db.music.fixAlbumMatch(albumId, musicbrainzReleaseGroupId)
    getStatsCacheService().invalidate()
    return { success: true }
  })

  getLoggingService().info('[music]', 'Music IPC handlers registered')
}
