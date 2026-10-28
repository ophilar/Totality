/**
 * Zod Validation Schemas
 *
 * Centralized validation schemas for IPC handler inputs.
 * These schemas provide type-safe runtime validation at IPC boundaries.
 */

import { z } from 'zod'
import { PROVIDER_TYPES, WISHLIST_MEDIA_TYPES, WISHLIST_REASONS, WISHLIST_STATUSES } from '../types/database'
import { MEDIA_ITEM_SORT_FIELDS, TV_SHOW_SORT_FIELDS } from '../../shared/librarySortFields'

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

/**
 * Provider types supported by the application
 */
export const ProviderTypeSchema = z.enum(PROVIDER_TYPES)

/**
 * Media types
 */
export const MediaTypeSchema = z.enum(['movie', 'episode'])

/**
 * Quality tier
 */
export const QualityTierSchema = z.enum(['SD', '720p', '1080p', '4K', 'UNKNOWN'])

/**
 * Tier quality level
 */
export const TierQualitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'])

/**
 * Positive integer (for IDs)
 */
export const PositiveIntSchema = z.number().int().positive()

/**
 * Non-negative integer
 */
export const NonNegativeIntSchema = z.number().int().nonnegative()

/**
 * Source ID string
 */
export const SourceIdSchema = z.string().min(1).max(200)

/**
 * Optional source ID string
 */
export const OptionalSourceIdSchema = z.string().min(1).max(200).optional()

/**
 * Library ID string
 */
export const LibraryIdSchema = z.string().min(1).max(200)

/**
 * Non-empty string (for search queries, titles, etc.)
 */
export const NonEmptyStringSchema = z.string().min(1).max(1000)

/**
 * File/folder path string — must be non-empty, reasonable length, no null bytes
 */
export const FilePathSchema = z.string().min(1).max(2000).refine(
  (val) => !val.includes('\0'),
  { message: 'Path must not contain null bytes' }
)

/**
 * Optional provider type for filtering
 */
export const OptionalProviderTypeSchema = ProviderTypeSchema.optional()

/**
 * Setting key
 */
export const SettingKeySchema = z.string().min(1).max(200)

/**
 * Setting value
 */
export const SettingValueSchema = z.string().max(10000)

/**
 * Boolean schema
 */
export const BooleanSchema = z.boolean()

// ============================================================================
// FILTER SCHEMAS (for IPC handlers)
// ============================================================================

/**
 * TV show filter options
 */
export const TVShowFiltersSchema = z.object({
  sourceId: z.string().optional(),
  libraryId: z.string().optional(),
  alphabetFilter: z.string().max(1).optional(),
  searchQuery: z.string().max(500).optional(),
  sortBy: z.enum(TV_SHOW_SORT_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().max(10000).optional(),
  offset: z.number().int().nonnegative().optional(),
}).optional()

/**
 * Music filter options
 */
export const MusicFiltersSchema = z.object({
  artistId: z.number().int().positive().optional(),
  artistName: z.string().max(500).optional(),
  albumId: z.number().int().positive().optional(),
  qualityTier: z.enum(['LOSSY_LOW', 'LOSSY_MID', 'LOSSY_HIGH', 'LOSSLESS', 'HI_RES', 'UNKNOWN']).optional(),
  needsUpgrade: z.boolean().optional(),
  searchQuery: z.string().max(500).optional(),
  limit: z.number().int().positive().max(10000).optional(),
  offset: z.number().int().nonnegative().optional(),
  sourceId: z.string().optional(),
  sourceType: ProviderTypeSchema.optional(),
  libraryId: z.string().optional(),
  sortBy: z.enum(['title', 'artist', 'album', 'codec', 'duration', 'added_at', 'name', 'year']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  alphabetFilter: z.string().max(1).optional(),
}).optional()

/**
 * Wishlist item media types
 */
export const WishlistMediaTypeSchema = z.enum(WISHLIST_MEDIA_TYPES)

/**
 * Wishlist filter options
 */
export const WishlistFiltersSchema = z.object({
  media_type: WishlistMediaTypeSchema.optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  reason: z.enum(WISHLIST_REASONS).optional(),
  status: z.enum(WISHLIST_STATUSES).optional(),
  searchQuery: z.string().max(500).optional(),
  series_title: z.string().max(500).optional(),
  artist_name: z.string().max(500).optional(),
  sortBy: z.enum(['added_at', 'priority', 'title', 'year', 'completed_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().positive().max(10000).optional(),
  offset: z.number().int().nonnegative().optional(),
}).optional()

/**
 * NFS mappings (Record<string, string>)
 */
export const NfsMappingsSchema = z.record(z.string(), z.string())

/**
 * Monitoring config (partial)
 */
export const MonitoringConfigSchema = z.object({
  enabled: z.boolean().optional(),
  startOnLaunch: z.boolean().optional(),
  pauseDuringManualScan: z.boolean().optional(),
  pollingIntervals: z.record(ProviderTypeSchema, z.number().int().positive().optional()).optional(),
}).refine(() => true) // Partial<MonitoringConfig>

/**
 * Task definition for queue
 */
export const TaskDefinitionSchema = z.object({
  type: z.enum(['library-scan', 'source-scan', 'series-completeness', 'collection-completeness', 'music-completeness', 'music-scan']),
  label: z.string().min(1).max(200),
  sourceId: z.string().optional(),
  libraryId: z.string().optional(),
  artistId: z.number().int().positive().optional(),
})

/**
 * CSV export options
 */
export const ExportCSVOptionsSchema = z.object({
  includeUpgrades: z.boolean(),
  includeMissingMovies: z.boolean(),
  includeMissingEpisodes: z.boolean(),
  includeMissingAlbums: z.boolean(),
  includeMusicUpgrades: z.boolean().optional(),
})

/**
 * Store region
 */
export const StoreRegionSchema = z.enum(['us', 'uk', 'ca', 'au', 'de', 'fr', 'it', 'es', 'jp', 'br', 'mx', 'in', 'nl'])

/**
 * Exclusion parameters
 */
export const AddExclusionSchema = z.object({
  exclusionType: z.string().min(1).max(100),
  referenceId: z.number().int().optional(),
  referenceKey: z.string().max(500).optional(),
  parentKey: z.string().max(500).optional(),
  title: z.string().max(500).optional(),
})

// ============================================================================
// SOURCE SCHEMAS
// ============================================================================

/**
 * Schema for adding a new media source
 */
export const AddSourceSchema = z.object({
  sourceType: ProviderTypeSchema,
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long').trim(),
  connectionConfig: z.record(z.string(), z.unknown()),
  isEnabled: z.boolean().optional().default(true),
})

/**
 * Schema for updating a media source
 */
export const UpdateSourceSchema = z.object({
  displayName: z.string().min(1).max(100).trim().optional(),
  connectionConfig: z.record(z.string(), z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
})

// ============================================================================
// AUTHENTICATION SCHEMAS
// ============================================================================

/**
 * Plex authentication with token
 */
export const PlexAuthSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  displayName: z.string().min(1).max(100).trim(),
})

/**
 * Jellyfin/Emby API key authentication
 */
export const JellyfinApiKeyAuthSchema = z.object({
  serverUrl: z.string().url('Invalid server URL'),
  apiKey: z.string().min(1, 'API key is required'),
  displayName: z.string().min(1).max(100).trim(),
})

/**
 * Jellyfin/Emby credentials authentication
 */
export const JellyfinCredentialsAuthSchema = z.object({
  serverUrl: z.string().url('Invalid server URL'),
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().min(1, 'Password is required'),
  displayName: z.string().min(1).max(100).trim(),
  isEmby: z.boolean().optional().default(false),
})

/**
 * Kodi MySQL connection configuration for authentication
 */
export const KodiMySQLConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().max(256),
  displayName: z.string().min(1, 'Display name is required').max(100).trim(),
  videoDatabaseName: z.string().max(100).optional(),
  musicDatabaseName: z.string().max(100).optional(),
  databasePrefix: z.string().max(50).optional(),
  ssl: z.boolean().optional(),
})

/**
 * Kodi MySQL test/detect connection config (no displayName required)
 */
export const KodiMySQLTestConfigSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1, 'Username is required').max(100),
  password: z.string().max(256),
  databasePrefix: z.string().max(50).optional(),
  ssl: z.boolean().optional(),
  connectionTimeout: z.number().int().min(1000).max(60000).optional(),
})

/**
 * Local folder source configuration
 */
export const LocalFolderConfigSchema = z.object({
  folderPath: FilePathSchema,
  displayName: z.string().min(1).max(100).trim(),
  mediaType: z.enum(['movies', 'tvshows', 'mixed']),
})

/**
 * Local folder source with custom library configurations
 */
export const LocalFolderWithLibrariesSchema = z.object({
  folderPath: FilePathSchema,
  displayName: z.string().min(1).max(100).trim(),
  libraries: z.array(z.object({
    name: z.string().min(1).max(200),
    path: FilePathSchema,
    mediaType: z.enum(['movies', 'tvshows', 'music']),
    enabled: z.boolean(),
  })).max(50),
})

// ============================================================================
// MEDIA ITEM SCHEMAS
// ============================================================================

/**
 * Media item for upsert operations
 */
export const MediaItemSchema = z.object({
  id: z.number().int().positive().optional(),
  source_id: z.string().min(1),
  source_type: ProviderTypeSchema,
  library_id: z.string().min(1),
  provider_item_id: z.string().min(1),
  type: MediaTypeSchema,
  title: z.string().min(1).max(500),
  year: z.number().int().min(1800).max(2100).optional().nullable().transform(value => value ?? undefined),
  file_path: z.string().optional().nullable(),
  file_size_bytes: z.number().int().nonnegative().optional().nullable(),
  duration_ms: z.number().int().nonnegative().optional().nullable(),
  resolution: z.string().max(20).optional().nullable(),
  video_codec: z.string().max(50).optional().nullable(),
  video_bitrate_kbps: z.number().nonnegative().optional().nullable(),
  video_frame_rate: z.number().nonnegative().optional().nullable(),
  audio_codec: z.string().max(50).optional().nullable(),
  audio_channels: z.number().int().min(1).max(32).optional().nullable(),
  audio_bitrate_kbps: z.number().nonnegative().optional().nullable(),
  has_object_audio: z.boolean().optional().nullable(),
  hdr_format: z.string().max(50).optional().nullable(),
  container: z.string().max(20).optional().nullable(),
  imdb_id: z.string().max(20).optional().nullable(),
  tmdb_id: z.string().max(20).optional().nullable(),
  poster_url: z.string().url().optional().nullable(),
  series_title: z.string().max(500).optional().nullable(),
  season_number: z.number().int().min(0).optional().nullable(),
  episode_number: z.number().int().min(0).optional().nullable(),
  episode_title: z.string().max(500).optional().nullable(),
  audio_tracks: z.string().optional().nullable(),
  audio_sample_rate: z.number().int().positive().optional().nullable(),
  color_bit_depth: z.number().int().min(8).max(16).optional().nullable(),
  color_space: z.string().max(50).optional().nullable(),
  video_profile: z.string().max(100).optional().nullable(),
  width: z.number().int().positive().optional().nullable(),
  height: z.number().int().positive().optional().nullable(),
  episode_thumb_url: z.string().url().optional().nullable(),
  season_poster_url: z.string().url().optional().nullable(),
  user_fixed_match: z.boolean().optional().nullable(),
}).transform(({ provider_item_id, ...item }) => ({ ...item, plex_id: provider_item_id }))

/**
 * Quality score for upsert operations
 */
export const QualityScoreSchema = z.object({
  id: z.number().int().positive().optional(),
  media_item_id: z.number().int().positive(),
  overall_score: z.number().min(0).max(100).nullable(),
  needs_upgrade: z.boolean(),
  quality_tier: QualityTierSchema,
  tier_quality: TierQualitySchema,
  tier_score: z.number().min(0).max(100).nullable(),
  bitrate_tier_score: z.number().min(0).max(100).nullable(),
  audio_tier_score: z.number().min(0).max(100).nullable(),
  resolution_score: z.number().min(0).max(100).nullable(),
  bitrate_score: z.number().min(0).max(100).nullable(),
  audio_score: z.number().min(0).max(100).nullable(),
  is_low_quality: z.boolean(),
  evidence_status: z.enum(['measured', 'estimated', 'insufficient']).optional(),
  estimated_savings_bytes: z.number().nonnegative().nullable().optional(),
  savings_coverage: z.enum(['complete', 'partial', 'insufficient']),
  confidence: z.enum(['high', 'medium', 'low', 'none']).optional(),
  savings_basis: z.enum(['audio_stream_removal', 'subtitle_stream_removal', 'audio_stream_removal_and_transcode_model', 'audio_transcode_model', 'video_sample_encode', 'video_bitrate_estimate', 'audio_bitrate_estimate', 'mixed_estimates', 'mixed_measured', 'mixed_measured_and_estimated', 'insufficient_data']).optional(),
  issues: z.string(),
})

// ============================================================================
// FILTER SCHEMAS
// ============================================================================

/**
 * Media item filter options
 */
export const MediaItemFiltersSchema = z.object({
  type: MediaTypeSchema.optional(),
  minQualityScore: z.number().min(0).max(100).optional(),
  maxQualityScore: z.number().min(0).max(100).optional(),
  needsUpgrade: z.boolean().optional(),
  searchQuery: z.string().max(500).optional(),
  limit: z.number().int().positive().max(10000).optional(),
  offset: z.number().int().nonnegative().optional(),
  sourceId: z.string().optional(),
  sourceType: ProviderTypeSchema.optional(),
  libraryId: z.string().optional(),
  sortBy: z.enum(MEDIA_ITEM_SORT_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  includeDisabledLibraries: z.boolean().optional(),
  alphabetFilter: z.string().max(1).optional(),
  qualityTier: z.string().optional(),
  tierQuality: z.string().optional(),
})

// ============================================================================
// WISHLIST SCHEMAS
// ============================================================================

/**
 * Wishlist item schema
 */
export const WishlistItemSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1, 'Title is required').max(500).trim(),
  media_type: WishlistMediaTypeSchema,
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().default(3),
  reason: z.enum(WISHLIST_REASONS).optional(),
  status: z.enum(WISHLIST_STATUSES).optional(),
  notes: z.string().max(1000).trim().optional().nullable(),
  year: z.number().int().min(1800).max(2100).optional(),
  series_title: z.string().max(500).optional().nullable(),
  season_number: z.number().int().min(0).optional().nullable(),
  episode_number: z.number().int().min(0).optional().nullable(),
  collection_name: z.string().max(500).optional().nullable(),
  artist_name: z.string().max(500).optional().nullable(),
  album_title: z.string().max(500).optional().nullable(),
  tmdb_id: z.string().max(20).optional().nullable(),
  imdb_id: z.string().max(20).optional().nullable(),
  musicbrainz_id: z.string().max(100).optional().nullable(),
  poster_url: z.string().url().optional().nullable(),
  media_item_id: z.number().int().positive().optional().nullable(),
  current_quality_tier: z.string().max(10).optional().nullable(),
  current_quality_level: z.string().max(10).optional().nullable(),
  current_resolution: z.string().max(20).optional().nullable(),
  current_video_codec: z.string().max(50).optional().nullable(),
  current_audio_codec: z.string().max(50).optional().nullable(),
})

// ============================================================================
// URL VALIDATION
// ============================================================================

/**
 * Safe URL schema (only http/https)
 */
export const SafeUrlSchema = z.string().url().refine(
  (url) => {
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol)
    } catch {
      return false
    }
  },
  { message: 'URL must use http or https protocol' }
)

// ============================================================================
// AI (GEMINI) SCHEMAS
// ============================================================================

export const AiMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(100000),
})

export const AiSendMessageSchema = z.object({
  messages: z.array(AiMessageSchema).min(1),
  system: z.string().max(50000).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
})

export const AiStreamMessageSchema = z.object({
  messages: z.array(AiMessageSchema).min(1),
  system: z.string().max(50000).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
  requestId: z.string().min(1).max(100),
})

export const AiTestApiKeySchema = z.string().min(1).max(500)

// ============================================================================
// LETTER OFFSET SCHEMA
// ============================================================================

export const LetterOffsetSchema = z.object({
  table: z.enum(['movies', 'tvshows', 'artists', 'albums']),
  letter: z.string().min(1).max(1),
  sourceId: z.string().optional(),
  libraryId: z.string().optional(),
})

// ============================================================================
// TRANSCODING SCHEMAS
// ============================================================================

export const TranscodeOptionsSchema = z.object({
  playbackPolicy: z.enum(['allow-transcoding', 'avoid-video-transcoding', 'direct-play']).optional(),
  targetCodec: z.enum(['av1', 'hevc']).optional(),
  outputMode: z.enum(['copy', 'quarantine-replace', 'replace']).optional(),
  tempDirectory: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
  useGpu: z.boolean().optional(),
  encoder: z.string().optional(),
  crf: z.number().min(0).max(51).optional(),
  preset: z.string().optional(),
  customArgs: z.string().optional(),
  gpuId: z.string().optional(),
  transcodingEngine: z.literal('ffmpeg').optional(),
  optimizationMode: z.enum(['smart', 'remux_only', 'transcode']).optional(),
  qualityProfile: z.enum(['transparent', 'balanced', 'maximum_savings']).optional(),
  encoderPolicy: z.enum(['automatic', 'hardware', 'software', 'compare']).optional(),
  targetProfileId: z.string().min(1).nullable().optional(),
  targetContainer: z.enum(['mkv', 'mp4']).optional(),
  targetContainerSelection: z.enum(['automatic', 'user-selected']).optional(),
  targetAudioCodec: z.enum(['aac', 'ac3', 'eac3']).optional(),
  targetHdrFormat: z.enum(['SDR', 'HDR10']).optional(),
  streamSelection: z.union([
    z.object({
      audio: z.literal('all'),
      subtitle: z.literal('all'),
      subtitleLanguageWhitelist: z.array(z.string()).optional(),
      defaultSubtitle: z.union([z.literal('preserve'), z.literal('none'), z.object({ language: z.string().min(1).optional(), forced: z.boolean().optional(), hearingImpaired: z.boolean().optional(), title: z.string().min(1).optional() })]).optional()
    }),
    z.object({
      audio: z.literal('original-and-protected'),
      originalLanguage: z.string().min(1),
      subtitle: z.literal('all'),
      subtitleLanguageWhitelist: z.array(z.string()).optional(),
      defaultSubtitle: z.union([z.literal('preserve'), z.literal('none'), z.object({ language: z.string().min(1).optional(), forced: z.boolean().optional(), hearingImpaired: z.boolean().optional(), title: z.string().min(1).optional() })]).optional()
    })
  ]).optional(),
  targetSize: z.string().optional(),
  maxOutputBytes: z.number().int().positive().optional(),
}).optional()

export const SetSelectedGpuSchema = z.string().min(1).max(200).nullable()

export const CheckTranscoderAvailabilitySchema = z.unknown().optional()

export const GetTranscodeParamsSchema = z.tuple([
  FilePathSchema,
  TranscodeOptionsSchema
])
export const GetTranscodeParamsByMediaItemSchema = z.tuple([
  z.number().int().positive(),
  TranscodeOptionsSchema
])

export const TranscodeMediaItemSchema = z.tuple([
  z.number().int().positive(),
  TranscodeOptionsSchema
])

export const CancelTranscodeSchema = z.tuple([
  z.number().int().positive()
])

export const PreflightShowTranscodeSchema = z.tuple([
  z.object({
    requestId: z.string().min(1).max(100),
    mediaItemId: z.number().int().positive().optional(),
    seasonNumber: z.number().int().nonnegative().optional(),
    representativeMediaItemId: z.number().int().positive().optional(),
    seriesTitle: z.string().min(1).optional(),
    seriesIdentityKey: z.string().min(1).optional(),
    sourceId: z.string().min(1),
    libraryId: z.string().min(1).optional(),
    options: TranscodeOptionsSchema.unwrap()
  }).refine(request => request.mediaItemId === undefined || request.seasonNumber === undefined, {
    message: 'An optimization preflight can target an episode or a season, not both.'
  }).refine(request => request.options.outputMode !== undefined, {
    message: 'Select output handling before preparing an optimization review.',
    path: ['options', 'outputMode'],
  })
])

export const QueueShowTranscodeSchema = z.tuple([z.string().min(1)])

export const ShowQuarantineSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1).optional()
])

function preprocessFilterKeys(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const clone: Record<string, unknown> = { ...input }
  if ('tier' in clone && !('qualityTier' in clone)) {
    clone.qualityTier = clone.tier
    delete clone.tier
  }
  if ('quality' in clone && !('tierQuality' in clone)) {
    clone.tierQuality = clone.quality
    delete clone.quality
  }
  if ('alphabet' in clone && !('alphabetFilter' in clone)) {
    clone.alphabetFilter = clone.alphabet
    delete clone.alphabet
  }
  if ('search' in clone && !('searchQuery' in clone)) {
    clone.searchQuery = clone.search
    delete clone.search
  }
  return clone
}

/**
 * Validate and parse input, throwing a descriptive error on failure
 */
export function validateInput<T>(schema: z.ZodSchema<T>, input: unknown, context?: string): T {
  const preprocessed = preprocessFilterKeys(input)
  const result = schema.safeParse(preprocessed)
  if (!result.success) {
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
    throw new Error(`${context ? `[${context}] ` : ''}Validation failed: ${errors}`)
  }
  return result.data
}

/**
 * Safely validate input, returning null on failure instead of throwing
 */
export function safeValidateInput<T>(schema: z.ZodSchema<T>, input: unknown): T | null {
  const preprocessed = preprocessFilterKeys(input)
  const result = schema.safeParse(preprocessed)
  return result.success ? result.data : null
}

// ============================================================================
// IPC TUPLE SCHEMAS (Multi-argument handlers)
// ============================================================================

export const UpdateSourceTupleSchema = z.tuple([SourceIdSchema, UpdateSourceSchema])
export const ToggleSourceTupleSchema = z.tuple([SourceIdSchema, BooleanSchema])
export const ToggleLibraryTupleSchema = z.tuple([SourceIdSchema, SourceIdSchema, BooleanSchema])
export const ScanLibraryTupleSchema = z.tuple([SourceIdSchema, SourceIdSchema])
export const ScanItemTupleSchema = z.tuple([SourceIdSchema, z.string().nullable(), FilePathSchema])
export const PlexAuthTupleSchema = z.tuple([z.string(), z.string()])
export const PlexSelectServerTupleSchema = z.tuple([SourceIdSchema, z.string()])
export const SetSettingTupleSchema = z.tuple([SettingKeySchema, SettingValueSchema])
export const TestNfsMappingTupleSchema = z.tuple([z.unknown(), FilePathSchema])
export const FixMatchTupleSchema = z.tuple([PositiveIntSchema, NonEmptyStringSchema, NonEmptyStringSchema])
export const AddExclusionTupleSchema = z.tuple([z.string(), PositiveIntSchema.optional(), z.string().optional(), z.string().optional(), z.string().optional()])
export const GetExclusionsTupleSchema = z.tuple([z.string().optional(), z.string().optional()])
export const FixArtistMatchTupleSchema = z.tuple([PositiveIntSchema, NonEmptyStringSchema])
export const SearchMbReleaseTupleSchema = z.tuple([NonEmptyStringSchema, NonEmptyStringSchema])
export const FixAlbumMatchTupleSchema = z.tuple([PositiveIntSchema, NonEmptyStringSchema])
export const MbSearchTupleSchema = z.tuple([z.string(), z.enum(['artist', 'release', 'recording', 'release-group'])])
export const SeriesAnalyzeAllTupleSchema = z.tuple([z.string().optional(), z.string().optional()])
export const SeriesGetEpisodesTupleSchema = z.tuple([NonEmptyStringSchema, z.string().optional()])
export const SeriesGetSeasonDetailsTupleSchema = z.tuple([NonEmptyStringSchema, z.number().int().nonnegative()])
export const CanonicalSeriesIdentityKeySchema = z.string().min(1).refine(
  (key) => key.startsWith('tmdb:') || key.startsWith('tvdb:') || key.startsWith('unresolved:'),
  { message: 'seriesIdentityKey must be a canonical key starting with tmdb:, tvdb:, or unresolved:' }
)
export const SeriesFixMatchTupleSchema = z.tuple([CanonicalSeriesIdentityKeySchema, NonEmptyStringSchema, z.string().optional().nullable(), PositiveIntSchema])
export const SeriesIdentityTupleSchema = z.tuple([NonEmptyStringSchema, SourceIdSchema, NonEmptyStringSchema, LibraryIdSchema])
export const JellyfinQcStatusTupleSchema = z.tuple([z.string().url(), z.string()])
export const JellyfinQcCompleteTupleSchema = z.tuple([z.string().url(), z.string(), NonEmptyStringSchema])
export const JellyfinAuthCredentialsTupleSchema = z.tuple([z.string().url(), z.string(), z.string(), NonEmptyStringSchema, z.boolean().optional()])
