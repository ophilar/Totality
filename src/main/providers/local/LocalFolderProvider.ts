import { getErrorMessage } from '../../services/utils/errorUtils'

interface ProcessedItem {
  metadata: MediaMetadata
  parsed: ParsedMovieInfo | ParsedEpisodeInfo
  fileMtime: number
}

/**
 * LocalFolderProvider
 *
 * Implements the MediaProvider interface for scanning local folders.
 * Uses FFprobe for file analysis and TMDB for metadata.
 */

import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getMediaFileAnalyzer, type FileAnalysisResult } from '../../services/MediaFileAnalyzer'
import { getFileNameParser, ParsedMovieInfo, ParsedEpisodeInfo } from '../../services/FileNameParser'
import { getTMDBService } from '../../services/TMDBService'
import { getLoggingService } from '../../services/LoggingService'
import { getMusicBrainzService } from '../../services/MusicBrainzService'
import { normalizeAudioCodec } from '../../services/MediaNormalizer'
import {
  BaseMediaProvider,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  ProgressCallback,
  SourceConfig,
  ProviderType,
  AudioStreamInfo,
} from '../base/MediaProvider'
import type { MediaItem, MediaItemVersion, AudioTrack } from '../../types/database'
import { extractVersionNames } from '../utils/VersionNaming'

export interface LocalFolderConfig {
  folderPath: string
  mediaType: 'movies' | 'tvshows' | 'music' | 'mixed'
  name?: string
  // Custom library configurations from user selection
  customLibraries?: Array<{
    name: string
    path: string
    mediaType: 'movies' | 'tvshows' | 'music'
    enabled: boolean
  }>
}

// Minimum duration in seconds for movies (45 minutes)
const MIN_MOVIE_DURATION_SECONDS = 45 * 60

// Patterns to detect extras/featurettes in filenames
const EXTRAS_FILENAME_PATTERNS = [
  /\b(featurette|featurettes)\b/i,
  /\bbehind[.\-_ ]?the[.\-_ ]?scenes?\b/i,
  /\bdeleted[.\-_ ]?scenes?\b/i,
  /\bgag[.\-_ ]?reel\b/i,
  /\bbloopers?\b/i,
  /\binterview(s|ed)?\b/i,
  /\bmaking[.\-_ ]?of\b/i,
  /\bshort[.\-_ ]?film\b/i,
  /\b(trailer|teaser)\b/i,
  /\bpromo(s)?\b/i,
  /\bcommentary\b/i,
  /\bbonus[.\-_ ]?(content|feature)?\b/i,
  /\bextras?\b/i,
  /\bbts\b/i,
  /\bouttakes?\b/i,
  /\bscene[.\-_ ]?\d+\b/i,
  /\balternate[.\-_ ]?(opening|ending|cut|version|take|scene)?\b/i,
  /\bextended[.\-_ ]?(cut|scene|version)?\b/i,
  /[.\-_ ]scene$/i,
  /\b(opening|closing)[.\-_ ]?credits?\b/i,
]

function isExtrasContent(filename: string): boolean {
  const lowerFilename = filename.toLowerCase()
  if (lowerFilename.includes('sample')) return true
  for (const pattern of EXTRAS_FILENAME_PATTERNS) {
    if (pattern.test(lowerFilename)) return true
  }
  return false
}

export class LocalFolderProvider extends BaseMediaProvider {
  readonly providerType: ProviderType = 'local' as ProviderType

  private folderPath: string = ''
  private mediaType: 'movies' | 'tvshows' | 'music' | 'mixed' = 'mixed'
  private displayName: string = ''
  private customLibraries: LocalFolderConfig['customLibraries'] = undefined
  protected scanCancelled: boolean = false

  constructor(config: SourceConfig) {
    super(config)
    if (config.connectionConfig) {
      const connConfig = config.connectionConfig as LocalFolderConfig
      this.folderPath = connConfig.folderPath || ''
      this.mediaType = connConfig.mediaType || 'mixed'
      this.displayName = connConfig.name || path.basename(this.folderPath) || 'Local Folder'
      this.customLibraries = connConfig.customLibraries
    }
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      const config = credentials as LocalFolderConfig
      if (!config.folderPath) return { success: false, error: 'Folder path is required' }
      if (!fs.existsSync(config.folderPath)) return { success: false, error: `Folder not found: ${config.folderPath}` }
      const stats = fs.statSync(config.folderPath)
      if (!stats.isDirectory()) return { success: false, error: 'Path is not a directory' }

      this.folderPath = config.folderPath
      this.mediaType = config.mediaType || 'mixed'
      this.displayName = config.name || path.basename(this.folderPath)
      return { success: true, serverName: this.displayName }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) || 'Authentication failed' }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!this.folderPath && fs.existsSync(this.folderPath)
  }

  async disconnect(): Promise<void> {}

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.folderPath) return { success: false, error: 'Folder path not configured' }
    if (!fs.existsSync(this.folderPath)) return { success: false, error: 'Folder not found' }

    const startTime = Date.now()
    try {
      const parser = getFileNameParser()
      let mediaFileCount = 0
      let directoriesProcessed = 0

      const countFiles = async (dir: string, depth = 0): Promise<void> => {
        if (depth > 10) return
        const entries = await fsPromises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            await countFiles(path.join(dir, entry.name), depth + 1)
          } else if (parser.isMediaFile(entry.name)) {
            mediaFileCount++
          }
        }
        directoriesProcessed++
        if (directoriesProcessed % 50 === 0) await new Promise(resolve => setImmediate(resolve))
      }

      await countFiles(this.folderPath)
      return {
        success: true,
        serverName: `${this.displayName} (${mediaFileCount} media files)`,
        serverVersion: 'Local Folder',
        latencyMs: Date.now() - startTime,
      }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) || 'Connection test failed' }
    }
  }

  private static readonly MOVIE_FOLDER_NAMES = ['movies', 'films', 'movie', 'film']
  private static readonly TVSHOW_FOLDER_NAMES = ['tv shows', 'tv', 'shows', 'series', 'television', 'tvshows']
  private static readonly MUSIC_FOLDER_NAMES = ['music', 'audio', 'songs', 'albums', 'artists']

  async getLibraries(): Promise<MediaLibrary[]> {
    if (!this.folderPath || !fs.existsSync(this.folderPath)) return []
    const libraries: MediaLibrary[] = []

    if (this.customLibraries && this.customLibraries.length > 0) {
      for (const lib of this.customLibraries) {
        if (!lib.enabled) continue
        const libType: 'movie' | 'show' | 'music' = lib.mediaType === 'movies' ? 'movie' :
          lib.mediaType === 'tvshows' ? 'show' : 'music'
        libraries.push({ id: `${lib.mediaType}:${lib.name}`, name: lib.name, type: libType })
      }
      return libraries
    }

    if (this.mediaType === 'mixed') {
      try {
        const entries = await fsPromises.readdir(this.folderPath, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const folderNameLower = entry.name.toLowerCase()
          if (LocalFolderProvider.MOVIE_FOLDER_NAMES.includes(folderNameLower)) {
            libraries.push({ id: `movies:${entry.name}`, name: entry.name, type: 'movie' })
          } else if (LocalFolderProvider.TVSHOW_FOLDER_NAMES.includes(folderNameLower)) {
            libraries.push({ id: `tvshows:${entry.name}`, name: entry.name, type: 'show' })
          } else if (LocalFolderProvider.MUSIC_FOLDER_NAMES.includes(folderNameLower)) {
            libraries.push({ id: `music:${entry.name}`, name: entry.name, type: 'music' })
          }
        }
        if (libraries.length === 0) libraries.push({ id: 'movies', name: 'Movies', type: 'movie' })
      } catch (error) {
        libraries.push({ id: 'movies', name: 'Movies', type: 'movie' })
      }
      return libraries
    }

    if (this.mediaType === 'movies') libraries.push({ id: 'movies', name: 'Movies', type: 'movie' })
    if (this.mediaType === 'tvshows') libraries.push({ id: 'tvshows', name: 'TV Shows', type: 'show' })
    if (this.mediaType === 'music') libraries.push({ id: 'music', name: 'Music', type: 'music' })

    return libraries
  }

  async getLibraryItems(_libraryId: string): Promise<MediaMetadata[]> { return [] }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    const db = getDatabase()
    const items = db.media.getItems({ sourceId: this.sourceId }) as MediaItem[]
    const mediaItem = items.find((item: MediaItem) => item.plex_id === itemId)
    if (mediaItem) return this.convertMediaItemToMetadata(mediaItem)
    throw new Error(`Item not found: ${itemId}. Run a library scan first.`)
  }

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress, sinceTimestamp, forceFullScan, targetFiles } = options || {}
    if (targetFiles && targetFiles.length > 0) return this.scanTargetedFiles(libraryId, targetFiles, onProgress)

    const isIncremental = !!sinceTimestamp && !forceFullScan
    const [libraryType, subfolderName] = libraryId.includes(':') ? libraryId.split(':', 2) : [libraryId, null]

    let scanPath: string
    if (this.customLibraries && subfolderName) {
      const customLib = this.customLibraries.find(lib => lib.name === subfolderName)
      scanPath = customLib ? customLib.path : path.join(this.folderPath, subfolderName)
    } else if (subfolderName) {
      scanPath = path.join(this.folderPath, subfolderName)
    } else {
      scanPath = this.folderPath
    }

    if (libraryType === 'music') return this.scanMusicLibrary(onProgress, scanPath)

    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }

    if (!scanPath || !fs.existsSync(scanPath)) {
      result.errors.push('Folder not found or not configured')
      result.durationMs = Date.now() - startTime
      return result
    }

    try {
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      const fileAnalyzer = getMediaFileAnalyzer()
      const parser = getFileNameParser()
      const tmdb = getTMDBService()

      await analyzer.loadThresholdsFromDatabase()
      const ffprobeEnabled = db.config.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && await fileAnalyzer.isAvailable()
      const tmdbConfigured = await this.isTMDBConfigured()
      const ffprobeParallelEnabled = db.config.getSetting('ffprobe_parallel_enabled') !== 'false'
      const ffprobeBatchSize = parseInt(db.config.getSetting('ffprobe_batch_size') || '25', 10)

      const scannedFilePaths = new Set<string>()
      const scanType = libraryType === 'movies' ? 'movie' : 'episode'
      const movieTmdbCache = new Map<string, any>()
      const seriesTmdbCache = new Map<string, any>()

      onProgress?.({ current: 0, total: 100, phase: 'fetching', currentItem: 'Scanning folder structure...', percentage: 0 })
      const mediaFiles = await this.discoverMediaFiles(scanPath, scanType, onProgress, isIncremental ? sinceTimestamp : undefined)
      const totalFiles = mediaFiles.length

      if (totalFiles === 0) {
        result.success = true
        result.durationMs = Date.now() - startTime
        return result
      }

      // Phase 2: Process each file
      const processedItems: ProcessedItem[] = []
      const useParallelFFprobe = ffprobeAvailable && ffprobeParallelEnabled && ffprobeBatchSize > 1

      for (let batchStart = 0; batchStart < mediaFiles.length; batchStart += ffprobeBatchSize) {
        if (this.scanCancelled) break
        const batchEnd = Math.min(batchStart + ffprobeBatchSize, mediaFiles.length)
        const batchFiles = mediaFiles.slice(batchStart, batchEnd)

        const filesToProcess: Array<{ filePath: string; relativePath: string; fileMtime: number; parsed: ParsedMovieInfo | ParsedEpisodeInfo; metadata: MediaMetadata }> = []
        const filesToAnalyze: string[] = []

        for (let i = 0; i < batchFiles.length; i++) {
          const globalIndex = batchStart + i
          const { filePath, relativePath } = batchFiles[i]

          onProgress?.({ current: globalIndex + 1, total: totalFiles, phase: 'processing', currentItem: path.basename(filePath), percentage: ((globalIndex + 1) / totalFiles) * 100 })

          try {
            const stat = await fsPromises.stat(filePath)
            const fileMtime = stat.mtime.getTime()
            const existingItem = db.media.getItemByPath(filePath)

            if (existingItem?.file_mtime === fileMtime && !forceFullScan) {
              scannedFilePaths.add(filePath)
              result.itemsScanned++
              continue
            }

            const folderContext = path.dirname(relativePath)
            const parsed = parser.parse(path.basename(filePath), folderContext)
            if (!parsed || (scanType === 'movie' && parsed.type !== 'movie') || (scanType === 'episode' && parsed.type !== 'episode')) continue

            let metadata: MediaMetadata
            if (parsed.type === 'movie') {
              metadata = await this.createMovieMetadata(filePath, parsed as ParsedMovieInfo, tmdbConfigured, tmdb, movieTmdbCache)
            } else {
              metadata = await this.createEpisodeMetadata(filePath, parsed as ParsedEpisodeInfo, tmdbConfigured, tmdb, seriesTmdbCache)
            }

            filesToProcess.push({ filePath, relativePath, fileMtime, parsed: parsed as any, metadata })
            if (ffprobeAvailable) filesToAnalyze.push(filePath)
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`)
          }
        }

        let ffprobeResults = new Map<string, FileAnalysisResult>()
        if (filesToAnalyze.length > 0) {
          onProgress?.({ current: batchEnd, total: totalFiles, phase: 'analyzing', currentItem: `Analyzing ${filesToAnalyze.length} files...`, percentage: (batchEnd / totalFiles) * 100 })
          ffprobeResults = useParallelFFprobe
            ? await fileAnalyzer.analyzeFilesParallel(filesToAnalyze)
            : new Map(await Promise.all(filesToAnalyze.map(async fp => [fp, await fileAnalyzer.analyzeFile(fp)] as [string, FileAnalysisResult])))
        }

        for (const fileInfo of filesToProcess) {
          const { filePath, fileMtime, parsed } = fileInfo
          let { metadata } = fileInfo
          try {
            const analysis = ffprobeResults.get(filePath)
            if (analysis?.success) {
              metadata = fileAnalyzer.enhanceMetadata(metadata, analysis)
              if (scanType === 'movie' && analysis.duration && analysis.duration < MIN_MOVIE_DURATION_SECONDS) continue
            }
            processedItems.push({ metadata, parsed, fileMtime })
            scannedFilePaths.add(filePath)
          } catch (error: unknown) {
            result.errors.push(`Failed to analyze ${path.basename(filePath)}: ${getErrorMessage(error)}`)
          }
        }
      }

      const saveResult = await this.saveMediaItems(db, processedItems, libraryId, scanType, isIncremental)
      result.itemsScanned += saveResult.itemsScanned
      result.itemsAdded += saveResult.itemsAdded
      result.itemsUpdated += saveResult.itemsUpdated
      result.errors.push(...saveResult.errors)

      onProgress?.({ current: totalFiles, total: totalFiles, phase: 'saving', currentItem: 'Reconciling deletions...', percentage: 100 })
      const existingItems = db.media.getItems({ type: scanType, sourceId: this.sourceId, libraryId })
      for (const item of existingItems) {
        const stillExists = isIncremental ? (item.file_path && fs.existsSync(item.file_path)) : (item.file_path && scannedFilePaths.has(item.file_path))
        if (!stillExists && item.id) {
          await db.media.deleteItem(item.id)
          result.itemsRemoved++
        }
      }

      await db.sources.updateSourceScanTime(this.sourceId)
      result.success = true
      result.durationMs = Date.now() - startTime
      return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  private async scanTargetedFiles(libraryId: string, filePaths: string[], onProgress?: ProgressCallback): Promise<ScanResult> {
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    const [libraryType] = libraryId.includes(':') ? libraryId.split(':', 2) : [libraryId]
    if (libraryType === 'music') return this.scanTargetedMusicFiles(filePaths, onProgress)

    try {
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      const fileAnalyzer = getMediaFileAnalyzer()
      const parser = getFileNameParser()
      const tmdb = getTMDBService()

      await analyzer.loadThresholdsFromDatabase()
      const ffprobeEnabled = db.config.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && await fileAnalyzer.isAvailable()
      const tmdbConfigured = await this.isTMDBConfigured()
      const scanType = libraryType === 'movies' ? 'movie' : 'episode'
      const movieTmdbCache = new Map<string, any>()
      const seriesTmdbCache = new Map<string, any>()

      const validFiles = filePaths.filter(fp => fs.existsSync(fp) && parser.isVideoFile(path.basename(fp)))
      const deletedFiles = filePaths.filter(fp => !fs.existsSync(fp))

      for (const filePath of deletedFiles) {
        const existingItem = db.media.getItemByPath(filePath)
        if (existingItem?.id) {
          await db.media.deleteItem(existingItem.id)
          result.itemsRemoved++
        }
      }

      if (validFiles.length === 0 && deletedFiles.length === 0) {
        result.success = true; result.durationMs = Date.now() - startTime; return result
      }

      try {
        const processedItems: ProcessedItem[] = []
        for (let i = 0; i < validFiles.length; i++) {
          const filePath = validFiles[i]
          const relativePath = path.relative(this.folderPath, filePath)
          onProgress?.({ current: i + 1, total: validFiles.length, phase: 'processing', currentItem: path.basename(filePath), percentage: ((i + 1) / validFiles.length) * 100 })

          try {
            const stat = await fsPromises.stat(filePath)
            const fileMtime = stat.mtime.getTime()
            const folderContext = path.dirname(relativePath)
            const parsed = parser.parse(path.basename(filePath), folderContext)
            if (!parsed || (scanType === 'movie' && parsed.type !== 'movie') || (scanType === 'episode' && parsed.type !== 'episode')) continue

            let metadata: MediaMetadata
            if (parsed.type === 'movie') {
              metadata = await this.createMovieMetadata(filePath, parsed as ParsedMovieInfo, tmdbConfigured, tmdb, movieTmdbCache)
            } else {
              metadata = await this.createEpisodeMetadata(filePath, parsed as ParsedEpisodeInfo, tmdbConfigured, tmdb, seriesTmdbCache)
            }

            if (ffprobeAvailable) {
              const analysis = await fileAnalyzer.analyzeFile(filePath)
              if (analysis.success) {
                metadata = fileAnalyzer.enhanceMetadata(metadata, analysis)
                if (scanType === 'movie' && analysis.duration && analysis.duration < MIN_MOVIE_DURATION_SECONDS) continue
              }
            }
            processedItems.push({ metadata, parsed: parsed as any, fileMtime })
          } catch (error: unknown) {
            result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`)
          }
        }
        const saveResult = await this.saveMediaItems(db, processedItems, libraryId, scanType, true)
        result.itemsScanned += saveResult.itemsScanned
        result.itemsAdded += saveResult.itemsAdded
        result.itemsUpdated += saveResult.itemsUpdated
        result.errors.push(...saveResult.errors)
      } finally {
        // No endBatch needed as startBatch was removed
      }
      result.success = true; result.durationMs = Date.now() - startTime; return result
    } catch (error: unknown) {
      result.errors.push(getErrorMessage(error)); result.durationMs = Date.now() - startTime; return result
    }
  }

  private async scanTargetedMusicFiles(filePaths: string[], onProgress?: ProgressCallback): Promise<ScanResult> {
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    try {
      const db = getDatabase(); const fileAnalyzer = getMediaFileAnalyzer(); const parser = getFileNameParser()
      const ffprobeEnabled = db.config.getSetting('ffprobe_enabled') !== 'false'
      const ffprobeAvailable = ffprobeEnabled && await fileAnalyzer.isAvailable()
      const validFiles = filePaths.filter(fp => fs.existsSync(fp) && parser.isAudioFile(path.basename(fp)))
      const deletedFiles = filePaths.filter(fp => !fs.existsSync(fp))

      for (const filePath of deletedFiles) {
        const existingTrack = db.music.getTrackByPath(filePath)
        if (existingTrack?.id) { await db.music.deleteMusicTrack(existingTrack.id); result.itemsRemoved++ }
      }

      if (validFiles.length === 0 && deletedFiles.length === 0) { result.success = true; result.durationMs = Date.now() - startTime; return result }

      const artistMap = new Map<string, number>(); const albumMap = new Map<string, number>()
      try {
        for (let i = 0; i < validFiles.length; i++) {
          const filePath = validFiles[i]; const relativePath = path.relative(this.folderPath, filePath)
          onProgress?.({ current: i + 1, total: validFiles.length, phase: 'processing', currentItem: path.basename(filePath), percentage: ((i + 1) / validFiles.length) * 100 })
          try {
            const existingTrack = db.music.getTrackByPath(filePath); const isNew = !existingTrack
            const folderContext = path.dirname(relativePath)
            const parsed = parser.parseMusic(path.basename(filePath, path.extname(filePath)), folderContext)
            const artistName = parsed.artist || 'Unknown Artist'; const albumName = parsed.album || 'Unknown Album'; const trackTitle = parsed.title || path.basename(filePath, path.extname(filePath))
            const stats = await fsPromises.stat(filePath)

            let audioInfo: any = {}
            if (ffprobeAvailable) {
              const analysis = await fileAnalyzer.analyzeFile(filePath)
              if (analysis.success && analysis.audioTracks?.length > 0) {
                const primaryAudio = analysis.audioTracks[0]
                audioInfo = { codec: normalizeAudioCodec(primaryAudio.codec, primaryAudio.profile), bitrate: primaryAudio.bitrate, sampleRate: primaryAudio.sampleRate, bitDepth: primaryAudio.bitDepth, channels: primaryAudio.channels, duration: analysis.duration, isLossless: this.isLosslessCodec(primaryAudio.codec), hasEmbeddedArtwork: analysis.embeddedArtwork?.hasArtwork }
              }
            }

            let artistId = artistMap.get(artistName.toLowerCase())
            if (!artistId) {
              const existingArtist = db.music.getMusicArtistByName(artistName, this.sourceId)
              artistId = existingArtist?.id || await db.music.upsertArtist({ source_id: this.sourceId, source_type: 'local', library_id: 'music', provider_id: this.generateItemId(`artist_${artistName}`), name: artistName, sort_name: artistName, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              artistMap.set(artistName.toLowerCase(), artistId!)
            }

            const albumKey = `${artistName.toLowerCase()}|${albumName.toLowerCase()}`
            let albumId = albumMap.get(albumKey)
            if (!albumId) {
              const existingAlbum = db.music.getAlbumByName(albumName, artistId!)
              albumId = existingAlbum?.id || await db.music.upsertAlbum({ source_id: this.sourceId, source_type: 'local', library_id: 'music', provider_id: this.generateItemId(`album_${artistName}_${albumName}`), artist_id: artistId!, artist_name: artistName, title: albumName, sort_title: albumName, year: parsed.year, album_type: 'album', best_audio_codec: audioInfo.codec, best_audio_bitrate: audioInfo.bitrate, best_sample_rate: audioInfo.sampleRate, best_bit_depth: audioInfo.bitDepth, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              albumMap.set(albumKey, albumId!)
            }

            await db.music.upsertTrack({ source_id: this.sourceId, source_type: 'local', library_id: 'music', provider_id: this.generateItemId(filePath), album_id: albumId, artist_id: artistId, album_name: albumName, artist_name: artistName, title: trackTitle, track_number: parsed.trackNumber, disc_number: parsed.discNumber, duration: audioInfo.duration, file_path: filePath, file_size: stats.size, container: path.extname(filePath).slice(1).toLowerCase(), audio_codec: audioInfo.codec || 'Unknown', audio_bitrate: audioInfo.bitrate, sample_rate: audioInfo.sampleRate, bit_depth: audioInfo.bitDepth, channels: audioInfo.channels, is_lossless: audioInfo.isLossless, is_hi_res: this.isHiRes(audioInfo.sampleRate, audioInfo.bitDepth), created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            result.itemsScanned++; if (isNew) result.itemsAdded++; else result.itemsUpdated++
          } catch (error: unknown) { result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(error)}`) }
        }
      } finally {
        // No endBatch needed
      }

      for (const [, aId] of artistMap) {
        const albums = db.music.getMusicAlbums({ artistId: aId }); const tracks = db.music.getMusicTracks({ artistId: aId })
        await db.music.updateMusicArtistCounts(aId, albums.length, tracks.length)
      }
      result.success = true; result.durationMs = Date.now() - startTime; return result
    } catch (error: unknown) { result.errors.push(getErrorMessage(error)); result.durationMs = Date.now() - startTime; return result }
  }

  private async discoverMediaFiles(rootDir: string, _type: 'movie' | 'episode', _onProgress?: ProgressCallback, sinceTimestamp?: Date): Promise<Array<{ filePath: string; relativePath: string }>> {
    const parser = getFileNameParser(); const files: Array<{ filePath: string; relativePath: string }> = []
    let directoriesProcessed = 0; let skippedUnchanged = 0

    const scanDir = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 15) return
      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            const lowerName = entry.name.toLowerCase()
            if (['@eadir', '.ds_store', 'thumbs', 'metadata', 'extras', 'extra', 'featurettes', 'featurette', 'behind the scenes', 'deleted scenes', 'interviews', 'interview', 'scenes', 'shorts', 'short', 'trailers', 'trailer', 'other', 'bonus', 'bonuses', 'bonus features', 'special features', 'specials', 'samples', 'sample', 'subs', 'subtitles'].includes(lowerName)) continue
            await scanDir(fullPath, depth + 1)
          } else if (parser.isVideoFile(entry.name)) {
            if (isExtrasContent(entry.name)) continue
            if (sinceTimestamp) {
              try {
                const stat = await fsPromises.stat(fullPath)
                if (stat.mtime < sinceTimestamp) { skippedUnchanged++; continue }
              } catch (error) { throw error }
            }
            files.push({ filePath: fullPath, relativePath: path.relative(rootDir, fullPath) })
          }
        }
        directoriesProcessed++; if (directoriesProcessed % 50 === 0) await new Promise(resolve => setImmediate(resolve))
      } catch (error) { getLoggingService().warn('[LocalFolderProvider]', `Cannot access directory: ${path.basename(dir)}`) }
    }
    await scanDir(rootDir)
    if (sinceTimestamp && skippedUnchanged > 0) getLoggingService().info('[LocalFolderProvider ${this.sourceId}]', `Incremental scan: skipped ${skippedUnchanged} unchanged files`)
    return files
  }

  private async isTMDBConfigured(): Promise<boolean> {
    try {
      const db = getDatabase(); const apiKey = await db.config.getSetting('tmdb_api_key')
      return !!apiKey && apiKey.length > 0
    } catch (error) { throw error }
  }

  private async isMusicBrainzNameCorrectionEnabled(): Promise<boolean> {
    try {
      const db = getDatabase(); const setting = db.config.getSetting('musicbrainz_name_correction')
      return setting !== 'false'
    } catch (error) { throw error }
  }

  private async lookupCanonicalArtistName(artistName: string, cache: Map<string, string>): Promise<string> {
    const cached = cache.get(artistName.toLowerCase()); if (cached !== undefined) return cached
    try {
      const mb = getMusicBrainzService(); const results = await mb.searchArtist(artistName)
      if (results.length > 0) {
        const exactMatch = results.find(a => a.name.toLowerCase() === artistName.toLowerCase())
        if (exactMatch) { cache.set(artistName.toLowerCase(), exactMatch.name); return exactMatch.name }
        const normalizedInput = artistName.toLowerCase().replace(/[^a-z0-9]/g, ''), normalizedResult = results[0].name.toLowerCase().replace(/[^a-z0-9]/g, '')
        if (normalizedInput === normalizedResult) { cache.set(artistName.toLowerCase(), results[0].name); return results[0].name }
      }
      cache.set(artistName.toLowerCase(), artistName); return artistName
    } catch (error) { cache.set(artistName.toLowerCase(), artistName); return artistName }
  }

  private async createMovieMetadata(filePath: string, parsed: ParsedMovieInfo, fetchFromTMDB: boolean, tmdb: ReturnType<typeof getTMDBService>, movieTmdbCache?: Map<string, any>): Promise<MediaMetadata> {
    const stats = await fsPromises.stat(filePath)
    const metadata: MediaMetadata = { providerId: this.sourceId, providerType: this.providerType, itemId: this.generateItemId(filePath), title: parsed.title || path.basename(filePath), type: 'movie', year: parsed.year, filePath, fileSize: stats.size, resolution: parsed.resolution, videoCodec: parsed.codec }

    if (fetchFromTMDB && parsed.title) {
      try {
        const parser = getFileNameParser(); const normalizedTitle = parser.normalizeForSearch(parsed.title); const cacheKey = `${normalizedTitle.toLowerCase()}|${parsed.year || ''}`
        if (movieTmdbCache?.has(cacheKey)) {
          const cached = movieTmdbCache.get(cacheKey)
          if (cached) { metadata.tmdbId = cached.tmdbId; metadata.title = cached.title; metadata.year = cached.year; metadata.posterUrl = cached.posterPath ? `https://image.tmdb.org/t/p/w500${cached.posterPath}` : undefined; metadata.backdropUrl = cached.backdropPath ? `https://image.tmdb.org/t/p/w1280${cached.backdropPath}` : undefined }
          return metadata
        }
        const match = await tmdb.searchMovieWithFallbacks(parsed.title, normalizedTitle, parsed.year)
        if (match) { metadata.tmdbId = match.tmdbId; metadata.title = match.title; metadata.year = match.year; metadata.posterUrl = tmdb.buildImageUrl(match.posterPath || null); metadata.backdropUrl = tmdb.buildImageUrl(match.backdropPath || null); movieTmdbCache?.set(cacheKey, match) }
        else { movieTmdbCache?.set(cacheKey, null) }
      } catch (error) { getLoggingService().warn('[LocalFolderProvider]', `TMDB lookup failed for "${parsed.title}":`, error) }
    }
    return metadata
  }

  private async createEpisodeMetadata(filePath: string, parsed: ParsedEpisodeInfo, fetchFromTMDB: boolean, tmdb: ReturnType<typeof getTMDBService>, seriesTmdbCache?: Map<string, any>): Promise<MediaMetadata> {
    const stats = await fsPromises.stat(filePath)
    const metadata: MediaMetadata = { providerId: this.sourceId, providerType: this.providerType, itemId: this.generateItemId(filePath), title: parsed.episodeTitle || `Episode ${parsed.episodeNumber}`, type: 'episode', seriesTitle: parsed.seriesTitle || 'Unknown Series', seasonNumber: parsed.seasonNumber, episodeNumber: parsed.episodeNumber, year: parsed.year, filePath, fileSize: stats.size, resolution: parsed.resolution, videoCodec: parsed.codec }

    if (fetchFromTMDB && parsed.seriesTitle && parsed.seasonNumber && parsed.episodeNumber) {
      try {
        const seriesKey = parsed.seriesTitle.toLowerCase()
        let cachedSeries = seriesTmdbCache?.get(seriesKey)
        if (cachedSeries === undefined) {
          const searchResponse = await tmdb.searchTVShow(parsed.seriesTitle)
          if (searchResponse.results?.length > 0) {
            const series = searchResponse.results[0]
            cachedSeries = { tmdbId: series.id, name: series.name, posterPath: series.poster_path || undefined, seasonPosters: new Map() }
            seriesTmdbCache?.set(seriesKey, cachedSeries)
          } else { seriesTmdbCache?.set(seriesKey, null); cachedSeries = null }
        }

        if (cachedSeries) {
          metadata.seriesTitle = cachedSeries.name; metadata.seriesTmdbId = cachedSeries.tmdbId
          if (cachedSeries.posterPath) metadata.posterUrl = `https://image.tmdb.org/t/p/w500${cachedSeries.posterPath}`
          const episode = await tmdb.getEpisodeDetails(cachedSeries.tmdbId, parsed.seasonNumber, parsed.episodeNumber)
          if (episode) {
            if (episode.name) metadata.title = episode.name
            if (episode.air_date) { const airYear = parseInt(episode.air_date.split('-')[0], 10); if (!isNaN(airYear)) metadata.year = airYear }
            if (episode.still_path) metadata.episodeThumbUrl = `https://image.tmdb.org/t/p/w300${episode.still_path}`
          }
          if (!cachedSeries.seasonPosters.has(parsed.seasonNumber)) {
            const seasonDetails = await tmdb.getSeasonDetails(cachedSeries.tmdbId.toString(), parsed.seasonNumber)
            cachedSeries.seasonPosters.set(parsed.seasonNumber, seasonDetails?.poster_path || null)
          }
          const seasonPoster = cachedSeries.seasonPosters.get(parsed.seasonNumber)
          if (seasonPoster) metadata.seasonPosterUrl = `https://image.tmdb.org/t/p/w500${seasonPoster}`
        }
      } catch (error) { getLoggingService().warn('[LocalFolderProvider]', `TMDB episode lookup failed for "${parsed.seriesTitle}":`, error) }
    }
    return metadata
  }

  private generateItemId(filePath: string): string {
    return `local_${this.simpleHash(filePath)}`
  }

  private generateCanonicalPlexId(metadata: MediaMetadata): string {
    if (metadata.type === 'movie') {
      if (metadata.tmdbId) return `local_movie_${metadata.tmdbId}`
      return `local_movie_hash_${this.simpleHash(`${metadata.title}_${metadata.year || ''}`)}`
    } else {
      const seriesKey = metadata.seriesTmdbId || this.simpleHash(metadata.seriesTitle || '')
      return `local_ep_${seriesKey}_S${metadata.seasonNumber}_E${metadata.episodeNumber}`
    }
  }

  private async saveMediaItems(db: any, processedItems: ProcessedItem[], libraryId: string, scanType: 'movie' | 'episode', isIncremental: boolean): Promise<{ itemsScanned: number; itemsAdded: number; itemsUpdated: number; errors: string[] }> {
    const result = { itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, errors: [] as string[] }
    const analyzer = getQualityAnalyzer()
    const groups: ProcessedItem[][] = []

    if (scanType === 'movie') {
      const groupMap = new Map<string, ProcessedItem[]>()
      for (const item of processedItems) {
        const tmdbId = item.metadata.tmdbId
        const groupKey = tmdbId ? `tmdb:${tmdbId}` : `title:${this.normalizeGroupTitle(item.metadata.title || '')}|${item.metadata.year || ''}`
        if (!groupMap.has(groupKey)) groupMap.set(groupKey, []); groupMap.get(groupKey)!.push(item)
      }
      groups.push(...groupMap.values())
    } else { processedItems.forEach(item => groups.push([item])) }

    for (const group of groups) {
      try {
        const canonicalMetadata = group[0].metadata; const plexId = this.generateCanonicalPlexId(canonicalMetadata)
        let existingMediaItem = db.media.getItemByProviderId(plexId, this.sourceId)
        if (!existingMediaItem) existingMediaItem = db.media.getItemByPath(canonicalMetadata.filePath || '')

        let mergedVersions: any[] = []; const currentBatchVersions = group.map(item => this.convertMetadataToVersion(item.metadata, item.parsed, item.fileMtime))
        if (existingMediaItem) {
          const existingVersions = db.media.getItemVersions(existingMediaItem.id!)
          const currentBatchPaths = new Set(currentBatchVersions.map(v => v.file_path))
          mergedVersions = [...currentBatchVersions]
          if (isIncremental) { existingVersions.forEach((ev: any) => { if (!currentBatchPaths.has(ev.file_path)) mergedVersions.push(ev) }) }
        } else { mergedVersions = currentBatchVersions }

        if (mergedVersions.length > 1) extractVersionNames(mergedVersions)
        const scoredVersions = mergedVersions.map(v => ({ ...v, ...analyzer.analyzeVersion(v as MediaItemVersion) }))
        const bestIdx = scoredVersions.reduce((bi, v, i) => this.calculateVersionScore(v) > this.calculateVersionScore(scoredVersions[bi]) ? i : bi, 0)
        const bestVersion = scoredVersions[bestIdx]; const mediaItem = this.convertMetadataToMediaItem(canonicalMetadata)
        if (!mediaItem) continue

        mediaItem.file_path = bestVersion.file_path; mediaItem.file_size = bestVersion.file_size; mediaItem.duration = bestVersion.duration; mediaItem.resolution = bestVersion.resolution; mediaItem.video_codec = bestVersion.video_codec; mediaItem.audio_codec = bestVersion.audio_codec; mediaItem.source_id = this.sourceId; mediaItem.source_type = 'local'; mediaItem.library_id = libraryId; mediaItem.file_mtime = bestVersion.file_mtime; mediaItem.version_count = scoredVersions.length; mediaItem.plex_id = plexId

        const id = await db.media.upsertItem(mediaItem)
        db.media.syncItemVersions(id, scoredVersions.map(v => ({ ...v, media_item_id: id })))
        mediaItem.id = id; await db.media.upsertQualityScore(await analyzer.analyzeMediaItem(mediaItem))
        result.itemsScanned++; if (existingMediaItem) result.itemsUpdated++; else result.itemsAdded++
        if (result.itemsScanned % 50 === 0) await db.forceSave()
      } catch (error: unknown) { result.errors.push(`Failed to save group ${group.map(g => path.basename(g.metadata.filePath || '')).join(', ')}: ${getErrorMessage(error)}`) }
    }
    return result
  }

  private simpleHash(str: string): string {
    let hash = 0; for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash = hash & hash }
    return Math.abs(hash).toString(36)
  }

  private convertMetadataToVersion(metadata: MediaMetadata, parsed: ParsedMovieInfo | ParsedEpisodeInfo, fileMtime: number): Omit<MediaItemVersion, 'id' | 'media_item_id'> {
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks?.length) { metadata.audioTracks.forEach((track, index) => audioTracks.push({ index, codec: track.codec || 'Unknown', channels: track.channels || 2, bitrate: track.bitrate || 0, language: track.language, hasObjectAudio: track.hasObjectAudio || false })) }
    else if (metadata.audioCodec) { audioTracks.push({ index: 0, codec: metadata.audioCodec, channels: metadata.audioChannels || 2, bitrate: metadata.audioBitrate || 0, hasObjectAudio: false }) }

    const resolution = metadata.resolution || 'SD', hdrFormat = metadata.hdrFormat || 'None', edition = (parsed.type === 'movie' ? (parsed as ParsedMovieInfo).edition : undefined) || undefined, source = parsed.source, sourceType = source && /remux/i.test(source) ? 'REMUX' : source && /web-dl|webdl/i.test(source) ? 'WEB-DL' : undefined
    const labelParts = [resolution]; if (hdrFormat !== 'None') labelParts.push(hdrFormat); if (sourceType) labelParts.push(sourceType); if (edition) labelParts.push(edition)

    return { version_source: `local_file_${this.simpleHash(metadata.filePath || '')}`, edition, source_type: sourceType, label: labelParts.join(' '), file_path: metadata.filePath || '', file_size: metadata.fileSize || 0, duration: metadata.duration || 0, resolution, width: metadata.width || 0, height: metadata.height || 0, video_codec: metadata.videoCodec || '', video_bitrate: metadata.videoBitrate || 0, audio_codec: metadata.audioCodec || '', audio_channels: metadata.audioChannels || 2, audio_bitrate: metadata.audioBitrate || 0, video_frame_rate: metadata.videoFrameRate, color_bit_depth: metadata.colorBitDepth, hdr_format: hdrFormat === 'None' ? undefined : hdrFormat, color_space: metadata.colorSpace, video_profile: metadata.videoProfile, audio_profile: metadata.audioProfile, audio_sample_rate: metadata.audioSampleRate, has_object_audio: metadata.hasObjectAudio, audio_tracks: JSON.stringify(audioTracks), subtitle_tracks: metadata.subtitleTracks?.length ? JSON.stringify(metadata.subtitleTracks.map((t, i) => ({ index: i, codec: t.codec || 'unknown', language: t.language, title: t.title, isDefault: t.isDefault || false, isForced: t.isForced || false }))) : undefined, container: metadata.container, file_mtime: fileMtime }
  }

  private convertMetadataToMediaItem(metadata: MediaMetadata): MediaItem | null {
    const audioTracks: AudioTrack[] = []
    if (metadata.audioTracks?.length) { metadata.audioTracks.forEach((track, index) => audioTracks.push({ index, codec: track.codec || 'Unknown', channels: track.channels || 2, bitrate: track.bitrate || 0, language: track.language, hasObjectAudio: track.hasObjectAudio || false })) }
    else if (metadata.audioCodec) { audioTracks.push({ index: 0, codec: metadata.audioCodec, channels: metadata.audioChannels || 2, bitrate: metadata.audioBitrate || 0, hasObjectAudio: false }) }

    return { plex_id: metadata.itemId, title: metadata.title, sort_title: metadata.sortTitle, year: metadata.year, type: metadata.type, series_title: metadata.seriesTitle, season_number: metadata.seasonNumber, episode_number: metadata.episodeNumber, file_path: metadata.filePath || '', file_size: metadata.fileSize || 0, duration: metadata.duration || 0, resolution: metadata.resolution || 'SD', width: metadata.width || 0, height: metadata.height || 0, video_codec: metadata.videoCodec || '', video_bitrate: metadata.videoBitrate || 0, audio_codec: metadata.audioCodec || '', audio_channels: metadata.audioChannels || 2, audio_bitrate: metadata.audioBitrate || 0, hdr_format: metadata.hdrFormat, video_frame_rate: metadata.videoFrameRate, color_bit_depth: metadata.colorBitDepth, color_space: metadata.colorSpace, video_profile: metadata.videoProfile, audio_tracks: JSON.stringify(audioTracks), subtitle_tracks: metadata.subtitleTracks?.length ? JSON.stringify(metadata.subtitleTracks.map((t, i) => ({ index: i, codec: t.codec || 'unknown', language: t.language, title: t.title, isDefault: t.isDefault || false, isForced: t.isForced || false }))) : undefined, imdb_id: metadata.imdbId, tmdb_id: metadata.tmdbId?.toString(), poster_url: metadata.posterUrl, episode_thumb_url: metadata.episodeThumbUrl, season_poster_url: metadata.seasonPosterUrl, container: metadata.container, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  }

  private convertMediaItemToMetadata(item: MediaItem): MediaMetadata {
    let audioTracks: AudioStreamInfo[] = []
    if (item.audio_tracks) { try { audioTracks = (JSON.parse(item.audio_tracks) as AudioTrack[]).map(t => ({ codec: t.codec, channels: t.channels, bitrate: t.bitrate, language: t.language, title: t.title, isDefault: t.isDefault, hasObjectAudio: t.hasObjectAudio, index: t.index })) } catch (e) { throw e } }
    return { providerId: this.sourceId, providerType: 'local' as ProviderType, itemId: item.plex_id || '', title: item.title, type: item.type, year: item.year, seriesTitle: item.series_title, seasonNumber: item.season_number, episodeNumber: item.episode_number, imdbId: item.imdb_id, tmdbId: item.tmdb_id ? parseInt(item.tmdb_id, 10) : undefined, seriesTmdbId: item.series_tmdb_id ? parseInt(item.series_tmdb_id, 10) : undefined, filePath: item.file_path, fileSize: item.file_size, duration: item.duration, container: item.container, resolution: item.resolution, width: item.width, height: item.height, videoCodec: item.video_codec, videoBitrate: item.video_bitrate, videoFrameRate: item.video_frame_rate, colorBitDepth: item.color_bit_depth, hdrFormat: item.hdr_format, colorSpace: item.color_space, videoProfile: item.video_profile, audioCodec: item.audio_codec, audioChannels: item.audio_channels, audioBitrate: item.audio_bitrate, audioSampleRate: item.audio_sample_rate, hasObjectAudio: item.has_object_audio, audioTracks, posterUrl: item.poster_url, episodeThumbUrl: item.episode_thumb_url, seasonPosterUrl: item.season_poster_url }
  }

  private async scanMusicLibrary(onProgress?: ProgressCallback, scanPath?: string): Promise<ScanResult> {
    const musicPath = scanPath || this.folderPath; const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    if (!musicPath || !fs.existsSync(musicPath)) { result.errors.push('Folder not found or not configured'); result.durationMs = Date.now() - startTime; return result }

    try {
      const db = getDatabase(); const fileAnalyzer = getMediaFileAnalyzer(); const parser = getFileNameParser()
      const ffprobeAvailable = db.config.getSetting('ffprobe_enabled') !== 'false' && await fileAnalyzer.isAvailable()
      const mbNameCorrectionEnabled = await this.isMusicBrainzNameCorrectionEnabled(), scannedFilePaths = new Set<string>(), mbArtistNameCache = new Map<string, string>()
      const ffprobeParallelEnabled = db.config.getSetting('ffprobe_parallel_enabled') !== 'false', ffprobeBatchSize = parseInt(db.config.getSetting('ffprobe_batch_size') || '50', 10)

      onProgress?.({ current: 0, total: 100, phase: 'fetching', currentItem: 'Scanning for music files...', percentage: 0 })
      const audioFiles = await this.discoverAudioFiles(musicPath); const totalFiles = audioFiles.length
      if (totalFiles === 0) { result.success = true; result.durationMs = Date.now() - startTime; return result }

      const artistMap = new Map<string, number>(), albumMap = new Map<string, number>(), albumArtworkMap = new Map<string, string | null>()
      try {
        for (let batchStart = 0; batchStart < audioFiles.length; batchStart += ffprobeBatchSize) {
          const batchEnd = Math.min(batchStart + ffprobeBatchSize, audioFiles.length), batchFiles = audioFiles.slice(batchStart, batchEnd)
          const filesToProcess: any[] = [], filesToAnalyze: string[] = []

          for (let i = 0; i < batchFiles.length; i++) {
            const { filePath, relativePath } = batchFiles[i]
            onProgress?.({ current: batchStart + i + 1, total: totalFiles, phase: 'processing', currentItem: path.basename(filePath), percentage: ((batchStart + i + 1) / totalFiles) * 100 })
            try {
              const parsed = parser.parseMusic(path.basename(filePath, path.extname(filePath)), path.dirname(relativePath))
              let artistName = parsed.artist || 'Unknown Artist'
              if (mbNameCorrectionEnabled && artistName !== 'Unknown Artist') artistName = await this.lookupCanonicalArtistName(artistName, mbArtistNameCache)
              const stats = await fsPromises.stat(filePath), fileMtime = stats.mtime.getTime()
              const existingTrack = db.music.getTrackByPath(filePath)
              if (existingTrack?.file_mtime === fileMtime) { scannedFilePaths.add(filePath); result.itemsScanned++; continue }
              filesToProcess.push({ filePath, relativePath, fileMtime, fileSize: stats.size, artistName, albumName: parsed.album || 'Unknown Album', trackTitle: parsed.title || path.basename(filePath, path.extname(filePath)), trackNumber: parsed.trackNumber, discNumber: parsed.discNumber, year: parsed.year })
              if (ffprobeAvailable) filesToAnalyze.push(filePath)
            } catch (e: any) { result.errors.push(`Failed to process ${path.basename(filePath)}: ${getErrorMessage(e)}`) }
          }

          let ffprobeResults = new Map<string, FileAnalysisResult>()
          if (filesToAnalyze.length > 0) {
            onProgress?.({ current: batchEnd, total: totalFiles, phase: 'analyzing', currentItem: `Analyzing ${filesToAnalyze.length} audio files...`, percentage: (batchEnd / totalFiles) * 100 })
            ffprobeResults = ffprobeParallelEnabled && ffprobeBatchSize > 1 ? await fileAnalyzer.analyzeFilesParallel(filesToAnalyze) : new Map(await Promise.all(filesToAnalyze.map(async fp => [fp, await fileAnalyzer.analyzeFile(fp)] as [string, FileAnalysisResult])))
          }

          for (const fileInfo of filesToProcess) {
            const { filePath, fileMtime, artistName, albumName, trackTitle } = fileInfo
            try {
              let audioInfo: any = {}
              const analysis = ffprobeResults.get(filePath)
              if (analysis?.success && analysis.audioTracks?.length > 0) {
                const primaryAudio = analysis.audioTracks[0]
                audioInfo = { codec: normalizeAudioCodec(primaryAudio.codec, primaryAudio.profile), bitrate: primaryAudio.bitrate, sampleRate: primaryAudio.sampleRate, bitDepth: primaryAudio.bitDepth, channels: primaryAudio.channels, duration: analysis.duration, isLossless: this.isLosslessCodec(primaryAudio.codec), hasEmbeddedArtwork: analysis.embeddedArtwork?.hasArtwork }
              }

              let artistId = artistMap.get(artistName.toLowerCase())
              if (!artistId) {
                artistId = (db.music.getMusicArtistByName(artistName, this.sourceId))?.id || await db.music.upsertArtist({ source_id: this.sourceId, source_type: 'local', library_id: 'music', provider_id: this.generateItemId(`artist_${artistName}`), name: artistName, sort_name: artistName, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                artistMap.set(artistName.toLowerCase(), artistId!)
              }

              const albumKey = `${artistName.toLowerCase()}|${albumName.toLowerCase()}`
              let albumId = albumMap.get(albumKey)
              if (!albumId) {
                albumId = (db.music.getAlbumByName(albumName, artistId!))?.id || await db.music.upsertAlbum({ source_id: this.sourceId, source_type: 'local', library_id: 'music', provider_id: this.generateItemId(`album_${artistName}_${albumName}`), artist_id: artistId!, artist_name: artistName, title: albumName, sort_title: albumName, year: fileInfo.year, album_type: 'album', best_audio_codec: audioInfo.codec, best_audio_bitrate: audioInfo.bitrate, best_sample_rate: audioInfo.sampleRate, best_bit_depth: audioInfo.bitDepth, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                albumMap.set(albumKey, albumId!)
              }

              if (!albumArtworkMap.has(albumKey)) {
                let artworkPath = audioInfo.hasEmbeddedArtwork && ffprobeAvailable ? await this.extractAlbumArtwork(filePath, albumId!, fileAnalyzer) : null
                if (!artworkPath) { const folderArtwork = await this.findFolderArtwork(path.dirname(filePath)); if (folderArtwork) artworkPath = `local-artwork://file?path=${encodeURIComponent(folderArtwork)}` }
                albumArtworkMap.set(albumKey, artworkPath); if (artworkPath) await db.music.updateMusicAlbumArtwork(albumId, artworkPath)
              }

              await db.music.upsertTrack({ source_id: this.sourceId, source_type: 'local', library_id: 'music', provider_id: this.generateItemId(filePath), album_id: albumId, artist_id: artistId, album_name: albumName, artist_name: artistName, title: trackTitle, track_number: fileInfo.trackNumber, disc_number: fileInfo.discNumber, duration: audioInfo.duration, file_path: filePath, file_size: fileInfo.fileSize, file_mtime: fileMtime, container: path.extname(filePath).slice(1).toLowerCase(), audio_codec: audioInfo.codec || 'Unknown', audio_bitrate: audioInfo.bitrate, sample_rate: audioInfo.sampleRate, bit_depth: audioInfo.bitDepth, channels: audioInfo.channels, is_lossless: audioInfo.isLossless, is_hi_res: this.isHiRes(audioInfo.sampleRate, audioInfo.bitDepth), created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              scannedFilePaths.add(filePath); result.itemsScanned++
            } catch (e: any) { result.errors.push(`Failed to save ${path.basename(filePath)}: ${getErrorMessage(e)}`) }
          }
          if (result.itemsScanned > 0) await db.forceSave()
        }
      } finally {
        // No endBatch needed
      }

      await this.updateAlbumStats(db, albumMap)
      onProgress?.({ current: totalFiles, total: totalFiles, phase: 'saving', currentItem: 'Reconciling deletions...', percentage: 100 })
      const existingTracks = db.music.getTracks({ sourceId: this.sourceId })
      for (const track of existingTracks) {
        if (track.file_path && !scannedFilePaths.has(track.file_path)) {
          if (!fs.existsSync(track.file_path)) {
            if (track.id) { await db.music.deleteMusicTrack(track.id); result.itemsRemoved++; if (track.artist_name) artistMap.set(track.artist_name.toLowerCase(), track.artist_id!); if (track.artist_name && track.album_name) albumMap.set(`${track.artist_name.toLowerCase()}|${track.album_name.toLowerCase()}`, track.album_id!) }
          }
        }
      }
      await this.updateArtistStats(db, artistMap); await db.sources.updateSourceScanTime(this.sourceId)
      result.success = true; result.durationMs = Date.now() - startTime; return result
    } catch (e: any) { result.errors.push(getErrorMessage(e)); result.durationMs = Date.now() - startTime; return result }
  }

  private async discoverAudioFiles(rootDir: string): Promise<Array<{ filePath: string; relativePath: string }>> {
    const parser = getFileNameParser(); const files: Array<{ filePath: string; relativePath: string }> = []
    let directoriesProcessed = 0
    const scanDir = async (dir: string, depth = 0): Promise<void> => {
      if (depth > 15) return
      try {
        const entries = await fsPromises.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (['@eadir', '.ds_store', 'thumbs', 'metadata', 'artwork', 'scans', 'covers'].includes(entry.name.toLowerCase())) continue
            await scanDir(fullPath, depth + 1)
          } else if (parser.isAudioFile(entry.name)) {
            files.push({ filePath: fullPath, relativePath: path.relative(rootDir, fullPath) })
          }
        }
        directoriesProcessed++; if (directoriesProcessed % 50 === 0) await new Promise(resolve => setImmediate(resolve))
      } catch (e) { getLoggingService().warn('[LocalFolderProvider]', `Cannot access directory: ${path.basename(dir)}`) }
    }
    await scanDir(rootDir); return files
  }

  private isLosslessCodec(codec: string): boolean {
    const lossless = ['flac', 'alac', 'wav', 'aiff', 'ape', 'pcm', 'dsd', 'dsf', 'dff']
    return lossless.some(c => codec.toLowerCase().includes(c))
  }

  private isHiRes(sampleRate?: number, bitDepth?: number): boolean {
    return (sampleRate && sampleRate > 48000) || (bitDepth && bitDepth > 16) || false
  }

  private async updateAlbumStats(_db: any, _albumMap: Map<string, number>): Promise<void> {}

  private async extractAlbumArtwork(audioFilePath: string, albumId: number, fileAnalyzer: any): Promise<string | null> {
    try {
      const artworkDir = path.join(app.getPath('userData'), 'artwork', 'albums')
      if (!fs.existsSync(artworkDir)) fs.mkdirSync(artworkDir, { recursive: true })
      const outputPath = path.join(artworkDir, `${albumId}.jpg`), artworkUrl = `local-artwork://albums/${albumId}.jpg`
      if (fs.existsSync(outputPath)) return artworkUrl
      if (await fileAnalyzer.extractArtwork(audioFilePath, outputPath)) return artworkUrl
      return null
    } catch (e) { return null }
  }

  private async findFolderArtwork(folderPath: string): Promise<string | null> {
    const artworkFilenames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.jpeg', 'folder.png', 'front.Front.jpeg', 'front.png', 'album.jpg', 'album.jpeg', 'album.png', 'albumart.jpg', 'albumart.jpeg', 'albumart.png', 'artwork.jpg', 'artwork.jpeg', 'artwork.png']
    try {
      const files = fs.readdirSync(folderPath), lowerFiles = files.map(f => f.toLowerCase())
      for (const name of artworkFilenames) { const idx = lowerFiles.indexOf(name); if (idx !== -1) return path.join(folderPath, files[idx]) }
      return null
    } catch (e) { throw e }
  }

  private async updateArtistStats(db: any, artistMap: Map<string, number>): Promise<void> {
    for (const [, aId] of artistMap) {
      await db.music.updateMusicArtistCounts(aId, (db.music.getMusicAlbums({ artistId: aId })).length, (db.music.getMusicTracks({ artistId: aId })).length)
    }
  }
}
