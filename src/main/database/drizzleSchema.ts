import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// --- Media Sources ---
export const mediaSources = sqliteTable('media_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull().unique(),
  sourceType: text('source_type').notNull(), // CHECK constraint handled at runtime/Zod
  displayName: text('display_name').notNull(),
  connectionConfig: text('connection_config').notNull(),
  isEnabled: integer('is_enabled').notNull(),
  lastConnectedAt: text('last_connected_at'),
  lastScanAt: text('last_scan_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Media Items ---
export const mediaItems = sqliteTable('media_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull(),
  sourceType: text('source_type').notNull(),
  libraryId: text('library_id'),
  plexId: text('plex_id').notNull(),
  title: text('title').notNull(),
  sortTitle: text('sort_title'),
  year: integer('year'),
  type: text('type').notNull(), // 'movie' | 'episode'
  seriesTitle: text('series_title'),
  seasonNumber: integer('season_number'),
  episodeNumber: integer('episode_number'),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size').notNull(),
  duration: integer('duration').notNull(),
  resolution: text('resolution').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  videoCodec: text('video_codec').notNull(),
  videoBitrate: integer('video_bitrate').notNull(),
  audioCodec: text('audio_codec').notNull(),
  audioChannels: integer('audio_channels').notNull(),
  audioBitrate: integer('audio_bitrate').notNull(),
  videoFrameRate: real('video_frame_rate'),
  colorBitDepth: integer('color_bit_depth'),
  hdrFormat: text('hdr_format'),
  colorSpace: text('color_space'),
  videoProfile: text('video_profile'),
  videoLevel: integer('video_level'),
  audioProfile: text('audio_profile'),
  audioSampleRate: integer('audio_sample_rate'),
  hasObjectAudio: integer('has_object_audio'),
  audioTracks: text('audio_tracks'), // JSON
  subtitleTracks: text('subtitle_tracks'), // JSON
  container: text('container'),
  versionCount: integer('version_count').notNull(),
  fileMtime: integer('file_mtime'),
  imdbId: text('imdb_id'),
  tmdbId: text('tmdb_id'),
  seriesTmdbId: text('series_tmdb_id'),
  originalLanguage: text('original_language'),
  audioLanguage: text('audio_language'),
  posterUrl: text('poster_url'),
  episodeThumbUrl: text('episode_thumb_url'),
  seasonPosterUrl: text('season_poster_url'),
  summary: text('summary'),
  userFixedMatch: integer('user_fixed_match'),
  qualityTier: text('quality_tier'),
  tierQuality: text('tier_quality'),
  tierScore: integer('tier_score'),
  bitrateTierScore: integer('bitrate_tier_score'),
  audioTierScore: integer('audio_tier_score'),
  efficiencyScore: integer('efficiency_score'),
  storageDebtBytes: integer('storage_debt_bytes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  sourceProviderIdx: uniqueIndex('idx_media_items_source_provider_id').on(table.sourceId, table.plexId),
  typeIdx: index('idx_media_items_type').on(table.type),
  sourceIdx: index('idx_media_items_source').on(table.sourceId),
  libraryIdx: index('idx_media_items_library').on(table.sourceId, table.libraryId),
  seriesIdx: index('idx_media_items_series').on(table.seriesTitle),
}));

// --- Media Item Versions ---
export const mediaItemVersions = sqliteTable('media_item_versions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaItemId: integer('media_item_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  versionSource: text('version_source').notNull(),
  edition: text('edition'),
  label: text('label'),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size').notNull(),
  duration: integer('duration').notNull(),
  resolution: text('resolution').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  videoCodec: text('video_codec').notNull(),
  videoBitrate: integer('video_bitrate').notNull(),
  audioCodec: text('audio_codec').notNull(),
  audioChannels: integer('audio_channels').notNull(),
  audioBitrate: integer('audio_bitrate').notNull(),
  videoFrameRate: real('video_frame_rate'),
  colorBitDepth: integer('color_bit_depth'),
  hdrFormat: text('hdr_format'),
  colorSpace: text('color_space'),
  videoProfile: text('video_profile'),
  videoLevel: integer('video_level'),
  audioProfile: text('audio_profile'),
  audioSampleRate: integer('audio_sample_rate'),
  hasObjectAudio: integer('has_object_audio'),
  audioTracks: text('audio_tracks'), // JSON
  subtitleTracks: text('subtitle_tracks'), // JSON
  container: text('container'),
  fileMtime: integer('file_mtime'),
  qualityTier: text('quality_tier'),
  tierQuality: text('tier_quality'),
  tierScore: integer('tier_score'),
  bitrateTierScore: integer('bitrate_tier_score'),
  audioTierScore: integer('audio_tier_score'),
  efficiencyScore: integer('efficiency_score'),
  storageDebtBytes: integer('storage_debt_bytes'),
  originalLanguage: text('original_language'),
  audioLanguage: text('audio_language'),
  isBest: integer('is_best').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  mediaItemIdx: index('idx_versions_media_item').on(table.mediaItemId),
  uniqueFileIdx: uniqueIndex('idx_versions_unique_file').on(table.mediaItemId, table.filePath),
}));

// --- Quality Scores ---
export const qualityScores = sqliteTable('quality_scores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaItemId: integer('media_item_id').notNull().unique().references(() => mediaItems.id, { onDelete: 'cascade' }),
  qualityTier: text('quality_tier').notNull(),
  tierQuality: text('tier_quality').notNull(),
  tierScore: integer('tier_score').notNull(),
  bitrateTierScore: integer('bitrate_tier_score').notNull(),
  audioTierScore: integer('audio_tier_score').notNull(),
  overallScore: integer('overall_score').notNull(),
  resolutionScore: integer('resolution_score').notNull(),
  bitrateScore: integer('bitrate_score').notNull(),
  audioScore: integer('audio_score').notNull(),
  efficiencyScore: integer('efficiency_score'),
  storageDebtBytes: integer('storage_debt_bytes'),
  isLowQuality: integer('is_low_quality').notNull(),
  needsUpgrade: integer('needs_upgrade').notNull(),
  issues: text('issues').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Settings ---
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- TV Completeness ---
export const seriesCompleteness = sqliteTable('series_completeness', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seriesTitle: text('series_title').notNull(),
  sourceId: text('source_id').notNull(),
  libraryId: text('library_id').notNull(),
  totalSeasons: integer('total_seasons').notNull(),
  totalEpisodes: integer('total_episodes').notNull(),
  ownedSeasons: integer('owned_seasons').notNull(),
  ownedEpisodes: integer('owned_episodes').notNull(),
  missingSeasons: text('missing_seasons').notNull(),
  missingEpisodes: text('missing_episodes').notNull(),
  completenessPercentage: real('completeness_percentage').notNull(),
  tmdbId: text('tmdb_id'),
  posterUrl: text('poster_url'),
  backdropUrl: text('backdrop_url'),
  status: text('status'),
  efficiencyScore: integer('efficiency_score'),
  storageDebtBytes: integer('storage_debt_bytes'),
  totalSize: integer('total_size'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_series_completeness_unique').on(table.seriesTitle, table.sourceId, table.libraryId),
}));

// --- Movie Collections ---
export const movieCollections = sqliteTable('movie_collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbCollectionId: text('tmdb_collection_id').notNull(),
  collectionName: text('collection_name').notNull(),
  sourceId: text('source_id').notNull(),
  libraryId: text('library_id').notNull(),
  totalMovies: integer('total_movies').notNull(),
  ownedMovies: integer('owned_movies').notNull(),
  missingMovies: text('missing_movies').notNull(),
  ownedMovieIds: text('owned_movie_ids').notNull(),
  completenessPercentage: real('completeness_percentage').notNull(),
  posterUrl: text('poster_url'),
  backdropUrl: text('backdrop_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_movie_collections_unique').on(table.tmdbCollectionId, table.sourceId, table.libraryId),
}));

// --- Media Item Collections ---
export const mediaItemCollections = sqliteTable('media_item_collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaItemId: integer('media_item_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  collectionId: integer('collection_id').notNull().references(() => movieCollections.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_media_item_collections_unique').on(table.mediaItemId, table.collectionId),
}));

// --- Music Artists ---
export const musicArtists = sqliteTable('music_artists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull(),
  sourceType: text('source_type').notNull(),
  libraryId: text('library_id'),
  providerId: text('provider_id').notNull(),
  name: text('name').notNull(),
  sortName: text('sort_name'),
  musicbrainzId: text('musicbrainz_id'),
  genres: text('genres'), // JSON
  mood: text('mood'), // JSON
  country: text('country'),
  biography: text('biography'),
  thumbUrl: text('thumb_url'),
  artUrl: text('art_url'),
  userFixedMatch: integer('user_fixed_match'),
  albumCount: integer('album_count'),
  trackCount: integer('track_count'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_music_artists_source_provider').on(table.sourceId, table.providerId),
}));

// --- Music Albums ---
export const musicAlbums = sqliteTable('music_albums', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull(),
  sourceType: text('source_type').notNull(),
  libraryId: text('library_id'),
  providerId: text('provider_id').notNull(),
  artistId: integer('artist_id').references(() => musicArtists.id, { onDelete: 'set null' }),
  artistName: text('artist_name').notNull(),
  title: text('title').notNull(),
  sortTitle: text('sort_title'),
  year: integer('year'),
  musicbrainzId: text('musicbrainz_id'),
  musicbrainzReleaseGroupId: text('musicbrainz_release_group_id'),
  genres: text('genres'), // JSON
  mood: text('mood'), // JSON
  studio: text('studio'),
  albumType: text('album_type'),
  trackCount: integer('track_count'),
  totalDuration: integer('total_duration'),
  totalSize: integer('total_size'),
  bestAudioCodec: text('best_audio_codec'),
  bestAudioBitrate: integer('best_audio_bitrate'),
  bestSampleRate: integer('best_sample_rate'),
  bestBitDepth: integer('best_bit_depth'),
  avgAudioBitrate: integer('avg_audio_bitrate'),
  thumbUrl: text('thumb_url'),
  artUrl: text('art_url'),
  userFixedMatch: integer('user_fixed_match'),
  releaseDate: text('release_date'),
  addedAt: text('added_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_music_albums_source_provider').on(table.sourceId, table.providerId),
}));

// --- Music Tracks ---
export const musicTracks = sqliteTable('music_tracks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull(),
  sourceType: text('source_type').notNull(),
  libraryId: text('library_id'),
  providerId: text('provider_id').notNull(),
  albumId: integer('album_id').references(() => musicAlbums.id, { onDelete: 'set null' }),
  artistId: integer('artist_id').references(() => musicArtists.id, { onDelete: 'set null' }),
  albumName: text('album_name'),
  artistName: text('artist_name').notNull(),
  title: text('title').notNull(),
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number'),
  duration: integer('duration'),
  filePath: text('file_path'),
  fileSize: integer('file_size'),
  container: text('container'),
  fileMtime: integer('file_mtime'),
  audioCodec: text('audio_codec').notNull(),
  audioBitrate: integer('audio_bitrate'),
  sampleRate: integer('sample_rate'),
  bitDepth: integer('bit_depth'),
  channels: integer('channels'),
  isLossless: integer('is_lossless'),
  isHiRes: integer('is_hi_res'),
  musicbrainzId: text('musicbrainz_id'),
  genres: text('genres'), // JSON
  mood: text('mood'), // JSON
  addedAt: text('added_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_music_tracks_source_provider').on(table.sourceId, table.providerId),
}));

// --- Music Quality Scores ---
export const musicQualityScores = sqliteTable('music_quality_scores', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  albumId: integer('album_id').notNull().unique().references(() => musicAlbums.id, { onDelete: 'cascade' }),
  qualityTier: text('quality_tier').notNull(),
  tierQuality: text('tier_quality').notNull(),
  tierScore: integer('tier_score').notNull(),
  codecScore: integer('codec_score').notNull(),
  bitrateScore: integer('bitrate_score').notNull(),
  efficiencyScore: integer('efficiency_score'),
  storageDebtBytes: integer('storage_debt_bytes'),
  needsUpgrade: integer('needs_upgrade').notNull(),
  issues: text('issues').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Artist Completeness ---
export const artistCompleteness = sqliteTable('artist_completeness', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  artistName: text('artist_name').notNull().unique(),
  musicbrainzId: text('musicbrainz_id'),
  libraryId: text('library_id').notNull(),
  totalAlbums: integer('total_albums').notNull(),
  ownedAlbums: integer('owned_albums').notNull(),
  totalSingles: integer('total_singles').notNull(),
  ownedSingles: integer('owned_singles').notNull(),
  totalEps: integer('total_eps').notNull(),
  ownedEps: integer('owned_eps').notNull(),
  missingAlbums: text('missing_albums').notNull(),
  missingSingles: text('missing_singles').notNull(),
  missingEps: text('missing_eps').notNull(),
  completenessPercentage: real('completeness_percentage').notNull(),
  country: text('country'),
  activeYears: text('active_years'), // JSON
  artistType: text('artist_type'),
  thumbUrl: text('thumb_url'),
  efficiencyScore: integer('efficiency_score'),
  storageDebtBytes: integer('storage_debt_bytes'),
  totalSize: integer('total_size'),
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Album Completeness ---
export const albumCompleteness = sqliteTable('album_completeness', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  albumId: integer('album_id').notNull().unique().references(() => musicAlbums.id, { onDelete: 'cascade' }),
  artistName: text('artist_name').notNull(),
  albumTitle: text('album_title').notNull(),
  musicbrainzReleaseId: text('musicbrainz_release_id'),
  musicbrainzReleaseGroupId: text('musicbrainz_release_group_id'),
  totalTracks: integer('total_tracks').notNull(),
  ownedTracks: integer('owned_tracks').notNull(),
  missingTracks: text('missing_tracks').notNull(),
  completenessPercentage: real('completeness_percentage').notNull(),
  efficiencyScore: integer('efficiency_score'),
  storageDebtBytes: integer('storage_debt_bytes'),
  totalSize: integer('total_size'),
  lastSyncAt: text('last_sync_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Wishlist Items ---
export const wishlistItems = sqliteTable('wishlist_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaType: text('media_type').notNull(), // 'movie' | 'episode' | 'season' | 'album' | 'track'
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  year: integer('year'),
  reason: text('reason').notNull(), // 'missing' | 'upgrade'
  tmdbId: text('tmdb_id'),
  imdbId: text('imdb_id'),
  musicbrainzId: text('musicbrainz_id'),
  seriesTitle: text('series_title'),
  seasonNumber: integer('season_number'),
  episodeNumber: integer('episode_number'),
  collectionName: text('collection_name'),
  artistName: text('artist_name'),
  albumTitle: text('album_title'),
  posterUrl: text('poster_url'),
  priority: integer('priority').notNull(),
  notes: text('notes'),
  status: text('status').notNull(), // 'active' | 'completed'
  completedAt: text('completed_at'),
  currentQualityTier: text('current_quality_tier'),
  currentQualityLevel: text('current_quality_level'),
  currentResolution: text('current_resolution'),
  currentVideoCodec: text('current_video_codec'),
  currentAudioCodec: text('current_audio_codec'),
  mediaItemId: integer('media_item_id'),
  addedAt: text('added_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// --- Library Scans ---
export const libraryScans = sqliteTable('library_scans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull(),
  libraryId: text('library_id').notNull(),
  libraryName: text('library_name').notNull(),
  libraryType: text('library_type').notNull(),
  lastScanAt: text('last_scan_at'),
  itemsScanned: integer('items_scanned'),
  isEnabled: integer('is_enabled').notNull(),
  isProtected: integer('is_protected').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_library_scans_unique').on(table.sourceId, table.libraryId),
}));

// --- Media Item Duplicates ---
export const mediaItemDuplicates = sqliteTable('media_item_duplicates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id').notNull(),
  externalId: text('external_id').notNull(),
  externalType: text('external_type').notNull(),
  mediaItemIds: text('media_item_ids').notNull(), // JSON array
  status: text('status').notNull(),
  resolutionStrategy: text('resolution_strategy'),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('idx_media_item_duplicates_unique').on(table.sourceId, table.externalId, table.externalType),
}));

// --- Notifications ---
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  referenceId: text('reference_id'),
  sourceId: text('source_id'),
  sourceName: text('source_name'),
  itemCount: integer('item_count'),
  metadata: text('metadata'),
  isRead: integer('is_read').notNull(),
  createdAt: text('created_at').notNull(),
  readAt: text('read_at'),
});

// --- Exclusions ---
export const exclusions = sqliteTable('exclusions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  exclusionType: text('exclusion_type').notNull(),
  referenceId: integer('reference_id'),
  referenceKey: text('reference_key'),
  parentKey: text('parent_key'),
  title: text('title'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  typeRefIdx: index('idx_exclusions_type_ref').on(table.exclusionType, table.referenceId),
  typeKeyIdx: index('idx_exclusions_type_key').on(table.exclusionType, table.referenceKey, table.parentKey),
}));

// --- Task History ---
export const taskHistory = sqliteTable('task_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull(),
  type: text('type').notNull(),
  label: text('label').notNull(),
  sourceId: text('source_id'),
  libraryId: text('library_id'),
  status: text('status').notNull(),
  error: text('error'),
  result: text('result'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  durationMs: integer('duration_ms'),
  recordedAt: text('recorded_at').notNull(),
});

// --- Activity Log ---
export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entryType: text('entry_type').notNull(),
  message: text('message').notNull(),
  taskId: text('task_id'),
  taskType: text('task_type'),
  createdAt: text('created_at').notNull(),
});
