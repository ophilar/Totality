// Database type definitions
import type { MediaItemSortField, TVShowSortField } from '../../shared/librarySortFields'

// Provider types supported by the application
export const PROVIDER_TYPES = ['plex', 'jellyfin', 'emby', 'kodi', 'kodi-local', 'kodi-mysql', 'local', 'mediamonkey'] as const
export type ProviderType = typeof PROVIDER_TYPES[number]

// Syncable tag fields on music tracks
export type SyncField = 'mood' | 'genre'

// Media source configuration (Plex, Jellyfin, Emby, Kodi servers)
export interface MediaSource {
  id?: number
  source_id: string
  source_type: ProviderType
  display_name: string
  connection_config: string // JSON string containing provider-specific config
  is_enabled: boolean
  last_connected_at?: string
  last_scan_at?: string
  created_at: string
  updated_at: string
}

// Parsed connection config for different providers
export interface PlexConnectionConfig {
  token: string
  serverUrl: string
  serverId: string
}

export interface JellyfinConnectionConfig {
  serverUrl: string
  apiKey: string
  userId?: string
  username?: string
}

export interface EmbyConnectionConfig {
  serverUrl: string
  apiKey: string
  userId?: string
  username?: string
}

export interface KodiConnectionConfig {
  host: string
  port: number
  username?: string
  password?: string
}

export interface KodiLocalConnectionConfig {
  databasePath: string
  databaseVersion?: number
  musicDatabasePath?: string | null
  musicDatabaseVersion?: number | null
  includeVideo?: boolean
  includeMusic?: boolean
}

export interface KodiMySQLConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  videoDatabaseName?: string
  videoDatabaseVersion?: number
  musicDatabaseName?: string
  musicDatabaseVersion?: number
  databasePrefix?: string
  ssl?: boolean
  connectionTimeout?: number
}

export interface LocalFolderConnectionConfig {
  folderPath: string
  mediaType: 'movies' | 'tvshows' | 'music' | 'mixed'
  name?: string
}

export type ConnectionConfig =
  | PlexConnectionConfig
  | JellyfinConnectionConfig
  | EmbyConnectionConfig
  | KodiConnectionConfig
  | KodiLocalConnectionConfig
  | KodiMySQLConnectionConfig
  | LocalFolderConnectionConfig

// Audio track information for multi-track support
export interface AudioTrack {
  index: number
  codec: string
  channels: number
  bitrate: number
  language?: string
  title?: string
  profile?: string
  sampleRate?: number
  isDefault?: boolean
  hasObjectAudio?: boolean
}

// Subtitle track information
export interface SubtitleTrack {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault?: boolean
  isForced?: boolean
}

export type EvidenceStatus = 'measured' | 'estimated' | 'insufficient'
export type EvidenceConfidence = 'high' | 'medium' | 'low' | 'none'
export type SavingsCoverage = 'complete' | 'partial' | 'insufficient'
export type SavingsBasis =
  | 'audio_stream_removal'
  | 'subtitle_stream_removal'
  | 'audio_stream_removal_and_transcode_model'
  | 'audio_transcode_model'
  | 'video_sample_encode'
  | 'representative_video_sample_projection'
  | 'video_bitrate_estimate'
  | 'audio_bitrate_estimate'
  | 'mixed_estimates'
  | 'mixed_measured'
  | 'mixed_measured_and_estimated'
  | 'insufficient_data'

export interface MediaDuplicate {
  id?: number
  source_id: string
  external_id: string
  external_type: 'tmdb_movie' | 'tmdb_series' | 'musicbrainz_artist' | 'musicbrainz_album'
  media_item_ids: string
  status: 'pending' | 'resolved' | 'ignored'
  resolution_strategy?: string
  resolved_at?: string
  created_at?: string
  updated_at?: string
}

export interface MediaItem {
  id?: number

  // Source tracking (for multi-provider support)
  source_id?: string
  source_type?: ProviderType
  library_id?: string // Library ID within the source

  // Provider item ID (was plex_id, now generic but kept for compatibility)
  plex_id: string
  title: string
  sort_title?: string
  year?: number
  type: 'movie' | 'episode'
  series_title?: string
  season_number?: number
  episode_number?: number

  // File information
  file_path: string
  file_size_bytes: number
  duration_ms: number

  // Video quality
  resolution: string
  width: number
  height: number
  video_codec: string
  video_bitrate_kbps: number

  // Audio quality
  audio_codec: string
  audio_channels: number
  audio_bitrate_kbps: number

  // Enhanced video quality metadata
  video_frame_rate?: number      // 23.976, 24, 60 fps
  color_bit_depth?: number        // 8, 10, 12 bits
  hdr_format?: string             // "None", "HDR10", "Dolby Vision", "HLG"
  color_space?: string            // "bt709", "bt2020nc"
  video_profile?: string          // "high", "main 10"
  video_level?: number            // 41, 50, 51
  dolby_vision_profile?: number | null // 0 means probed and absent; null means unavailable or not probed

  // Enhanced audio quality metadata
  audio_profile?: string          // "lc", "he", "truehd"
  audio_sample_rate?: number      // 48000, 96000 Hz
  has_object_audio?: boolean      // Atmos/DTS:X flag

  // All audio tracks (JSON string in DB, parsed here)
  audio_tracks?: string           // JSON array of AudioTrack

  // All subtitle tracks (JSON string in DB, parsed here)
  subtitle_tracks?: string        // JSON array of SubtitleTrack

  // Container metadata
  container?: string              // "mkv", "mp4", "avi"

  // File modification tracking (for skip-unchanged optimization)
  file_mtime?: number             // Unix timestamp of file modification time

  // Deep FFprobe/FFmpeg analysis (JSON) and measurement timestamp
  deep_analysis?: string
  deep_analysis_at?: string

  // Metadata
  imdb_id?: string
  tmdb_id?: string
  series_tmdb_id?: string // Show-level TMDB ID for episodes (from Plex show metadata)
  series_identity_key?: string | null
  original_language?: string | null
  audio_language?: string | null
  quality_tier?: string
  tier_quality?: string
  tier_score?: number | null
  efficiency_score?: number | null
  video_savings_bytes?: number | null
  needs_upgrade?: boolean
  poster_url?: string
  episode_thumb_url?: string
  season_poster_url?: string
  summary?: string

  // Estimated savings
  evidence_status?: string | null
  savings_coverage?: SavingsCoverage

  // Ratings
  tmdb_rating?: number            // 0-10 scale from TMDB vote_average

  // User override flag (preserves user-selected metadata during rescans)
  user_fixed_match?: boolean

  // Watch history
  play_count?: number
  last_watched_at?: string        // ISO 8601

  // Multi-version support
  version_count?: number          // Cached count of versions (default 1)

  // Timestamps
  created_at: string
  updated_at: string
}

export type MediaItemUpsert = Pick<MediaItem, 'plex_id' | 'title' | 'type'> & {
  [Key in Exclude<keyof MediaItem, 'id' | 'plex_id' | 'title' | 'type' | 'created_at' | 'updated_at'>]?: MediaItem[Key] | null
}

// Represents one file/version of a media item (e.g., 4K HDR vs 1080p theatrical)
export interface MediaItemVersion {
  id?: number
  media_item_id: number

  // Version identification
  version_source: string          // 'primary', 'plex_media_1', 'jellyfin_source_abc', 'local_file'
  edition?: string                // 'Extended', "Director's Cut", 'IMAX', 'Remastered', etc.
  label?: string                  // Auto-generated: "4K HDR Dolby Vision", "1080p Extended"
  source_type?: string            // 'REMUX', 'WEB-DL' — used for label generation, not persisted

  // File information
  file_path: string
  file_size_bytes: number
  duration_ms: number

  // Video quality
  resolution: string
  width: number
  height: number
  video_codec: string
  video_bitrate_kbps: number

  // Audio quality (best audio track)
  audio_codec: string
  audio_channels: number
  audio_bitrate_kbps: number

  // Enhanced video quality metadata
  video_frame_rate?: number
  color_bit_depth?: number
  hdr_format?: string
  color_space?: string
  video_profile?: string
  video_level?: number

  // Enhanced audio quality metadata
  audio_profile?: string
  audio_sample_rate?: number
  has_object_audio?: boolean

  // All tracks (JSON strings)
  audio_tracks?: string
  subtitle_tracks?: string

  // Container
  container?: string
  file_mtime?: number

  // Quality scores (denormalized for fast access)
  quality_tier?: string           // 'SD', '720p', '1080p', '4K'
  tier_quality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
  tier_score?: number | null
  needs_upgrade?: boolean
  bitrate_tier_score?: number | null
  audio_tier_score?: number | null

  // Best version flag
  is_best?: boolean

  // Timestamps
  created_at?: string
  updated_at?: string
}

export interface QualityScore {
  id?: number
  media_item_id: number

  // Tier-based scoring
  quality_tier: 'SD' | '720p' | '1080p' | '4K' | 'UNKNOWN'
  tier_quality: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
  tier_score: number | null
  bitrate_tier_score: number | null
  audio_tier_score: number | null

  // Legacy scores (for backward compatibility)
  overall_score: number | null
  resolution_score: number | null
  bitrate_score: number | null
  audio_score: number | null

  efficiency_score?: number | null
  video_savings_bytes?: number | null

  estimated_savings_bytes?: number | null
  evidence_status?: EvidenceStatus
  savings_coverage: SavingsCoverage
  confidence?: EvidenceConfidence
  savings_basis?: SavingsBasis

  // Quality flags
  is_low_quality: boolean // Deprecated, use tier_quality === 'LOW'
  needs_upgrade: boolean // Maps to tier_quality === 'LOW'

  // Analysis details
  issues: string // JSON array of issues

  // Upgrade tracking
  previous_quality_tier?: string
  upgraded_at?: string

  created_at: string
  updated_at: string
}

export interface AppSettings {
  id?: number
  key: string
  value: string

  updated_at: string
}

export interface SeriesCompleteness {
  id?: number
  series_title: string

  // Source/library scoping
  source_id?: string
  library_id?: string
  series_identity_key?: string | null

  total_seasons: number
  total_episodes: number
  owned_seasons: number
  owned_episodes: number

  missing_seasons: number[]
  missing_episodes: MissingEpisode[]

  completeness_percentage: number

  // TMDB metadata
  tmdb_id?: string
  poster_url?: string
  backdrop_url?: string
  status?: string // "Returning Series", "Ended", "Canceled"

  created_at: string
  updated_at: string
}

export interface MovieCollection {
  id?: number
  tmdb_collection_id: string
  collection_name: string

  // Source/library scoping
  source_id?: string
  library_id?: string

  total_movies: number
  owned_movies: number

  missing_movies: MissingMovie[]
  owned_movie_ids: string[]

  completeness_percentage: number

  poster_url?: string
  backdrop_url?: string

  created_at: string
  updated_at: string
}

export interface MissingMovie {
  tmdb_id: string
  title: string
  year?: number
  poster_path?: string
  release_date?: string // YYYY-MM-DD theatrical release date from TMDB
}

export interface MissingEpisode {
  season_number: number
  episode_number: number
  title?: string
  air_date?: string
}

// Query filter types
export interface MediaItemFilters {
  type?: 'movie' | 'episode'
  minQualityScore?: number
  maxQualityScore?: number
  needsUpgrade?: boolean
  searchQuery?: string
  limit?: number
  offset?: number
  // Multi-source filters
  sourceId?: string
  sourceType?: ProviderType
  libraryId?: string
  // Sorting
  sortBy?: MediaItemSortField
  sortOrder?: 'asc' | 'desc'
  // Server-side filtering
  alphabetFilter?: string
  qualityTier?: string
  tierQuality?: string
}

// ============================================================================
// TV SHOW TYPES (for show-level pagination)
// ============================================================================

// TV Show summary returned by GROUP BY series_title query
export interface TVShowSummary {
  series_title: string
  episode_count: number
  season_count: number
  poster_url?: string
  source_id?: string
  source_type?: string
  library_id?: string
  series_identity_key?: string
  total_play_count?: number
  last_watched_at?: string
  estimated_savings_bytes?: number | null
  savings_coverage?: SavingsCoverage
}

export interface TVShowFilters {
  sourceId?: string
  libraryId?: string
  alphabetFilter?: string    // 'A'-'Z' or '#' for non-alpha
  searchQuery?: string
  sortBy?: TVShowSortField
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// ============================================================================
// MUSIC TYPES
// ============================================================================

export type MusicQualityTier = 'LOSSY_LOW' | 'LOSSY_MID' | 'LOSSY_HIGH' | 'LOSSLESS' | 'HI_RES' | 'UNKNOWN'
export type AlbumType = 'album' | 'ep' | 'single' | 'compilation' | 'live' | 'soundtrack' | 'unknown'

export interface MusicArtist {
  id?: number
  source_id: string
  source_type: ProviderType
  library_id?: string
  provider_id: string

  name: string
  sort_name?: string

  // Metadata
  musicbrainz_id?: string
  genres?: string // JSON array
  country?: string
  biography?: string

  // Artwork
  thumb_url?: string
  art_url?: string

  // Stats
  album_count?: number
  track_count?: number

  // User override flag
  user_fixed_match?: boolean

  created_at: string
  updated_at: string
}

export interface MusicAlbum {
  id?: number
  source_id: string
  source_type: ProviderType
  library_id?: string
  provider_id: string

  // Artist reference
  artist_id?: number
  artist_name: string

  title: string
  sort_title?: string
  year?: number

  // Metadata
  musicbrainz_id?: string
  musicbrainz_release_group_id?: string
  genres?: string // JSON array
  studio?: string // Record label

  // Album type
  album_type?: AlbumType

  // Quality info
  track_count?: number
  total_duration?: number
  total_size?: number

  // Audio quality (best track)
  best_audio_codec?: string
  best_audio_bitrate?: number
  best_sample_rate?: number
  best_bit_depth?: number

  // Average quality
  avg_audio_bitrate?: number

  // Artwork
  thumb_url?: string
  art_url?: string

  // Timestamps
  release_date?: string
  added_at?: string

  // User override flag
  user_fixed_match?: boolean

  created_at: string
  updated_at: string
}

export interface MusicTrack {
  id?: number
  source_id: string
  source_type: ProviderType
  library_id?: string
  provider_id: string

  // Album and artist references
  album_id?: number
  artist_id?: number
  album_name?: string
  artist_name: string

  title: string

  // Track info
  track_number?: number
  disc_number?: number
  duration?: number // Duration in ms

  // File information
  file_path?: string
  file_size?: number
  container?: string
  file_mtime?: number // File modification time (ms since epoch) for delta scanning

  // Audio quality
  audio_codec: string
  audio_bitrate?: number
  sample_rate?: number
  bit_depth?: number
  channels?: number

  // Quality flags
  is_lossless?: boolean
  is_hi_res?: boolean

  // Metadata
  musicbrainz_id?: string
  genres?: string // JSON array
  mood?: string // JSON array of mood strings

  // Timestamps
  added_at?: string
  created_at: string
  updated_at: string
}

export interface MusicQualityScore {
  id?: number
  album_id: number

  quality_tier: MusicQualityTier
  tier_quality: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
  tier_score: number

  codec_score: number
  bitrate_score: number

  needs_upgrade: boolean

  issues: string // JSON array

  created_at: string
  updated_at: string
}

export interface ArtistCompleteness {
  id?: number
  artist_name: string

  musicbrainz_id?: string

  // Completeness stats
  total_albums: number
  owned_albums: number
  total_singles: number
  owned_singles: number
  total_eps: number
  owned_eps: number

  // Missing items (JSON arrays)
  missing_albums: string
  missing_singles: string
  missing_eps: string

  completeness_percentage: number

  // Metadata
  country?: string
  active_years?: string // JSON: { begin: '1990', end: '2020' }
  artist_type?: string

  thumb_url?: string

  last_sync_at?: string

  created_at: string
  updated_at: string
}

export interface MissingAlbum {
  musicbrainz_id: string
  title: string
  year?: number
  album_type?: AlbumType
}

export interface MissingTrack {
  musicbrainz_id?: string
  title: string
  track_number?: number
  disc_number?: number
  duration_ms?: number
}

export interface AlbumCompleteness {
  id?: number
  album_id: number // Reference to music_albums.id
  artist_name: string
  album_title: string
  musicbrainz_release_id?: string
  musicbrainz_release_group_id?: string

  // Track counts
  total_tracks: number
  owned_tracks: number

  // Missing tracks (JSON array of MissingTrack)
  missing_tracks: string

  completeness_percentage: number

  last_sync_at?: string
  created_at: string
  updated_at: string
}

// Music query filters
export interface MusicFilters {
  artistId?: number
  artistName?: string
  albumId?: number
  qualityTier?: MusicQualityTier
  needsUpgrade?: boolean
  searchQuery?: string
  limit?: number
  offset?: number
  sourceId?: string
  sourceType?: ProviderType
  libraryId?: string
  // Sorting
  sortBy?: 'title' | 'artist' | 'album' | 'codec' | 'duration' | 'added_at' | 'name' | 'year'
  sortOrder?: 'asc' | 'desc'
  // Alphabet filter
  alphabetFilter?: string
  // Album type exclusion filter
  excludeAlbumTypes?: string[]
  // Tag field filter (mood, genre)
  hasTagField?: 'mood' | 'genre'
}

// ============================================================================
// WISHLIST / SHOPPING LIST
// ============================================================================

export const WISHLIST_MEDIA_TYPES = ['movie', 'episode', 'season', 'album', 'track'] as const
export const WISHLIST_REASONS = ['missing', 'upgrade'] as const
export const WISHLIST_STATUSES = ['active', 'completed'] as const

export type WishlistMediaType = typeof WISHLIST_MEDIA_TYPES[number]
export type WishlistPriority = 1 | 2 | 3 | 4 | 5
export type WishlistReason = typeof WISHLIST_REASONS[number]
export type WishlistStatus = typeof WISHLIST_STATUSES[number]

export interface WishlistItem {
  id?: number

  // Item identification
  media_type: WishlistMediaType
  title: string
  subtitle?: string
  year?: number | null

  // Wishlist reason
  reason: WishlistReason

  // External IDs for store linking
  tmdb_id?: string | null
  imdb_id?: string | null
  musicbrainz_id?: string | null

  // Series/Collection context (for TV)
  series_title?: string | null
  season_number?: number | null
  episode_number?: number | null
  collection_name?: string | null

  // Artist context (for music)
  artist_name?: string | null
  album_title?: string | null

  // Artwork
  poster_url?: string | null

  // User data
  priority: WishlistPriority
  notes?: string | null

  // Status tracking
  status: WishlistStatus
  completed_at?: string

  // Upgrade-specific fields (only used when reason='upgrade')
  current_quality_tier?: string | null
  current_quality_level?: string | null
  current_resolution?: string | null
  current_video_codec?: string | null
  current_audio_codec?: string | null
  media_item_id?: number | null

  // Timestamps
  added_at: string
  updated_at: string
}

export interface WishlistFilters {
  media_type?: WishlistMediaType
  priority?: WishlistPriority
  reason?: WishlistReason
  status?: WishlistStatus
  searchQuery?: string
  series_title?: string
  artist_name?: string
  sortBy?: 'added_at' | 'priority' | 'title' | 'year' | 'completed_at'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// ============================================================================
// Task Queue & Optimization Types
// ============================================================================

export enum TaskType {
  LibraryScan = 'library-scan',
  SourceScan = 'source-scan',
  SeriesCompleteness = 'series-completeness',
  CollectionCompleteness = 'collection-completeness',
  MusicCompleteness = 'music-completeness',
  MusicScan = 'music-scan',
  QualityAnalysis = 'quality-analysis',
  MediaAnalysis = 'media-analysis',
  Analysis = 'analysis',
  Transcode = 'transcode',
  OptimizationPreflight = 'optimization-preflight'
}

export enum TaskStatus {
  Queued = 'queued',
  Running = 'running',
  Cancelling = 'cancelling',
  Completed = 'completed',
  Partial = 'partial',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Blocked = 'blocked'
}

export type AnalysisStatus =
  | 'completed'
  | 'partial'
  | 'deferred'
  | 'blocked'
  | 'failed'
  | 'cancelled'

export interface AnalysisDiagnostic {
  itemType: 'artist' | 'album' | 'series' | 'movie' | 'episode' | 'track' | 'collection' | 'library'
  itemId?: string | number
  itemName: string
  stage?: string
  category: 'provider' | 'database' | 'identity' | 'unresolved' | 'cancelled'
  code: string
  message: string
  cause?: string
  provider?: 'musicbrainz' | 'tmdb' | 'imdb'
  identifier?: string
  retryable?: boolean
}

export interface AnalysisOutcome {
  status: AnalysisStatus
  completedCount?: number
  deferredCount: number
  failedCount?: number
  diagnostics: AnalysisDiagnostic[]
  completed?: boolean
  processedCount?: number
  totalCount?: number
  errors?: string[]
}

export interface OptimizationMetricsSummary {
  estimatedSavingsBytes: number | null
  coverage: SavingsCoverage
}

export type { QueuedTask, TaskProgress, TaskQueueState, TaskResult } from './taskQueue'
