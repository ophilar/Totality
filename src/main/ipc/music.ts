import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * Music IPC Handlers
 *
 * Handles IPC communication for music library operations.
 */

import { ipcMain } from 'electron'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { getMusicBrainzService } from '@main/services/MusicBrainzService'
import { getSourceManager } from '@main/services/SourceManager'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { LocalFolderProvider } from '@main/providers/local/LocalFolderProvider'
import { JellyfinEmbyBase } from '@main/providers/jellyfin-emby/JellyfinEmbyBase'
import { KodiProvider } from '@main/providers/kodi/KodiProvider'
import { KodiLocalProvider } from '@main/providers/kodi/KodiLocalProvider'
import { MusicFilters, MusicTrack, ProviderType } from '@main/types/database'
import { safeSend, getWindowFromEvent } from '@main/ipc/utils/safeSend'
import { createProgressUpdater } from '@main/ipc/utils/progressUpdater'
import { validateInput, PositiveIntSchema, NonEmptyStringSchema, OptionalSourceIdSchema, SourceIdSchema, LibraryIdSchema, MusicFiltersSchema } from '@main/validation/schemas'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'

import { registerListHandlers } from '@main/ipc/utils/genericHandlers'

export function registerMusicHandlers(): void {
  const db = getDatabase()

  // Register generic list/count handlers
  registerListHandlers('music:artists', (f) => db.music.getArtists(f), (f) => db.music.countMusicArtists(f), MusicFiltersSchema, {
    listAlias: ['music:getArtists', 'music:artists:list'],
    countAlias: ['music:countArtists', 'music:artists:count']
  })
  registerListHandlers('music:albums', (f) => db.music.getAlbums(f), (f) => db.music.countMusicAlbums(f), MusicFiltersSchema, {
    listAlias: ['music:getAlbums', 'music:albums:list'],
    countAlias: ['music:countAlbums', 'music:albums:count']
  })
  registerListHandlers('music:tracks', (f) => db.music.getTracks(f), (f) => db.music.countMusicTracks(f), MusicFiltersSchema, {
    listAlias: ['music:getTracks', 'music:tracks:list'],
    countAlias: ['music:countTracks', 'music:tracks:count']
  })

  // ============================================================================
  // MUSIC LIBRARY SCANNING
  // ============================================================================

  /**
   * Scan a music library from a source
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.SCAN_LIBRARY, async (_event, sourceId: unknown, libraryId: unknown) => {
    const validSourceId = validateInput(SourceIdSchema, sourceId, 'music:scanLibrary')
    const validLibraryId = validateInput(LibraryIdSchema, libraryId, 'music:scanLibrary')
    getLoggingService().info('[music:scanLibrary]', `Starting scan for source=${validSourceId}, library=${validLibraryId}`)

    const manager = getSourceManager()
    const provider = manager.getProvider(validSourceId)

    getLoggingService().info('[music:scanLibrary]', `Provider found: ${provider ? provider.providerType : 'none'}`)

    if (!provider) {
      throw new Error(`Source not found: ${validSourceId}`)
    }

    const win = getWindowFromEvent(_event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:scanProgress', 'music')

    const progressCallback = (progress: { current: number; total: number; currentItem?: string; percentage?: number }) => {
      onProgress(progress, { sourceId: validSourceId, libraryId: validLibraryId })
    }

    try {
      let result

      // Get library info first (for timestamp recording)
      const libraries = await provider.getLibraries()
      const library = libraries.find(lib => lib.id === validLibraryId)

      if (provider.providerType === ProviderType.Plex) {
        // Plex provider
        const plexProvider = provider as PlexProvider
        getLoggingService().info('[music:scanLibrary]', `Plex provider - has selected server: ${plexProvider.hasSelectedServer()}`)

        if (!plexProvider.hasSelectedServer()) {
          throw new Error('Plex provider has no selected server. Please reconnect to your Plex server.')
        }

        result = await plexProvider.scanMusicLibrary(validLibraryId, progressCallback)
      } else if (provider.providerType === ProviderType.Local) {
        // Local folder provider
        const localProvider = provider as LocalFolderProvider
        getLoggingService().info('[music:scanLibrary]', `Local folder provider`)

        // Local folder uses scanLibrary which routes to scanMusicLibrary internally
        result = await localProvider.scanLibrary(validLibraryId, { onProgress: progressCallback })
      } else if (provider.providerType === ProviderType.Jellyfin || provider.providerType === ProviderType.Emby) {
        // Jellyfin/Emby provider
        const jellyfinProvider = provider as JellyfinEmbyBase
        getLoggingService().info('[music:scanLibrary]', `${provider.providerType} provider`)

        result = await jellyfinProvider.scanMusicLibrary(validLibraryId, progressCallback)
      } else if (provider.providerType === ProviderType.Kodi) {
        // Kodi JSON-RPC provider
        const kodiProvider = provider as KodiProvider
        getLoggingService().info('[music:scanLibrary]', `Kodi JSON-RPC provider`)

        result = await kodiProvider.scanMusicLibrary(progressCallback)
      } else if (provider.providerType === ProviderType.KodiLocal) {
        // Kodi-Local SQLite provider
        const kodiLocalProvider = provider as KodiLocalProvider
        getLoggingService().info('[music:scanLibrary]', `Kodi-Local provider`)

        result = await kodiLocalProvider.scanMusicLibrary(progressCallback)
      } else {
        throw new Error(`Music scanning is not supported for provider type: ${provider.providerType}`)
      }

      getLoggingService().info('[music:scanLibrary]', `Scan result:`, JSON.stringify(result, null, 2))

      // Analyze quality for all albums
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      const albums = await db.music.getMusicAlbums({ sourceId: validSourceId })
      getLoggingService().info('[music:scanLibrary]', `Found ${albums.length} albums in database for sourceId=${validSourceId}`)

      // Bolt ⚡ Optimization: Batch fetch all tracks to avoid N+1 queries.
      const albumIds = albums.map((a: { id?: number }) => a.id).filter((id: number | undefined): id is number => id != null)
      const tracksByAlbum = await db.music.getMusicTracksByAlbumIds(albumIds)

      db.startBatch()
      for (const album of albums) {
        const tracks = tracksByAlbum.get(album.id!) || []
        const qualityScore = analyzer.analyzeMusicAlbum(album, tracks)
        db.music.upsertQualityScore(qualityScore)
      }
      await db.endBatch()

      // Update library scan timestamp if successful
      if (result.success && library) {
        await db.sources.updateLibraryScanTime(
          validSourceId,
          validLibraryId,
          result.itemsScanned
        )
        getLoggingService().info('[music:scanLibrary]', `Updated scan timestamp for library ${library.name}`)
      }

      return result
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:scanLibrary] Error:', error)
      throw error
    } finally {
      flush()
    }
  })

  // ============================================================================
  // MUSIC DATA RETRIEVAL
  // ============================================================================

  // HANDLERS REPLACED BY registerListHandlers:
  // - music:getArtists -> music:artists:list
  // - music:countArtists -> music:artists:count
  // - music:getAlbums -> music:albums:list
  // - music:countAlbums -> music:albums:count
  // - music:getTracks -> music:tracks:list
  // - music:countTracks -> music:tracks:count

  /**
   * Get a music artist by ID
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ARTIST_BY_ID, async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'music:getArtistById')
      const db = getDatabase()
      return await db.music.getArtistById(validId)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getArtistById] Error:', error)
      throw error
    }
  })

  /**
   * Get a music album by ID
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ALBUM_BY_ID, async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'music:getAlbumById')
      const db = getDatabase()
      return await db.music.getAlbumById(validId)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getAlbumById] Error:', error)
      throw error
    }
  })

  /**
   * Get tracks for a specific album
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_TRACKS_BY_ALBUM, async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:getTracksByAlbum')
      const db = getDatabase()
      return await db.music.getTracks({ albumId: validAlbumId })
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getTracksByAlbum] Error:', error)
      throw error
    }
  })

  /**
   * Get music library statistics
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_STATS, async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:getStats') : undefined
      const db = getDatabase()
      return await db.music.getStats(validSourceId)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getStats] Error:', error)
      throw error
    }
  })

  // ============================================================================
  // QUALITY ANALYSIS
  // ============================================================================

  /**
   * Get quality score for an album
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ALBUM_QUALITY, async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:getAlbumQuality')
      const db = getDatabase()
      return await db.music.getQualityScore(validAlbumId)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getAlbumQuality] Error:', error)
      throw error
    }
  })

  /**
   * Get albums that need quality upgrades
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ALBUMS_NEEDING_UPGRADE, async (_event, limit?: unknown, sourceId?: unknown) => {
    try {
      const validLimit = limit !== undefined ? validateInput(z.number().int().positive().optional(), limit, 'music:getAlbumsNeedingUpgrade') : undefined
      const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:getAlbumsNeedingUpgrade') : undefined
      const db = getDatabase()
      return await db.music.getAlbumsNeedingUpgrade(validLimit, validSourceId)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getAlbumsNeedingUpgrade] Error:', error)
      throw error
    }
  })

  /**
   * Analyze quality for all albums
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.ANALYZE_ALL_QUALITY, async (event, sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:analyzeAllQuality') : undefined
    const db = getDatabase()
    const analyzer = getQualityAnalyzer()
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:qualityProgress', 'music')

    try {
      const filters: MusicFilters = validSourceId ? { sourceId: validSourceId } : {}
      const albums = await db.music.getMusicAlbums(filters)

      // Bolt ⚡ Optimization: Batch fetch all tracks to avoid N+1 queries.
      const albumIds = albums.map((a: { id?: number }) => a.id).filter((id: number | undefined): id is number => id != null)
      const tracksByAlbum = await db.music.getMusicTracksByAlbumIds(albumIds)

      let processed = 0

      db.startBatch()
      for (const album of albums) {
        const tracks = tracksByAlbum.get(album.id!) || []
        const qualityScore = analyzer.analyzeMusicAlbum(album, tracks)
        db.music.upsertQualityScore(qualityScore)

        processed++
        onProgress({
          current: processed,
          total: albums.length,
          currentItem: `${album.artist_name} - ${album.title}`,
          percentage: (processed / albums.length) * 100,
        })
      }
      await db.endBatch()

      return { success: true, analyzed: albums.length }
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:analyzeAllQuality] Error:', error)
      throw error
    } finally {
      flush()
    }
  })

  // ============================================================================
  // UNIFIED MUSICBRAINZ COMPLETENESS ANALYSIS
  // ============================================================================

  /**
   * Analyze completeness for all artists AND all albums in one pass
   * Uses the public MusicBrainz API
   * For local sources (kodi-local, local), also fetches artwork from Cover Art Archive
   *
   * @param sourceId Optional source ID to scope analysis
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.ANALYZE_ALL, async (event, sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:analyzeAll') : undefined
    const mbService = getMusicBrainzService()
    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'music:analysisProgress', 'music')

    try {
      const result = await mbService.analyzeAllMusic((progress) => {
        onProgress(progress)
      }, validSourceId)

      return { success: true, ...result }
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:analyzeAll] Error:', error)
      throw error
    } finally {
      flush()
    }
  })

  /**
   * Cancel the current music analysis
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.CANCEL_ANALYSIS, async () => {
    try {
      const mbService = getMusicBrainzService()
      mbService.cancel()
      return { success: true }
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:cancelAnalysis] Error:', error)
      throw error
    }
  })

  /**
   * Search for an artist in MusicBrainz
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.SEARCH_MB_ARTIST, async (_event, name: unknown) => {
    try {
      const validName = validateInput(NonEmptyStringSchema, name, 'music:searchMusicBrainzArtist')
      const mbService = getMusicBrainzService()
      return await mbService.searchArtist(validName)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:searchMusicBrainzArtist] Error:', error)
      throw error
    }
  })

  /**
   * Analyze completeness for a specific artist
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.ANALYZE_ARTIST_COMPLETENESS, async (_event, artistId: unknown) => {
    try {
      const validArtistId = validateInput(PositiveIntSchema, artistId, 'music:analyzeArtistCompleteness')
      const db = getDatabase()
      const mbService = getMusicBrainzService()

      const artist = await db.music.getArtistById(validArtistId)
      if (!artist) {
        throw new Error(`Artist not found: ${validArtistId}`)
      }

      // Get albums by artist_id AND by artist_name to catch all albums
      const albumsById = await db.music.getAlbums({ artistId: validArtistId })
      const albumsByName = await db.music.getAlbumsByArtistName(artist.name)

      // Combine and deduplicate by album id
      const albumMap = new Map<number, typeof albumsById[0]>()
      for (const album of [...albumsById, ...albumsByName]) {
        if (album.id !== undefined) {
          albumMap.set(album.id, album)
        }
      }
      const albums = Array.from(albumMap.values())

      const ownedTitles = albums.map(a => a.title)
      const ownedMbIds = albums.filter(a => a.musicbrainz_id).map(a => a.musicbrainz_id!)

      const completeness = await mbService.analyzeArtistCompleteness(
        artist.name,
        artist.musicbrainz_id,
        ownedTitles,
        ownedMbIds
      )

      await db.music.upsertArtistCompleteness(completeness)

      // Also analyze track completeness for all owned albums
      getLoggingService().info('[music:analyzeArtistCompleteness]', `Analyzing track completeness for ${albums.length} albums...`)
      for (const album of albums) {
        if (!album.id) continue
        try {
          const tracks = await db.music.getTracks({ albumId: album.id }) as MusicTrack[]
          const trackTitles = tracks.map((t: MusicTrack) => t.title)

          const albumCompleteness = await mbService.analyzeAlbumTrackCompleteness(
            album.id,
            album.artist_name,
            album.title,
            album.musicbrainz_id,
            trackTitles
          )

          if (albumCompleteness) {
            await db.music.upsertAlbumCompleteness(albumCompleteness)
            getLoggingService().info('[music:analyzeArtistCompleteness]', `${album.title}: ${albumCompleteness.owned_tracks}/${albumCompleteness.total_tracks} tracks`)
          }
        } catch (albumError) {
          getLoggingService().warn('[music:analyzeArtistCompleteness]', `Failed to analyze album "${album.title}":`, albumError)
        }
      }

      return completeness
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:analyzeArtistCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get artist completeness data
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ARTIST_COMPLETENESS, async (_event, artistName: unknown) => {
    try {
      const validArtistName = validateInput(NonEmptyStringSchema, artistName, 'music:getArtistCompleteness')
      const db = getDatabase()
      return await db.music.getArtistCompleteness(validArtistName)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getArtistCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get all artist completeness data
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ALL_ARTIST_COMPLETENESS, async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'music:getAllArtistCompleteness') : undefined
      const db = getDatabase()
      return await db.music.getAllArtistCompleteness(validSourceId)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getAllArtistCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Analyze track completeness for a single album
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.ANALYZE_ALBUM_TRACK_COMPLETENESS, async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:analyzeAlbumTrackCompleteness')
      const db = getDatabase()
      const mbService = getMusicBrainzService()

      const album = await db.music.getAlbumById(validAlbumId)
      if (!album) {
        throw new Error(`Album not found: ${validAlbumId}`)
      }

      getLoggingService().info('[music:analyzeAlbumTrackCompleteness]', `Analyzing: ${album.artist_name} - ${album.title} (id=${validAlbumId}, mbid=${album.musicbrainz_id || 'none'})`)

      const tracks = await db.music.getTracks({ albumId: validAlbumId }) as MusicTrack[]
      const ownedTrackTitles = tracks.map((t: MusicTrack) => t.title)
      getLoggingService().info('[music:analyzeAlbumTrackCompleteness]', `Owned tracks: ${ownedTrackTitles.length}`)

      const completeness = await mbService.analyzeAlbumTrackCompleteness(
        album.id!,
        album.artist_name,
        album.title,
        album.musicbrainz_id,
        ownedTrackTitles
      )

      if (completeness) {
        getLoggingService().info('[music:analyzeAlbumTrackCompleteness]', `Found completeness: ${completeness.owned_tracks}/${completeness.total_tracks} tracks, missing: ${completeness.total_tracks - completeness.owned_tracks}`)
        await db.music.upsertAlbumCompleteness(completeness)
      } else {
        getLoggingService().info('[music:analyzeAlbumTrackCompleteness]', `No completeness data found (album not in MusicBrainz?)`)
      }

      return completeness
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:analyzeAlbumTrackCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get album completeness data
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ALBUM_COMPLETENESS, async (_event, albumId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:getAlbumCompleteness')
      const db = getDatabase()
      return await db.music.getAlbumCompleteness(validAlbumId)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getAlbumCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get all album completeness data
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_ALL_ALBUM_COMPLETENESS, async () => {
    try {
      const db = getDatabase()
      return await db.music.getAllAlbumCompleteness()
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getAllAlbumCompleteness] Error:', error)
      throw error
    }
  })

  /**
   * Get incomplete albums (albums with missing tracks)
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.GET_INCOMPLETE_ALBUMS, async () => {
    try {
      const db = getDatabase()
      return await db.music.getIncompleteAlbums()
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:getIncompleteAlbums] Error:', error)
      throw error
    }
  })

  // ============================================================================
  // CANCELLATION
  // ============================================================================

  /**
   * Cancel music library scan
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.CANCEL_SCAN, async (_event, sourceId: unknown) => {
    try {
      const validSourceId = validateInput(SourceIdSchema, sourceId, 'music:cancelScan')
      const manager = getSourceManager()
      const provider = manager.getProvider(validSourceId)

      if (!provider) {
        throw new Error(`Source not found: ${validSourceId}`)
      }

      // Call cancelMusicScan on the appropriate provider
      if (provider.providerType === ProviderType.Plex) {
        const plexProvider = provider as PlexProvider
        plexProvider.cancelMusicScan()
      } else if (provider.providerType === ProviderType.Jellyfin || provider.providerType === ProviderType.Emby) {
        const jellyfinProvider = provider as JellyfinEmbyBase
        jellyfinProvider.cancelMusicScan()
      } else if (provider.providerType === ProviderType.Kodi) {
        const kodiProvider = provider as KodiProvider
        kodiProvider.cancelMusicScan()
      } else if (provider.providerType === ProviderType.KodiLocal) {
        const kodiLocalProvider = provider as KodiLocalProvider
        kodiLocalProvider.cancelScan()
      } else {
        throw new Error(`Music scan cancellation is not supported for provider type: ${provider.providerType}`)
      }

      return { success: true }
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:cancelScan] Error:', error)
      throw error
    }
  })

  // ============================================================================
  // MATCH FIXING - Fix incorrect MusicBrainz matches for artists/albums
  // ============================================================================

  /**
   * Fix the MusicBrainz match for an artist
   * Updates the artist's musicbrainz_id and re-runs completeness analysis
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.FIX_ARTIST_MATCH, async (event, artistId: unknown, musicbrainzId: unknown) => {
    try {
      const validArtistId = validateInput(PositiveIntSchema, artistId, 'music:fixArtistMatch')
      const validMusicbrainzId = validateInput(NonEmptyStringSchema, musicbrainzId, 'music:fixArtistMatch')
      const db = getDatabase()
      const mbService = getMusicBrainzService()
      const win = getWindowFromEvent(event)

      // Get the artist
      const artist = await db.music.getArtistById(validArtistId)
      if (!artist) {
        throw new Error(`Artist not found: ${validArtistId}`)
      }

      // Update the artist with the new MusicBrainz ID
      await db.music.updateMusicArtistMbid(validArtistId, validMusicbrainzId)

      // Get albums for re-analysis
      const albumsById = await db.music.getAlbums({ artistId: validArtistId })
      const albumsByName = await db.music.getAlbumsByArtistName(artist.name)

      // Combine and deduplicate
      const albumMap = new Map<number, typeof albumsById[0]>()
      for (const album of [...albumsById, ...albumsByName]) {
        if (album.id !== undefined) {
          albumMap.set(album.id, album)
        }
      }
      const albums = Array.from(albumMap.values())

      const ownedTitles = albums.map(a => a.title)
      const ownedMbIds = albums.filter(a => a.musicbrainz_id).map(a => a.musicbrainz_id!)

      // Re-analyze with the new MusicBrainz ID
      const completeness = await mbService.analyzeArtistCompleteness(
        artist.name,
        validMusicbrainzId,
        ownedTitles,
        ownedMbIds
      )

      await db.music.upsertArtistCompleteness(completeness)

      // Send library update for live refresh
      safeSend(win, 'library:updated', { type: 'music' })

      return {
        success: true,
        completeness,
      }
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:fixArtistMatch] Error:', error)
      throw error
    }
  })

  /**
   * Search MusicBrainz for releases (albums) to fix a match
   */
  ipcMain.handle(IPC_CHANNELS.MUSIC.SEARCH_MB_RELEASE, async (_event, artistName: unknown, albumTitle: unknown) => {
    try {
      const validArtistName = validateInput(NonEmptyStringSchema, artistName, 'music:searchMusicBrainzRelease')
      const validAlbumTitle = validateInput(NonEmptyStringSchema, albumTitle, 'music:searchMusicBrainzRelease')
      const mbService = getMusicBrainzService()
      return await mbService.searchRelease(validArtistName, validAlbumTitle)
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:searchMusicBrainzRelease] Error:', error)
      throw error
    }
  })

  /**
   * Fix the MusicBrainz match for an album
   * Updates the album's musicbrainz_id and re-runs track completeness analysis
   */
  ipcMain.handle('music:fixAlbumMatch', async (event, albumId: unknown, musicbrainzReleaseGroupId: unknown) => {
    try {
      const validAlbumId = validateInput(PositiveIntSchema, albumId, 'music:fixAlbumMatch')
      const validMusicbrainzReleaseGroupId = validateInput(NonEmptyStringSchema, musicbrainzReleaseGroupId, 'music:fixAlbumMatch')
      const db = getDatabase()
      const mbService = getMusicBrainzService()
      const win = getWindowFromEvent(event)

      // Get the album
      const album = await db.music.getAlbumById(validAlbumId)
      if (!album) {
        throw new Error(`Album not found: ${validAlbumId}`)
      }

      // Update the album with the new MusicBrainz ID
      await db.music.updateMusicAlbumMbid(validAlbumId, validMusicbrainzReleaseGroupId)

      // Get tracks for re-analysis
      const tracks = (await db.music.getTracks({ albumId: validAlbumId })) as MusicTrack[]
      const ownedTrackTitles = tracks.map((t: MusicTrack) => t.title)

      // Re-analyze track completeness with the new MusicBrainz ID
      const completeness = await mbService.analyzeAlbumTrackCompleteness(
        validAlbumId,
        album.artist_name,
        album.title,
        validMusicbrainzReleaseGroupId,
        ownedTrackTitles
      )

      if (completeness) {
        await db.music.upsertAlbumCompleteness(completeness)
      }

      // Send library update for live refresh
      safeSend(win, 'library:updated', { type: 'music' })

      return {
        success: true,
        completeness,
      }
    } catch (error: unknown) {
      getLoggingService().error('[music]', '[music:fixAlbumMatch] Error:', error)
      throw error
    }
  })
}

