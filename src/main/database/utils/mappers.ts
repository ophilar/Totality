import type { MediaItem, QualityScore } from '@main/types/database'
import { getMediaMatchStatus } from '@main/services/SeriesIdentityService'

type MapperValue = string | number | boolean | null | undefined
interface MapperFields { [key: string]: MapperValue | MapperFields }

function asMapperFields(value: unknown): MapperFields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Database mapper input must be an object')
  }
  return value as MapperFields
}

/**
 * Maps a Drizzle model or SQLite database row representing a MediaItem 
 * (plus optionally its QualityScore) to the standard snake_case contract.
 */
export function toSnakeCaseMediaItem(r: unknown, q?: unknown): MediaItem {
  const source = asMapperFields(r)
  const item = asMapperFields(source.item || source)
  const quality = asMapperFields(q || source.quality || source.q || {})
  
  const canonicalIds = [item.tmdbId || item.tmdb_id, item.imdbId || item.imdb_id].filter((value): value is string => Boolean(value))
  return {
    ...item,
    id: item.id,
    title: item.title,
    year: item.year,
    resolution: item.resolution,
    source_id: item.sourceId || item.source_id,
    source_type: item.sourceType || item.source_type,
    library_id: item.libraryId || item.library_id,
    plex_id: item.plexId || item.plex_id,
    sort_title: item.sortTitle || item.sort_title,
    series_title: item.seriesTitle || item.series_title,
    series_identity_key: item.seriesIdentityKey || item.series_identity_key,
    season_number: item.seasonNumber !== undefined ? item.seasonNumber : item.season_number,
    episode_number: item.episodeNumber !== undefined ? item.episodeNumber : item.episode_number,
    file_path: item.filePath || item.file_path,
    file_size: item.fileSize !== undefined ? item.fileSize : item.file_size,
    video_codec: item.videoCodec || item.video_codec,
    video_bitrate: item.videoBitrate !== undefined ? item.videoBitrate : item.video_bitrate,
    audio_codec: item.audioCodec || item.audio_codec,
    audio_channels: item.audioChannels !== undefined ? item.audioChannels : item.audio_channels,
    audio_bitrate: item.audioBitrate !== undefined ? item.audioBitrate : item.audio_bitrate,
    video_frame_rate: item.videoFrameRate || item.video_frame_rate,
    color_bit_depth: item.colorBitDepth !== undefined ? item.colorBitDepth : item.color_bit_depth,
    hdr_format: item.hdrFormat || item.hdr_format,
    color_space: item.colorSpace || item.color_space,
    video_profile: item.videoProfile || item.video_profile,
    video_level: item.videoLevel || item.video_level,
    audio_profile: item.audioProfile || item.audio_profile,
    audio_sample_rate: item.audioSampleRate !== undefined ? item.audioSampleRate : item.audio_sample_rate,
    has_object_audio: item.hasObjectAudio === 1 || item.has_object_audio === 1 || item.hasObjectAudio === true || item.has_object_audio === true,
    audio_tracks: item.audioTracks || item.audio_tracks,
    subtitle_tracks: item.subtitleTracks || item.subtitle_tracks,
    version_count: item.versionCount !== undefined ? item.versionCount : item.version_count,
    file_mtime: item.fileMtime !== undefined ? item.fileMtime : item.file_mtime,
    imdb_id: item.imdbId || item.imdb_id,
    tmdb_id: item.tmdbId || item.tmdb_id,
    series_tmdb_id: item.seriesTmdbId || item.series_tmdb_id,
    original_language: item.originalLanguage || item.original_language,
    audio_language: item.audioLanguage || item.audio_language,
    poster_url: item.posterUrl || item.poster_url,
    episode_thumb_url: item.episodeThumbUrl || item.episode_thumb_url,
    season_poster_url: item.seasonPosterUrl || item.season_poster_url,
    user_fixed_match: item.userFixedMatch === 1 || item.user_fixed_match === 1 || item.userFixedMatch === true || item.user_fixed_match === true,
    match_status: getMediaMatchStatus({ locked: item.userFixedMatch === 1 || item.user_fixed_match === 1 || item.userFixedMatch === true || item.user_fixed_match === true, canonicalIds, conflictingEntityIds: [] }),
    
    // Quality relation parameters
    quality_tier: quality.qualityTier || item.qualityTier || quality.quality_tier || item.quality_tier,
    tier_quality: quality.tierQuality || item.tierQuality || quality.tier_quality || item.tier_quality,
    tier_score: quality.tierScore || item.tierScore || quality.tier_score || item.tier_score,
    overall_score: quality.overallScore || quality.overall_score,
    needs_upgrade: quality.needsUpgrade === 1 || quality.needsUpgrade === true || quality.needs_upgrade === 1 || quality.needs_upgrade === true || item.needsUpgrade === 1 || item.needsUpgrade === true,
    is_low_quality: quality.isLowQuality === 1 || quality.isLowQuality === true || quality.is_low_quality === 1 || quality.is_low_quality === true,
    efficiency_score: quality.efficiencyScore !== undefined ? quality.efficiencyScore : (quality.efficiency_score !== undefined ? quality.efficiency_score : (item.efficiencyScore !== undefined ? item.efficiencyScore : item.efficiency_score)),
    storage_debt_bytes: quality.storageDebtBytes !== undefined ? quality.storageDebtBytes : (quality.storage_debt_bytes !== undefined ? quality.storage_debt_bytes : (item.storageDebtBytes !== undefined ? item.storageDebtBytes : item.storage_debt_bytes)),
    issues: quality.issues || item.issues,
    
    created_at: item.createdAt || item.created_at,
    updated_at: item.updatedAt || item.updated_at
  } as unknown as MediaItem
}

/**
 * Maps a Drizzle model or SQLite database row representing a QualityScore
 * to the standard snake_case contract.
 */
export function toSnakeCaseQualityScore(r: unknown): QualityScore {
  const row = asMapperFields(r)
  return {
    id: row.id as number,
    media_item_id: row.mediaItemId || row.media_item_id as number,
    quality_tier: row.qualityTier || row.quality_tier as string,
    tier_quality: row.tierQuality || row.tier_quality as string,
    tier_score: row.tierScore || row.tier_score as number,
    bitrate_tier_score: row.bitrateTierScore || row.bitrate_tier_score as number,
    audio_tier_score: row.audioTierScore || row.audio_tier_score as number,
    overall_score: row.overallScore || row.overall_score as number,
    resolution_score: row.resolutionScore || row.resolution_score as number,
    bitrate_score: row.bitrateScore || row.bitrate_score as number,
    audio_score: row.audioScore || row.audio_score as number,
    efficiency_score: row.efficiencyScore !== undefined ? row.efficiencyScore as number : row.efficiency_score as number,
    storage_debt_bytes: row.storageDebtBytes !== undefined ? row.storageDebtBytes as number : row.storage_debt_bytes as number,
    is_low_quality: row.isLowQuality === 1 || row.isLowQuality === true || row.is_low_quality === 1 || row.is_low_quality === true,
    needs_upgrade: row.needsUpgrade === 1 || row.needsUpgrade === true || row.needs_upgrade === 1 || row.needs_upgrade === true,
    issues: row.issues as string,
    created_at: row.createdAt || row.created_at as string,
    updated_at: row.updatedAt || row.updated_at as string
  } as QualityScore
}

/**
 * Maps a Drizzle model or SQLite database row representing ArtistCompleteness
 * to the standard snake_case contract.
 */
export function toSnakeCaseArtistCompleteness(r: unknown): import('@main/types/database').ArtistCompleteness {
  const source = asMapperFields(r)
  const a = asMapperFields(source.artist || source)
  return {
    id: a.id !== undefined ? Number(a.id) : undefined,
    artist_name: String(a.artistName || a.artist_name || ''),
    musicbrainz_id: a.musicbrainzId ? String(a.musicbrainzId) : (a.musicbrainz_id ? String(a.musicbrainz_id) : undefined),
    library_id: a.libraryId ? String(a.libraryId) : (a.library_id ? String(a.library_id) : undefined),
    total_albums: Number(a.totalAlbums !== undefined ? a.totalAlbums : (a.total_albums || 0)),
    owned_albums: Number(a.ownedAlbums !== undefined ? a.ownedAlbums : (a.owned_albums || 0)),
    total_singles: Number(a.totalSingles !== undefined ? a.totalSingles : (a.total_singles || 0)),
    owned_singles: Number(a.ownedSingles !== undefined ? a.ownedSingles : (a.owned_singles || 0)),
    total_eps: Number(a.totalEps !== undefined ? a.totalEps : (a.total_eps || 0)),
    owned_eps: Number(a.ownedEps !== undefined ? a.ownedEps : (a.owned_eps || 0)),
    missing_albums: typeof a.missingAlbums === 'string' ? a.missingAlbums : (typeof a.missing_albums === 'string' ? a.missing_albums : '[]'),
    missing_singles: typeof a.missingSingles === 'string' ? a.missingSingles : (typeof a.missing_singles === 'string' ? a.missing_singles : '[]'),
    missing_eps: typeof a.missingEps === 'string' ? a.missingEps : (typeof a.missing_eps === 'string' ? a.missing_eps : '[]'),
    completeness_percentage: Number(a.completenessPercentage !== undefined ? a.completenessPercentage : (a.completeness_percentage || 0)),
    efficiency_score: a.efficiencyScore !== undefined ? Number(a.efficiencyScore) : (a.efficiency_score !== undefined ? Number(a.efficiency_score) : undefined),
    storage_debt_bytes: a.storageDebtBytes !== undefined ? Number(a.storageDebtBytes) : (a.storage_debt_bytes !== undefined ? Number(a.storage_debt_bytes) : undefined),
    total_size: a.totalSize !== undefined ? Number(a.totalSize) : (a.total_size !== undefined ? Number(a.total_size) : undefined),
    country: a.country ? String(a.country) : undefined,
    active_years: a.activeYears ? String(a.activeYears) : (a.active_years ? String(a.active_years) : undefined),
    artist_type: a.artistType ? String(a.artistType) : (a.artist_type ? String(a.artist_type) : undefined),
    thumb_url: a.thumbUrl ? String(a.thumbUrl) : (a.thumb_url ? String(a.thumb_url) : undefined),
    last_sync_at: a.lastSyncAt ? String(a.lastSyncAt) : (a.last_sync_at ? String(a.last_sync_at) : undefined),
    created_at: a.createdAt ? String(a.createdAt) : (a.created_at ? String(a.created_at) : undefined),
    updated_at: a.updatedAt ? String(a.updatedAt) : (a.updated_at ? String(a.updated_at) : undefined),
  }
}

/**
 * Maps a Drizzle model or SQLite database row representing SeriesCompleteness
 * to the standard snake_case contract.
 */
export function toSnakeCaseSeriesCompleteness(r: unknown): import('@main/types/database').SeriesCompleteness {
  const source = asMapperFields(r)
  const s = asMapperFields(source.series || source)
  return {
    id: s.id !== undefined ? Number(s.id) : undefined,
    series_title: String(s.seriesTitle || s.series_title || ''),
    series_identity_key: s.seriesIdentityKey ? String(s.seriesIdentityKey) : (s.series_identity_key ? String(s.series_identity_key) : undefined),
    source_id: s.sourceId ? String(s.sourceId) : (s.source_id ? String(s.source_id) : undefined),
    library_id: s.libraryId ? String(s.libraryId) : (s.library_id ? String(s.library_id) : undefined),
    total_seasons: Number(s.totalSeasons !== undefined ? s.totalSeasons : (s.total_seasons || 0)),
    total_episodes: Number(s.totalEpisodes !== undefined ? s.totalEpisodes : (s.total_episodes || 0)),
    owned_seasons: Number(s.ownedSeasons !== undefined ? s.ownedSeasons : (s.owned_seasons || 0)),
    owned_episodes: Number(s.ownedEpisodes !== undefined ? s.ownedEpisodes : (s.owned_episodes || 0)),
    missing_seasons: typeof s.missingSeasons === 'string' ? s.missingSeasons : (typeof s.missing_seasons === 'string' ? s.missing_seasons : '[]'),
    missing_episodes: typeof s.missingEpisodes === 'string' ? s.missingEpisodes : (typeof s.missing_episodes === 'string' ? s.missing_episodes : '[]'),
    completeness_percentage: Number(s.completenessPercentage !== undefined ? s.completenessPercentage : (s.completeness_percentage || 0)),
    efficiency_score: s.efficiencyScore !== undefined ? Number(s.efficiencyScore) : (s.efficiency_score !== undefined ? Number(s.efficiency_score) : undefined),
    storage_debt_bytes: s.storageDebtBytes !== undefined ? Number(s.storageDebtBytes) : (s.storage_debt_bytes !== undefined ? Number(s.storage_debt_bytes) : undefined),
    total_size: s.totalSize !== undefined ? Number(s.totalSize) : (s.total_size !== undefined ? Number(s.total_size) : undefined),
    tmdb_id: s.tmdbId ? String(s.tmdbId) : (s.tmdb_id ? String(s.tmdb_id) : undefined),
    tvdb_id: s.tvdbId ? String(s.tvdbId) : (s.tvdb_id ? String(s.tvdb_id) : undefined),
    poster_url: s.posterUrl ? String(s.posterUrl) : (s.poster_url ? String(s.poster_url) : undefined),
    backdrop_url: s.backdropUrl ? String(s.backdropUrl) : (s.backdrop_url ? String(s.backdrop_url) : undefined),
    created_at: s.createdAt ? String(s.createdAt) : (s.created_at ? String(s.created_at) : undefined),
    updated_at: s.updatedAt ? String(s.updatedAt) : (s.updated_at ? String(s.updated_at) : undefined),
  }
}

