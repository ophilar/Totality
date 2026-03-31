/**
 * MediaProvider Interface
 *
 * Defines the common interface for all media library providers
 * (Plex, Jellyfin, Emby, Kodi)
 */

// Import and re-export shared IPC types
import type { ConnectionTestResult } from '../../types/ipc'
export type { ConnectionTestResult }

// Provider types supported by the application
export type ProviderType = 'plex' | 'jellyfin' | 'emby' | 'kodi' | 'kodi-local' | 'kodi-mysql' | 'local'

// Credentials for different provider types
export interface ProviderCredentials {
  // Plex: OAuth token
  token?: string | null

  // Jellyfin/Emby: Server URL + credentials
  serverUrl?: string | null
  apiKey?: string | null
  accessToken?: string | null
  username?: string | null
  password?: string | null

  // Kodi: JSON-RPC connection
  host?: string | null
  port?: number | null

  // Kodi MySQL: Database connection
  videoDatabaseName?: string | null
  musicDatabaseName?: string | null
  databasePrefix?: string | null
  ssl?: boolean | null
  connectionTimeout?: number | null
  videoDatabaseVersion?: number | null

  // Kodi Local: Local database access
  databasePath?: string | null
  databaseVersion?: number | null
  musicDatabasePath?: string | null
  includeVideo?: boolean | null
  includeMusic?: boolean | null

  // Local folder
  folderPath?: string | null
  mediaType?: 'movies' | 'tvshows' | 'mixed'
  name?: string | null
  customLibraries?: Array<{
    name: string
    path: string
    mediaType: 'movies' | 'tvshows' | 'music'
    enabled: boolean
  }>

  // Common
  userId?: string | null
}

// Authentication result
export interface AuthResult {
  success: boolean
  error?: string | null
  token?: string | null
  apiKey?: string | null
  userId?: string | null
  userName?: string | null
  serverName?: string | null
  serverVersion?: string | null
}

// Connection test result - imported from shared types

// Server/instance discovered via provider
export interface ServerInstance {
  id: string
  name: string
  address: string
  port: number
  version?: string | null
  isLocal?: boolean | null
  isOwned?: boolean | null
  protocol?: 'http' | 'https'
}

// Library in a media server
export interface MediaLibrary {
  id: string
  name: string
  type: 'movie' | 'show' | 'music' | 'unknown'
  collectionType?: string | null // Raw provider-specific type (e.g., 'boxsets', 'movies', 'tvshows')
  itemCount?: number | null
  scannedAt?: string | null
}

// Video stream metadata
export interface VideoStreamInfo {
  codec: string
  profile?: string | null
  level?: string | null
  width: number
  height: number
  bitrate?: number | null
  frameRate?: number | null
  bitDepth?: number | null
  hdrFormat?: string | null
  colorSpace?: string | null
}

// Audio stream metadata
export interface AudioStreamInfo {
  codec: string
  profile?: string | null
  channels: number
  bitrate?: number | null
  sampleRate?: number | null
  language?: string | null
  title?: string | null
  isDefault?: boolean | null
  hasObjectAudio?: boolean | null
  index?: number | null
}

// Subtitle stream metadata
export interface SubtitleStreamInfo {
  codec: string
  language?: string | null
  title?: string | null
  isDefault?: boolean | null
  isForced?: boolean | null
}

// Normalized media metadata from any provider
export interface MediaMetadata {
  // Provider reference
  providerId: string
  providerType: ProviderType

  // Core identification
  itemId: string
  title: string
  sortTitle?: string | null
  type: 'movie' | 'episode'
  year?: number | null

  // Episode-specific
  seriesTitle?: string | null
  seasonNumber?: number | null
  episodeNumber?: number | null

  // External IDs
  imdbId?: string | null
  tmdbId?: number | null
  seriesTmdbId?: number | null

  // File info
  filePath?: string | null
  fileSize?: number | null
  duration?: number | null
  container?: string | null

  // Video quality
  resolution?: string | null
  width?: number | null
  height?: number | null
  videoCodec?: string | null
  videoBitrate?: number | null
  videoFrameRate?: number | null
  colorBitDepth?: number | null
  hdrFormat?: string | null
  colorSpace?: string | null
  videoProfile?: string | null
  videoLevel?: string | null

  // Audio quality (primary track)
  audioCodec?: string | null
  audioChannels?: number | null
  audioBitrate?: number | null
  audioProfile?: string | null
  audioSampleRate?: number | null
  hasObjectAudio?: boolean | null

  // All audio tracks
  audioTracks?: AudioStreamInfo[]

  // Subtitles
  subtitleTracks?: SubtitleStreamInfo[]

  // Artwork
  posterUrl?: string | null
  episodeThumbUrl?: string | null
  seasonPosterUrl?: string | null
  backdropUrl?: string | null

  // Original raw data for debugging
  rawData?: unknown
}

// Progress callback for long operations
export interface ScanProgress {
  current: number
  total: number
  phase: 'fetching' | 'processing' | 'analyzing' | 'saving'
  currentItem?: string | null
  percentage: number
}

export type ProgressCallback = (progress: ScanProgress) => void

// Scan options for controlling scan behavior
export interface ScanOptions {
  /** Progress callback for scan updates */
  onProgress?: ProgressCallback
  /** Only scan items added/modified after this timestamp (incremental scan) */
  sinceTimestamp?: Date
  /** Force full scan even if sinceTimestamp is provided */
  forceFullScan?: boolean | null
  /** Specific files to scan (for targeted scanning from file watcher) */
  targetFiles?: string[]
}

// Scan result summary
export interface ScanResult {
  success: boolean
  itemsScanned: number
  itemsAdded: number
  itemsUpdated: number
  itemsRemoved: number
  errors: string[]
  durationMs: number
  cancelled?: boolean | null
}

// Source configuration stored in database
export interface SourceConfig {
  sourceId?: string | null
  sourceType: ProviderType
  displayName: string
  connectionConfig: ProviderCredentials
  isEnabled?: boolean | null
}

// Full source record from database
export interface MediaSource extends SourceConfig {
  sourceId: string
  isEnabled: boolean
  lastConnectedAt?: string | null
  lastScanAt?: string | null
  createdAt: string
  updatedAt: string
}

// Aggregated statistics across sources
export interface AggregatedStats {
  totalItems: number
  totalMovies: number
  totalEpisodes: number
  totalSources: number
  bySource: Map<string, {
    sourceId: string
    displayName: string
    sourceType: ProviderType
    itemCount: number
    lastScanAt?: string | null
  }>
}

/**
 * MediaProvider Interface
 *
 * All media library providers must implement this interface
 * to provide a consistent API for the application.
 */
export interface MediaProvider {
  // Provider identification
  readonly providerType: ProviderType
  readonly sourceId: string

  // Authentication
  authenticate(credentials: ProviderCredentials): Promise<AuthResult>
  isAuthenticated(): Promise<boolean>
  disconnect(): Promise<void>

  // Server/Instance Discovery (optional - Plex uses this)
  discoverServers?(): Promise<ServerInstance[]>
  selectServer?(serverId: string): Promise<boolean>

  // Connection Testing
  testConnection(): Promise<ConnectionTestResult>

  // Library Operations
  getLibraries(): Promise<MediaLibrary[]>
  scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult>

  // Item Operations
  getItemMetadata(itemId: string): Promise<MediaMetadata>
  getLibraryItems?(libraryId: string, offset?: number | null, limit?: number | null): Promise<MediaMetadata[]>

  // TV-specific operations (optional)
  getShowSeasons?(showId: string): Promise<{ seasonNumber: number; episodeCount: number }[]>
  getSeasonEpisodes?(showId: string, seasonNumber: number): Promise<MediaMetadata[]>
}

/**
 * Base class for providers with common functionality
 */
export abstract class BaseMediaProvider implements MediaProvider {
  abstract readonly providerType: ProviderType
  readonly sourceId: string

  protected config: SourceConfig
  protected isConnected: boolean = false

  constructor(config: SourceConfig) {
    this.sourceId = config.sourceId || this.generateSourceId()
    this.config = { ...config, sourceId: this.sourceId }
  }

  protected generateSourceId(): string {
    return `${this.providerType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  abstract authenticate(credentials: ProviderCredentials): Promise<AuthResult>
  abstract isAuthenticated(): Promise<boolean>
  abstract disconnect(): Promise<void>
  abstract testConnection(): Promise<ConnectionTestResult>
  abstract getLibraries(): Promise<MediaLibrary[]>
  abstract scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult>
  abstract getItemMetadata(itemId: string): Promise<MediaMetadata>

  // Helper to normalize resolution string
  protected normalizeResolution(width: number, height: number): string {
    if (height >= 2160 || width >= 3840) return '4K'
    if (height >= 1080 || width >= 1920) return '1080p'
    if (height >= 720 || width >= 1280) return '720p'
    if (height >= 480 || width >= 720) return '480p'
    return 'SD'
  }

  // Helper to detect HDR format
  protected detectHdrFormat(colorSpace?: string | null, bitDepth?: number | null, profile?: string | null): string | undefined {
    if (!colorSpace && !profile) return undefined

    const colorSpaceLower = (colorSpace || '').toLowerCase()
    const profileLower = (profile || '').toLowerCase()

    if (profileLower.includes('dolby vision') || colorSpaceLower.includes('dv')) {
      return 'Dolby Vision'
    }
    if (colorSpaceLower.includes('bt2020') || colorSpaceLower.includes('rec2020')) {
      if (profileLower.includes('hdr10+') || colorSpaceLower.includes('hdr10+')) {
        return 'HDR10+'
      }
      if (bitDepth && bitDepth >= 10) {
        return 'HDR10'
      }
    }
    if (colorSpaceLower.includes('hlg')) {
      return 'HLG'
    }

    return undefined
  }

  // Helper to detect object-based audio
  protected hasObjectAudio(codec?: string | null, profile?: string | null, title?: string | null): boolean {
    const codecLower = (codec || '').toLowerCase()
    const profileLower = (profile || '').toLowerCase()
    const titleLower = (title || '').toLowerCase()

    return (
      codecLower.includes('truehd') && (profileLower.includes('atmos') || titleLower.includes('atmos')) ||
      codecLower.includes('eac3') && (profileLower.includes('atmos') || titleLower.includes('atmos')) ||
      codecLower.includes('dts') && (profileLower.includes('x') || titleLower.includes('dts:x') || titleLower.includes('dts-x'))
    )
  }
}
