// @ts-nocheck
import { getErrorMessage } from '../../services/utils/errorUtils'
import { getLoggingService } from '../../services/LoggingService'
/**
 * KodiLocalProvider
 *
 * Detects local Kodi installation and provides access to its SQLite database.
 * Works without Kodi running by reading the database files directly.
 */

import * as fs from 'fs'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getMediaFileAnalyzer } from '../../services/MediaFileAnalyzer'
import {
  BaseMediaProvider,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  SourceConfig,
  ProviderType,
  AudioStreamInfo,
} from '../base/MediaProvider'
import { KodiMappingUtils } from './KodiMappingUtils'
import type { MediaItem, MediaItemVersion, AudioTrack } from '../../types/database'
import { extractVersionNames } from '../utils/VersionNaming'
import {
  QUERY_MOVIES_WITH_DETAILS,
  QUERY_EPISODES_WITH_DETAILS,
  QUERY_MOVIE_BY_ID,
  QUERY_EPISODE_BY_ID,
  QUERY_MOVIE_COUNT,
  QUERY_EPISODE_COUNT,
  QUERY_ALL_SETS,
  KodiMovieWithDetails,
  KodiEpisodeWithDetails,
  KodiSetWithDetails,
  KodiAudioStream,
} from './KodiDatabaseSchema'
import {
  QUERY_MUSIC_ARTISTS,
  QUERY_MUSIC_ALBUMS_BY_ARTIST,
  QUERY_MUSIC_SONGS_BY_ALBUM,
  QUERY_MUSIC_SONG_COUNT,
  KodiMusicArtistResult,
  KodiMusicAlbumResult,
  KodiMusicSongResult,
} from './KodiMusicDatabaseSchema'
import {
  calculateAlbumStats,
} from '../base/MusicScannerUtils'
import {
  normalizeAudioCodec,
  normalizeAudioChannels,
  hasObjectAudio,
} from '../../services/MediaNormalizer'
import {
  estimateAudioBitrate,
  calculateAudioBitrateFromFile,
} from '../utils/ProviderUtils'

// BetterSQLite3 types
import type { DatabaseSync } from 'node:sqlite'

export class KodiLocalProvider extends BaseMediaProvider {
  readonly providerType: ProviderType = 'kodi-local' as ProviderType

  private databasePath: string = ''
  private databaseVersion: number = 0
  private db: DatabaseSync | null = null

  // Music database support
  private musicDatabasePath: string = ''
  private musicDb: DatabaseSync | null = null
  private musicScanCancelled = false
  private scanCancelled = false

  // Concurrency guard for getLibraries (prevents race condition from parallel IPC calls)
  private getLibrariesPromise: Promise<MediaLibrary[]> | null = null

  // FFprobe file analysis settings
  private useFFprobeAnalysis: boolean = true
  private ffprobeAvailable: boolean | null = null

  constructor(config: SourceConfig) {
    super(config)

    // Load from connection config if provided
    if (config.connectionConfig) {
      this.databasePath = config.connectionConfig.databasePath || ''
      this.databaseVersion = config.connectionConfig.databaseVersion || 0
      this.musicDatabasePath = config.connectionConfig.musicDatabasePath || ''
    }
  }

  // ============================================================================
  // AUTHENTICATION & INITIALIZATION
  // ============================================================================

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      if (!credentials.databasePath) {
        return { success: false, error: 'Database path is required' }
      }

      // Verify path exists
      if (!fs.existsSync(credentials.databasePath)) {
        return { success: false, error: `Database file not found: ${credentials.databasePath}` }
      }

      this.databasePath = credentials.databasePath
      this.databaseVersion = credentials.databaseVersion || 0
      this.musicDatabasePath = credentials.musicDatabasePath || ''

      // Test connection (initializes SQLite)
      const testResult = await this.testConnection()

      if (testResult.success) {
        return {
          success: true,
          serverName: `Kodi (Local SQLite)`,
          serverVersion: `v${this.databaseVersion}`,
        }
      }

      return { success: false, error: testResult.error }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Initialization failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.databasePath && fs.existsSync(this.databasePath)
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      try {
        this.db.close()
      } catch (err) {
        getLoggingService().error('[KodiLocalProvider]', '[KodiLocalProvider] Error closing database:', err)
      }
      this.db = null
    }
    if (this.musicDb) {
      try {
        this.musicDb.close()
      } catch (err) {
        getLoggingService().error('[KodiLocalProvider]', '[KodiLocalProvider] Error closing music database:', err)
      }
      this.musicDb = null
    }
  }

  // ============================================================================
  // CONNECTION TESTING
  // ============================================================================

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.databasePath) {
      return { success: false, error: 'Database path not configured' }
    }

    if (!fs.existsSync(this.databasePath)) {
      return { success: false, error: 'Database file not found' }
    }

    try {
      const startTime = Date.now()

      // Dynamically import node:sqlite
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(this.databasePath, { readOnly: true })

      // Check if it's a valid Kodi database
      const count = db.prepare('SELECT COUNT(*) as count FROM movie').get() as { count: number }
      db.close()

      const latencyMs = Date.now() - startTime

      return {
        success: true,
        serverName: 'Local Kodi SQLite',
        serverVersion: `Movies: ${count.count}`,
        latencyMs,
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Invalid Kodi database: ${getErrorMessage(error)}`,
      }
    }
  }

  // ============================================================================
  // DATABASE HELPERS
  // ============================================================================

  private async getDb(): Promise<DatabaseSync> {
    if (this.db) return this.db

    if (!this.databasePath) {
      throw new Error('Database path not configured')
    }

    const { DatabaseSync } = await import('node:sqlite')
    this.db = new DatabaseSync(this.databasePath, { readOnly: true })
    return this.db
  }

  private async getMusicDb(): Promise<DatabaseSync | null> {
    if (this.musicDb) return this.musicDb

    if (!this.musicDatabasePath || !fs.existsSync(this.musicDatabasePath)) {
      return null
    }

    const { DatabaseSync } = await import('node:sqlite')
    this.musicDb = new DatabaseSync(this.musicDatabasePath, { readOnly: true })
    return this.musicDb
  }

  // ============================================================================
  // LIBRARY OPERATIONS
  // ============================================================================

  async getLibraries(): Promise<MediaLibrary[]> {
    if (this.getLibrariesPromise) return this.getLibrariesPromise

    this.getLibrariesPromise = (async () => {
      const libraries: MediaLibrary[] = []

      try {
        const db = await this.getDb()
        const movieCount = db.prepare(QUERY_MOVIE_COUNT).get() as { count: number }
        const episodeCount = db.prepare(QUERY_EPISODE_COUNT).get() as { count: number }

        if (movieCount.count > 0) {
          libraries.push({ id: 'movies', name: 'Movies', type: 'movie', itemCount: movieCount.count })
        }
        if (episodeCount.count > 0) {
          libraries.push({ id: 'tvshows', name: 'TV Shows', type: 'show', itemCount: episodeCount.count })
        }
      } catch (err) {
        getLoggingService().error('[KodiLocalProvider]', '[KodiLocalProvider] Error reading video libraries:', err)
      }

      try {
        const musicDb = await this.getMusicDb()
        if (musicDb) {
          const songCount = musicDb.prepare(QUERY_MUSIC_SONG_COUNT).get() as { count: number }
          if (songCount.count > 0) {
            libraries.push({ id: 'music', name: 'Music', type: 'music', itemCount: songCount.count })
          }
        }
      } catch (err) {
        getLoggingService().info('[KodiLocalProvider]', '[KodiLocalProvider] Music library not available:', getErrorMessage(err))
      }

      return libraries
    })()

    try {
      return await this.getLibrariesPromise
    } finally {
      this.getLibrariesPromise = null
    }
  }

  async getLibraryItems(libraryId: string): Promise<MediaMetadata[]> {
    if (libraryId === 'movies') {
      return this.getMovies()
    } else if (libraryId === 'tvshows') {
      return this.getEpisodes()
    }
    throw new Error(`Unknown library: ${libraryId}`)
  }

  private async getAudioStreamsByFileId(): Promise<Map<number, KodiAudioStream[]>> {
    const db = await this.getDb()
    const query = `
      SELECT idFile, strAudioCodec as codec, iAudioChannels as channels, strAudioLanguage as language
      FROM streamdetails WHERE iStreamType = 1
    `
    const streams = db.prepare(query).all() as KodiAudioStream[]
    const map = new Map<number, KodiAudioStream[]>()
    for (const s of streams) {
      if (!map.has(s.idFile)) map.set(s.idFile, [])
      map.get(s.idFile)!.push(s)
    }
    return map
  }

  private async getMovies(): Promise<MediaMetadata[]> {
    const db = await this.getDb()
    const movies = db.prepare(QUERY_MOVIES_WITH_DETAILS).all() as KodiMovieWithDetails[]
    const audioMap = await this.getAudioStreamsByFileId()

    return movies.map(m => this.convertMovieToMetadata(m, audioMap.get(m.idFile)))
  }

  private async getEpisodes(): Promise<MediaMetadata[]> {
    const db = await this.getDb()
    const episodes = db.prepare(QUERY_EPISODES_WITH_DETAILS).all() as KodiEpisodeWithDetails[]
    const audioMap = await this.getAudioStreamsByFileId()

    return episodes.map(e => this.convertEpisodeToMetadata(e, audioMap.get(e.idFile)))
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    const [type, id] = itemId.split('_')
    const db = await this.getDb()

    if (type === 'movie') {
      const movie = db.prepare(QUERY_MOVIE_BY_ID).get(id) as KodiMovieWithDetails
      const audio = db.prepare('SELECT * FROM streamdetails WHERE idFile = ? AND iStreamType = 1').all(movie.idFile) as any[]
      return this.convertMovieToMetadata(movie, audio)
    } else {
      const episode = db.prepare(QUERY_EPISODE_BY_ID).get(id) as KodiEpisodeWithDetails
      const audio = db.prepare('SELECT * FROM streamdetails WHERE idFile = ? AND iStreamType = 1').all(episode.idFile) as any[]
      return this.convertEpisodeToMetadata(episode, audio)
    }
  }

  // ============================================================================
  // SCANNING
  // ============================================================================

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress } = options || {}
    this.scanCancelled = false

    const startTime = Date.now()
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    try {
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()

      const scannedProviderIds = new Set<string>()
      let items: MediaMetadata[]

      if (libraryId === 'movies') items = await this.getMovies()
      else if (libraryId === 'tvshows') items = await this.getEpisodes()
      else throw new Error(`Unsupported library: ${libraryId}`)

      const totalItems = items.length
      getLoggingService().info('[KodiLocalProvider]', `Scanning ${totalItems} items...`)

      // Check FFprobe
      const fileAnalyzer = getMediaFileAnalyzer()
      if (this.ffprobeAvailable === null) {
        this.ffprobeAvailable = await fileAnalyzer.isAvailable()
      }

      db.startBatch()

      try {
        // Group movies
        const groups: MediaMetadata[][] = []
        if (libraryId === 'movies') {
          const groupMap = new Map<string, MediaMetadata[]>()
          for (const item of items) {
            const groupKey = item.tmdbId ? `tmdb:${item.tmdbId}`
              : item.imdbId ? `imdb:${item.imdbId}`
              : `title:${this.normalizeGroupTitle(item.title || '')}|${item.year || ''}`
            if (!groupMap.has(groupKey)) groupMap.set(groupKey, [])
            groupMap.get(groupKey)!.push(item)
          }
          groups.push(...groupMap.values())
        } else {
          for (const item of items) groups.push([item])
        }

        let itemIndex = 0
        for (const group of groups) {
          if (this.scanCancelled) break

          try {
            // Enhance with FFprobe if needed
            for (let i = 0; i < group.length; i++) {
              if (this.useFFprobeAnalysis && this.ffprobeAvailable && this.needsFFprobeEnhancement(group[i])) {
                group[i] = await this.enhanceWithFFprobe(group[i])
              }
            }

            const versions = group.map(m => this.convertMetadataToVersion(m))
            if (versions.length > 1) extractVersionNames(versions)

            const bestIdx = versions.reduce((bi, v, i) => this.calculateVersionScore(v) > this.calculateVersionScore(versions[bi]) ? i : bi, 0)
            const bestMetadata = group[bestIdx]

            const mediaItem = this.convertMetadataToMediaItem(bestMetadata)
            if (mediaItem) {
              mediaItem.source_id = this.sourceId
              mediaItem.source_type = 'kodi-local'
              mediaItem.library_id = libraryId
              mediaItem.version_count = versions.length
              mediaItem.plex_id = group[0].itemId

              const id = await db.upsertMediaItem(mediaItem)
              scannedProviderIds.add(mediaItem.plex_id)

              const scoredVersions = versions.map(v => {
                const vScore = analyzer.analyzeVersion(v as MediaItemVersion)
                return { ...v, media_item_id: id, ...vScore } as MediaItemVersion
              })
              db.syncMediaItemVersions(id, scoredVersions)

              mediaItem.id = id
              const qualityScore = await analyzer.analyzeMediaItem(mediaItem)
              await db.upsertQualityScore(qualityScore)

              result.itemsScanned++
            }
          } catch (error: unknown) {
            result.errors.push(`Error processing ${group[0]?.title}: ${getErrorMessage(error)}`)
          }

          for (const item of group) {
            itemIndex++
            if (onProgress) {
              onProgress({ current: itemIndex, total: totalItems, phase: 'processing', currentItem: item.title, percentage: (itemIndex / totalItems) * 100 })
            }
          }
        }
      } finally {
        await db.endBatch()
      }

      // Cleanup collections
      if (libraryId === 'movies' && !this.scanCancelled) {
        await this.syncCollections()
      }

      result.success = true
      result.durationMs = Date.now() - startTime
      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      return result
    }
  }

  // ============================================================================
  // COLLECTION SUPPORT
  // ============================================================================

  async getCollections(): Promise<KodiSetWithDetails[]> {
    const db = await this.getDb()
    return db.prepare(QUERY_ALL_SETS).all() as KodiSetWithDetails[]
  }

  async importCollections(onProgress?: (progress: { current: number; total: number; currentItem: string }) => void): Promise<ScanResult> {
    const startTime = Date.now()
    const result: ScanResult = { success: true, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    await this.syncCollections(onProgress)
    result.durationMs = Date.now() - startTime
    return result
  }

  private async syncCollections(onProgress?: (p: any) => void): Promise<void> {
    const db = getDatabase()
    const kodiDb = await this.getDb()

    try {
      const sets = kodiDb.prepare(QUERY_ALL_SETS).all() as KodiSetWithDetails[]

      for (let i = 0; i < sets.length; i++) {
        const collection = sets[i]
        if (onProgress) onProgress({ current: i + 1, total: sets.length, currentItem: collection.name })

        const movies = kodiDb.prepare(`
          SELECT m.idMovie, (SELECT value FROM uniqueid WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'tmdb' LIMIT 1) as tmdbId,
                 (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'poster' LIMIT 1) as posterUrl,
                 (SELECT url FROM art WHERE media_id = m.idMovie AND media_type = 'movie' AND type = 'fanart' LIMIT 1) as fanartUrl
          FROM movie m WHERE idSet = ?
        `).all(collection.idSet) as any[]

        const data = {
          source_id: this.sourceId,
          library_id: 'movies',
          tmdb_collection_id: String(collection.idSet),
          collection_name: collection.name,
          total_movies: collection.movieCount,
          owned_movies: movies.length,
          missing_movies: JSON.stringify([]),
          owned_movie_ids: JSON.stringify(movies.map(m => m.tmdbId).filter(Boolean)),
          completeness_percentage: (movies.length / Math.max(collection.movieCount, 1)) * 100,
          poster_url: KodiMappingUtils.convertImageUrl(collection.posterUrl) || KodiMappingUtils.convertImageUrl(movies[0]?.posterUrl),
          backdrop_url: KodiMappingUtils.convertImageUrl(collection.fanartUrl) || KodiMappingUtils.convertImageUrl(movies[0]?.fanartUrl),
        }

        const collectionId = await db.upsertMovieCollection(data)

        // Map movies to collection
        for (const movie of movies) {
          const internalMovie = db.getMediaItemByProviderId(String(movie.idMovie), this.sourceId)
          if (internalMovie?.id) {
            await db.addMediaItemToCollection(internalMovie.id, collectionId)
          }
        }
      }
    } catch (error) {
      getLoggingService().error('[KodiLocalProvider]', '[KodiLocalProvider] Collection sync failed:', error)
    }
  }

  // ============================================================================
  // CONVERSION HELPERS
  // ============================================================================

  private convertMovieToMetadata(movie: KodiMovieWithDetails, audioStreams?: KodiAudioStream[]): MediaMetadata {
    const metadata = KodiMappingUtils.mapMovieToMetadata(movie, this.sourceId)

    let durationSeconds = movie.videoDuration || 0
    if (!durationSeconds && movie.runtime && movie.runtime > 0) {
      durationSeconds = movie.runtime * 60
    }
    metadata.duration = durationSeconds > 0 ? durationSeconds * 1000 : undefined

    metadata.fileSize = this.getFileSize(metadata.filePath || '') || undefined
    const totalBitrate = this.calculateBitrate(metadata.fileSize || 0, durationSeconds)
    metadata.videoBitrate = totalBitrate > 0 ? Math.round(totalBitrate * 0.90) : 0

    const audioTracks = this.convertAudioStreams(audioStreams, movie.title || undefined, totalBitrate, metadata.videoBitrate)
    metadata.audioTracks = audioTracks.length > 0 ? audioTracks : undefined

    let bestAudio = audioTracks[0]
    for (const track of audioTracks) {
      if (track.hasObjectAudio) {
        if (!bestAudio?.hasObjectAudio || (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
          bestAudio = track
        }
      } else if (!bestAudio?.hasObjectAudio && (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
        bestAudio = track
      }
    }

    if (bestAudio) {
      metadata.audioCodec = bestAudio.codec || metadata.audioCodec
      metadata.audioChannels = bestAudio.channels || metadata.audioChannels
      metadata.audioBitrate = bestAudio.bitrate || undefined
      metadata.hasObjectAudio = bestAudio.hasObjectAudio
    }

    return metadata
  }

  private convertEpisodeToMetadata(episode: KodiEpisodeWithDetails, audioStreams?: KodiAudioStream[]): MediaMetadata {
    const metadata = KodiMappingUtils.mapEpisodeToMetadata(episode, this.sourceId)

    const durationSeconds = episode.videoDuration || 0
    metadata.duration = durationSeconds > 0 ? durationSeconds * 1000 : undefined

    metadata.fileSize = this.getFileSize(metadata.filePath || '') || undefined
    const totalBitrate = this.calculateBitrate(metadata.fileSize || 0, durationSeconds)
    metadata.videoBitrate = totalBitrate > 0 ? Math.round(totalBitrate * 0.90) : 0

    const audioTracks = this.convertAudioStreams(audioStreams, episode.title || undefined, totalBitrate, metadata.videoBitrate)
    metadata.audioTracks = audioTracks.length > 0 ? audioTracks : undefined

    let bestAudio = audioTracks[0]
    for (const track of audioTracks) {
      if (track.hasObjectAudio) {
        if (!bestAudio?.hasObjectAudio || (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
          bestAudio = track
        }
      } else if (!bestAudio?.hasObjectAudio && (track.bitrate || 0) > (bestAudio?.bitrate || 0)) {
        bestAudio = track
      }
    }

    if (bestAudio) {
      metadata.audioCodec = bestAudio.codec || metadata.audioCodec
      metadata.audioChannels = bestAudio.channels || metadata.audioChannels
      metadata.audioBitrate = bestAudio.bitrate || undefined
      metadata.hasObjectAudio = bestAudio.hasObjectAudio
    }

    return metadata
  }

  private convertAudioStreams(streams: KodiAudioStream[] | undefined, title: string | undefined, totalBitrate: number, videoBitrate: number): AudioStreamInfo[] {
    if (!streams || streams.length === 0) return []
    const numTracks = streams.length
    const calculatedAudioBitrate = totalBitrate > 0 ? calculateAudioBitrateFromFile(totalBitrate, videoBitrate, numTracks) : 0

    return streams.map((s, index) => {
      const hasObjAudio = hasObjectAudio(s.codec || null, null, title || null, null)
      let bitrate = calculatedAudioBitrate
      if (bitrate <= 0 || bitrate > 20000) bitrate = estimateAudioBitrate(s.codec || '', s.channels || 2)

      return {
        codec: normalizeAudioCodec(s.codec || null) || 'Unknown',
        channels: normalizeAudioChannels(s.channels || null, undefined) || 2,
        language: s.language || undefined,
        isDefault: index === 0,
        bitrate,
        hasObjectAudio: hasObjAudio,
      }
    })
  }

  private convertMetadataToMediaItem(metadata: MediaMetadata): MediaItem | null {
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks?.length) {
      metadata.audioTracks.forEach((t, i) => {
        audioTracks.push({ index: i, codec: t.codec || 'Unknown', channels: t.channels || 2, bitrate: t.bitrate || 0, language: t.language, hasObjectAudio: t.hasObjectAudio || false })
      })
    } else if (metadata.audioCodec) {
      audioTracks.push({ index: 0, codec: metadata.audioCodec, channels: metadata.audioChannels || 2, bitrate: metadata.audioBitrate || 0, hasObjectAudio: metadata.hasObjectAudio || false })
    }

    return {
      plex_id: metadata.itemId,
      title: metadata.title,
      year: metadata.year,
      type: metadata.type,
      series_title: metadata.seriesTitle,
      season_number: metadata.seasonNumber,
      episode_number: metadata.episodeNumber,
      file_path: metadata.filePath || '',
      file_size: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      resolution: metadata.resolution || 'SD',
      width: metadata.width || 0,
      height: metadata.height || 0,
      video_codec: metadata.videoCodec || '',
      video_bitrate: metadata.videoBitrate || 0,
      audio_codec: metadata.audioCodec || '',
      audio_channels: metadata.audioChannels || 2,
      audio_bitrate: metadata.audioBitrate || 0,
      has_object_audio: metadata.hasObjectAudio || false,
      hdr_format: metadata.hdrFormat || 'None',
      audio_tracks: JSON.stringify(audioTracks),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private convertMetadataToVersion(metadata: MediaMetadata): Omit<MediaItemVersion, 'id' | 'media_item_id'> {
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks?.length) {
      metadata.audioTracks.forEach((t, i) => {
        audioTracks.push({ index: i, codec: t.codec || 'Unknown', channels: t.channels || 2, bitrate: t.bitrate || 0, language: t.language, hasObjectAudio: t.hasObjectAudio || false })
      })
    } else if (metadata.audioCodec) {
      audioTracks.push({ index: 0, codec: metadata.audioCodec, channels: metadata.audioChannels || 2, bitrate: metadata.audioBitrate || 0, hasObjectAudio: metadata.hasObjectAudio || false })
    }

    const resolution = metadata.resolution || 'SD'
    const hdrFormat = metadata.hdrFormat || 'None'

    return {
      version_source: `kodi_local_${metadata.itemId}`,
      label: `${resolution}${hdrFormat !== 'None' ? ' ' + hdrFormat : ''}`,
      file_path: metadata.filePath || '',
      file_size: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      resolution,
      width: metadata.width || 0,
      height: metadata.height || 0,
      video_codec: metadata.videoCodec || '',
      video_bitrate: metadata.videoBitrate || 0,
      audio_codec: metadata.audioCodec || '',
      audio_channels: metadata.audioChannels || 2,
      audio_bitrate: metadata.audioBitrate || 0,
      has_object_audio: metadata.hasObjectAudio || false,
      hdr_format: hdrFormat === 'None' ? undefined : hdrFormat,
      audio_tracks: JSON.stringify(audioTracks),
    }
  }

  private getFileSize(filePath: string): number {
    try {
      if (fs.existsSync(filePath)) return fs.statSync(filePath).size
    } catch (error) { throw error }
    return 0
  }

  private calculateBitrate(fileSizeBytes: number, durationSeconds: number): number {
    if (!fileSizeBytes || !durationSeconds || durationSeconds <= 0) return 0
    return Math.round((fileSizeBytes * 8) / durationSeconds / 1000)
  }

  private needsFFprobeEnhancement(metadata: MediaMetadata): boolean {
    return !metadata.videoFrameRate || !metadata.colorBitDepth || !metadata.audioBitrate
  }

  private async enhanceWithFFprobe(metadata: MediaMetadata): Promise<MediaMetadata> {
    const fileAnalyzer = getMediaFileAnalyzer()
    const analysis = await fileAnalyzer.analyzeFile(metadata.filePath || '')
    if (analysis.success) return fileAnalyzer.enhanceMetadata(metadata, analysis)
    return metadata
  }

  // FFprobe Analysis Control
  setFFprobeAnalysis(enabled: boolean): void { this.useFFprobeAnalysis = enabled }
  isFFprobeAnalysisEnabled(): boolean { return this.useFFprobeAnalysis }
  async isFFprobeAvailable(): Promise<boolean> { return await getMediaFileAnalyzer().isAvailable() }
  async getFFprobeVersion(): Promise<string | null> { return await getMediaFileAnalyzer().getVersion() }

  // ============================================================================
  // MUSIC LIBRARY SUPPORT
  // ============================================================================

  async scanMusicLibrary(_onProgress?: (p: any) => void): Promise<ScanResult> {
    this.musicScanCancelled = false
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }

    try {
      const db = getDatabase()
      const musicDb = await this.getMusicDb()
      if (!musicDb) throw new Error('Music database not found')

      const artists = musicDb.prepare(QUERY_MUSIC_ARTISTS).all() as KodiMusicArtistResult[]
      for (const artist of artists) {
        if (this.musicScanCancelled) break
        const artistData = KodiMappingUtils.mapToMusicArtist(artist, this.sourceId, 'kodi-local')
        const artistId = await db.upsertMusicArtist(artistData)

        const albums = musicDb.prepare(QUERY_MUSIC_ALBUMS_BY_ARTIST).all(artist.idArtist) as KodiMusicAlbumResult[]
        for (const album of albums) {
          const albumData = KodiMappingUtils.mapToMusicAlbum(album, this.sourceId, 'kodi-local', artistId)
          const albumId = await db.upsertMusicAlbum(albumData)

          const songs = musicDb.prepare(QUERY_MUSIC_SONGS_BY_ALBUM).all(album.idAlbum) as KodiMusicSongResult[]
          const trackDataList = songs.map(s => KodiMappingUtils.mapToMusicTrack(s, this.sourceId, 'kodi-local', albumId, artistId))

          const stats = calculateAlbumStats(trackDataList)
          albumData.track_count = stats.trackCount
          albumData.total_duration = stats.totalDuration
          await db.upsertMusicAlbum(albumData)

          for (const track of trackDataList) {
            await db.upsertMusicTrack(track)
            result.itemsScanned++
          }
        }
      }

      result.success = true
      result.durationMs = Date.now() - startTime
      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      return result
    }
  }

  cancelScan(): void {
    this.scanCancelled = true
    this.musicScanCancelled = true
    getLoggingService().info('[KodiLocalProvider ${this.sourceId}]', `Scan cancellation requested`)
  }

  cancelMusicScan(): void {
    this.cancelScan()
  }

  isScanCancelled(): boolean {
    return this.scanCancelled
  }
}
