/**
 * MediaProvider Interface
 *
 * Defines the common interface for all media library providers
 * (Plex, Jellyfin, Emby, Kodi)
 */

import {
  normalizeResolution,
} from '@main/services/MediaNormalizer'
import { ProviderType, LibraryType, MediaItemVersion, MediaItemType } from '@main/types/database'
import type { ConnectionTestResult } from '@main/types/ipc'
import { generateSourceId } from '@main/providers/utils/IdUtils'
import { calculateVersionScore } from '@main/providers/utils/ProviderUtils'

// Credentials for different provider types
export interface ProviderCredentials {
  // Plex: OAuth token
  token?: string
  serverId?: string

  // Jellyfin/Emby: Server URL + credentials
  serverUrl?: string
  apiKey?: string
  accessToken?: string
  username?: string
  password?: string

  // Kodi: JSON-RPC connection
  host?: string
  port?: number

  // Kodi MySQL: Database connection
  videoDatabaseName?: string
  musicDatabaseName?: string
  databasePrefix?: string
  ssl?: boolean
  connectionTimeout?: number
  videoDatabaseVersion?: number

  // Kodi Local: Local database access
  databasePath?: string
  databaseVersion?: number
  musicDatabasePath?: string
  includeVideo?: boolean
  includeMusic?: boolean

  // Local folder
  folderPath?: string
  mediaType?: LibraryType
  name?: string
  customLibraries?: Array<{
    name: string
    path: string
    mediaType: LibraryType
    enabled: boolean
  }>

  // Common
  userId?: string
}

// Authentication result
export interface AuthResult {
  success: boolean
  error?: string
  token?: string
  apiKey?: string
  userId?: string
  userName?: string
  serverName?: string
  serverVersion?: string
}

// Connection test result - imported from shared types

// Server/instance discovered via provider
export interface ServerInstance {
  id: string
  name: string
  address: string
  port: number
  version?: string
  isLocal?: boolean
  isOwned?: boolean
  protocol?: 'http' | 'https'
}

// Library in a media server
export interface MediaLibrary {
  id: string
  name: string
  type: LibraryType
  collectionType?: string // Raw provider-specific type (e.g., 'boxsets', 'movies', 'tvshows')
  itemCount?: number
  scannedAt?: string
}

// Video stream metadata
export interface VideoStreamInfo {
  codec: string
  profile?: string
  level?: string
  width: number
  height: number
  bitrate?: number
  frameRate?: number
  bitDepth?: number
  hdrFormat?: string
  colorSpace?: string
}

// Audio stream metadata
export interface AudioStreamInfo {
  codec: string
  profile?: string
  channels: number
  bitrate?: number
  sampleRate?: number
  language?: string
  title?: string
  isDefault?: boolean
  hasObjectAudio?: boolean
  index?: number
}

// Subtitle stream metadata
export interface SubtitleStreamInfo {
  codec: string
  language?: string
  title?: string
  isDefault?: boolean
  isForced?: boolean
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
  type: MediaItemType
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
  currentItem?: string
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
  forceFullScan?: boolean
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
  cancelled?: boolean
}

// Source configuration stored in database
export interface SourceConfig {
  sourceId?: string
  sourceType: ProviderType
  displayName: string
  connectionConfig: ProviderCredentials
  isEnabled?: boolean
}

// Full source record from database
export interface MediaSource extends SourceConfig {
  sourceId: string
  isEnabled: boolean
  lastConnectedAt?: string
  lastScanAt?: string
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
    lastScanAt?: string
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
  getLibraryItems?(libraryId: string, offset?: number, limit?: number): Promise<MediaMetadata[]>

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
    this.sourceId = config.sourceId || generateSourceId(config.sourceType)
    this.config = { ...config, sourceId: this.sourceId }
  }

  /**
   * Update the provider's configuration.
   */
  public updateConfig(updates: Partial<SourceConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
      connectionConfig: {
        ...this.config.connectionConfig,
        ...(updates.connectionConfig || {})
      }
    }
  }

  abstract authenticate(credentials: ProviderCredentials): Promise<AuthResult>
  abstract isAuthenticated(): Promise<boolean>
  abstract disconnect(): Promise<void>
  abstract testConnection(): Promise<ConnectionTestResult>
  abstract getLibraries(): Promise<MediaLibrary[]>
  abstract scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult>
  abstract getItemMetadata(itemId: string): Promise<MediaMetadata>

  /**
   * Calculate a quality score for a media version to pick the 'best' one for display.
   * Higher score = better quality.
   */
  protected calculateVersionScore(v: Partial<MediaItemVersion>): number {
    return calculateVersionScore(v as any)
  }

  /**
   * Clean titles for version grouping.
   * Removes edition names and bracketed content to find the common 'feature' name.
   */
  protected normalizeGroupTitle(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/\s*[-:(]\s*(director'?s?\s*cut|extended|unrated|theatrical|imax|remastered|special\s*edition|ultimate\s*edition|collector'?s?\s*edition)\s*[):]?\s*$/i, '')
      .replace(/\s*\(\s*\)\s*$/, '') // Empty brackets
      .trim()
  }

  // Helper to normalize resolution string using MediaNormalizer
  protected normalizeResolution(width: number, height: number): string {
    return normalizeResolution(width, height)
  }
}
