import type { MediaItem, QualityScore } from '@main/types/database'

/**
 * Maps a Drizzle model or SQLite database row representing a MediaItem 
 * (plus optionally its QualityScore) to the standard snake_case contract.
 */
export function toSnakeCaseMediaItem(r: any, q?: any): MediaItem {
  const item = r?.item || r || {}
  const quality = q || r?.quality || r?.q || {}
  
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
  }
}

/**
 * Maps a Drizzle model or SQLite database row representing a QualityScore
 * to the standard snake_case contract.
 */
export function toSnakeCaseQualityScore(r: any): QualityScore {
  return {
    id: r.id,
    media_item_id: r.mediaItemId || r.media_item_id,
    quality_tier: r.qualityTier || r.quality_tier,
    tier_quality: r.tierQuality || r.tier_quality,
    tier_score: r.tierScore || r.tier_score,
    bitrate_tier_score: r.bitrateTierScore || r.bitrate_tier_score,
    audio_tier_score: r.audioTierScore || r.audio_tier_score,
    overall_score: r.overallScore || r.overall_score,
    resolution_score: r.resolutionScore || r.resolution_score,
    bitrate_score: r.bitrateScore || r.bitrate_score,
    audio_score: r.audioScore || r.audio_score,
    efficiency_score: r.efficiencyScore !== undefined ? r.efficiencyScore : r.efficiency_score,
    storage_debt_bytes: r.storageDebtBytes !== undefined ? r.storageDebtBytes : r.storage_debt_bytes,
    is_low_quality: r.isLowQuality === 1 || r.isLowQuality === true || r.is_low_quality === 1 || r.is_low_quality === true,
    needs_upgrade: r.needsUpgrade === 1 || r.needsUpgrade === true || r.needs_upgrade === 1 || r.needs_upgrade === true,
    issues: r.issues,
    created_at: r.createdAt || r.created_at,
    updated_at: r.updatedAt || r.updated_at
  }
}
