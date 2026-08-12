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
