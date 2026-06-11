/**
 * MediaTransformer
 * 
 * Unified service for transforming raw provider data into internal MediaItem objects.
 * Ensures consistent quality calculation and metadata mapping across all providers.
 * 
 * MANDATE: No implicit defaults/failsafes. 
 */

import { 
  normalizeVideoCodec, 
  normalizeAudioCodec, 
  normalizeResolution, 
  normalizeHdrFormat,
  normalizeBitrate,
  normalizeAudioChannels,
  normalizeSampleRate,
  normalizeFrameRate,
  normalizeContainer,
  hasObjectAudio
} from '@main/services/MediaNormalizer'
import { selectBestAudioTrack, calculateVersionScore } from '@main/providers/utils/ProviderUtils'
import { getFileNameParser } from '@main/services/FileNameParser'
import { extractVersionNames } from '@main/providers/utils/VersionNaming'
import { ProviderType, MediaItemType } from '@main/types/database'
import type { MediaItem, MediaItemVersion, AudioTrack, SubtitleTrack } from '@main/types/database'
import type { PlexMediaItem } from '@main/types/plex'
import type { JellyfinMediaItem } from '@main/providers/jellyfin-emby/JellyfinEmbyBase'

export interface KodiStreamDetails {
  video?: Array<{
    width?: number
    height?: number
    codec?: string
    duration?: number
    hdrtype?: string
  }>
  audio?: Array<{
    codec?: string
    channels?: number
    language?: string
  }>
  subtitle?: Array<{
    language?: string
  }>
}

export interface KodiMediaItem {
  movieid?: number
  episodeid?: number
  title: string
  year?: number
  showtitle?: string
  season?: number
  episode?: number
  file: string
  plot?: string
  imdbnumber?: string
  streamdetails?: KodiStreamDetails
  art?: Record<string, string>
}

export class IncompleteMetadataError extends Error {
  constructor(public providerId: string, public missingField: string, public providerType: ProviderType) {
    super(`[${providerType}] Incomplete metadata for item ${providerId}: Missing ${missingField}`)
    this.name = 'IncompleteMetadataError'
  }
}

export class MediaTransformer {
  /**
   * Calculate a reliable video bitrate by cross-referencing container and stream info.
   * Returns value in kbps.
   */
  static calculateReliableVideoBitrate(
    videoStreamBitrate: number | undefined,
    containerBitrate: number | undefined,
    audioTracks: Array<{ bitrate?: number }>,
    unit: 'bps' | 'kbps' = 'kbps'
  ): number {
    const factor = unit === 'bps' ? 1000 : 1
    const overall = (containerBitrate || 0) / factor
    const video = (videoStreamBitrate || 0) / factor
    const audioSum = audioTracks.reduce((sum, t) => sum + (t.bitrate || 0), 0)

    // Use video stream bitrate if it's realistic (less than 99% of total)
    if (video > 0 && overall > 0 && video < overall * 0.99) {
      return Math.round(video)
    }

    // Otherwise calculate from total - audio
    if (overall > 0 && audioSum > 0) {
      return Math.round(Math.max(0, (video || overall) - audioSum))
    }

    return Math.round(video || overall)
  }

  /**
   * Transform a Plex Media Item.
   */
  static fromPlex(item: PlexMediaItem, sourceId: string, serverUri?: string, accessToken?: string): { mediaItem: MediaItem, versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } {
    const allMedia = item.Media || []
    if (allMedia.length === 0) throw new IncompleteMetadataError(item.ratingKey, 'Media', ProviderType.Plex)

    const versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] = []

    for (const media of allMedia) {
      const part = media.Part?.[0]
      if (!part || !part.file) continue

      const videoStream = part.Stream?.find((s) => s.streamType === 1)
      const audioStreams = part.Stream?.filter((s) => s.streamType === 2) || []
      const subtitleStreams = part.Stream?.filter((s) => s.streamType === 3) || []

      if (!videoStream || audioStreams.length === 0) continue

      const audioTracks: AudioTrack[] = audioStreams.map((stream, index) => ({
        index,
        codec: normalizeAudioCodec(stream.codec, stream.profile),
        channels: normalizeAudioChannels(stream.channels, stream.audioChannelLayout),
        bitrate: normalizeBitrate(stream.bitrate, 'kbps'),
        language: stream.language || stream.languageCode,
        title: stream.extendedDisplayTitle || stream.title,
        profile: stream.profile,
        sampleRate: normalizeSampleRate(stream.samplingRate),
        isDefault: stream.selected === true,
        hasObjectAudio: hasObjectAudio(stream.codec, stream.profile, stream.displayTitle || stream.title, stream.audioChannelLayout),
      }))

      const subtitleTracks: SubtitleTrack[] = subtitleStreams.map((stream, index) => ({
        index,
        codec: stream.codec || 'unknown',
        language: stream.language || stream.languageCode,
        title: stream.displayTitle || stream.title,
        isDefault: stream.selected === true,
        isForced: (stream.displayTitle || stream.title || '').toLowerCase().includes('forced'),
      }))

      const bestAudioTrack = selectBestAudioTrack(audioTracks) || audioTracks[0]
      const audioStream = audioStreams[bestAudioTrack.index] || audioStreams[0]
      const width = media.width || 0
      const height = media.height || 0
      const resolution = normalizeResolution(width, height)
      const hdrFormat = normalizeHdrFormat(undefined, videoStream.colorTrc, videoStream.colorPrimaries, videoStream.bitDepth, videoStream.profile) || 'None'

      const parsed = getFileNameParser().parse(part.file)
      const edition = (parsed?.type === 'movie' ? parsed.edition : undefined) || item.editionTitle || undefined
      const source = parsed?.type !== 'music' ? parsed?.source : undefined
      const sourceType = source && /remux/i.test(source) ? 'REMUX' : source && /web-dl|webdl/i.test(source) ? 'WEB-DL' : undefined

      const labelParts = [resolution]
      if (hdrFormat !== 'None') labelParts.push(hdrFormat)
      if (sourceType) labelParts.push(sourceType)
      if (edition) labelParts.push(edition)

      versions.push({
        version_source: `plex_media_${media.id}`,
        edition,
        source_type: sourceType,
        label: labelParts.join(' '),
        file_path: part.file,
        file_size: part.size,
        duration: item.duration,
        resolution,
        width,
        height,
        video_codec: normalizeVideoCodec(media.videoCodec),
        video_bitrate: MediaTransformer.calculateReliableVideoBitrate(videoStream.bitrate, media.bitrate, audioTracks, 'kbps'),
        audio_codec: normalizeAudioCodec(media.audioCodec, audioStream?.profile),
        audio_channels: normalizeAudioChannels(media.audioChannels, audioStream?.audioChannelLayout),
        audio_bitrate: bestAudioTrack.bitrate,
        video_frame_rate: normalizeFrameRate(videoStream.frameRate),
        color_bit_depth: videoStream.bitDepth,
        hdr_format: hdrFormat,
        color_space: videoStream.colorSpace,
        video_profile: videoStream.profile,
        video_level: videoStream.level,
        audio_profile: audioStream?.profile,
        audio_sample_rate: normalizeSampleRate(audioStream?.samplingRate),
        has_object_audio: hasObjectAudio(audioStream?.codec, audioStream?.profile, audioStream?.displayTitle || audioStream?.title, audioStream?.audioChannelLayout),
        audio_tracks: JSON.stringify(audioTracks),
        subtitle_tracks: subtitleTracks.length > 0 ? JSON.stringify(subtitleTracks) : undefined,
        container: normalizeContainer(part.container || media.container),
      })
    }

    if (versions.length === 0) throw new IncompleteMetadataError(item.ratingKey, 'Valid Media Versions', ProviderType.Plex)
    if (versions.length > 1) extractVersionNames(versions)
    const best = versions.reduce((a, b) => calculateVersionScore(b) > calculateVersionScore(a) ? b : a)

    let imdbId, tmdbId
    if (item.Guid) {
      for (const guid of item.Guid) {
        if (guid.id.includes('imdb://')) imdbId = guid.id.replace('imdb://', '')
        else if (guid.id.includes('tmdb://')) tmdbId = guid.id.replace('tmdb://', '').split('?')[0]
      }
    }

    let posterUrl, episodeThumbUrl, seasonPosterUrl
    if (serverUri && accessToken) {
      if (item.thumb) {
        const thumbPath = item.type === 'episode' && item.grandparentThumb ? item.grandparentThumb : item.thumb
        posterUrl = `${serverUri}${thumbPath}?X-Plex-Token=${accessToken}`
      }
      if (item.type === 'episode') {
        if (item.thumb) episodeThumbUrl = `${serverUri}${item.thumb}?X-Plex-Token=${accessToken}`
        if (item.parentThumb) seasonPosterUrl = `${serverUri}${item.parentThumb}?X-Plex-Token=${accessToken}`
      }
    }

    return {
      mediaItem: {
        source_id: sourceId,
        source_type: ProviderType.Plex,
        plex_id: item.ratingKey,
        title: item.title,
        sort_title: item.type === 'episode' ? undefined : (item.titleSort || undefined),
        year: item.year,
        type: item.type === 'episode' ? MediaItemType.Episode : MediaItemType.Movie,
        series_title: item.grandparentTitle,
        season_number: item.parentIndex,
        episode_number: item.index,
        file_path: best.file_path,
        file_size: best.file_size,
        duration: best.duration,
        resolution: best.resolution,
        width: best.width,
        height: best.height,
        video_codec: best.video_codec,
        video_bitrate: best.video_bitrate,
        audio_codec: best.audio_codec,
        audio_channels: best.audio_channels,
        audio_bitrate: best.audio_bitrate,
        video_frame_rate: best.video_frame_rate,
        color_bit_depth: best.color_bit_depth,
        hdr_format: best.hdr_format,
        color_space: best.color_space,
        video_profile: best.video_profile,
        video_level: best.video_level,
        audio_profile: best.audio_profile,
        audio_sample_rate: best.audio_sample_rate,
        has_object_audio: best.has_object_audio,
        audio_tracks: best.audio_tracks,
        subtitle_tracks: best.subtitle_tracks,
        container: best.container,
        version_count: versions.length,
        imdb_id: imdbId,
        tmdb_id: tmdbId,
        poster_url: posterUrl,
        episode_thumb_url: episodeThumbUrl,
        season_poster_url: seasonPosterUrl,
        summary: item.summary || undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as MediaItem,
      versions: versions.map(v => ({ ...v, media_item_id: 0 })) as any,
    }
  }

  /**
   * Transform a Jellyfin/Emby Media Item.
   */
  static fromJellyfin(item: JellyfinMediaItem, sourceId: string, providerType: ProviderType, buildImageUrl: (id: string, type: string, tag?: string) => string): { mediaItem: MediaItem, versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } {
    const allSources = item.MediaSources || []
    if (allSources.length === 0) throw new IncompleteMetadataError(item.Id, 'MediaSources', providerType)

    const versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] = []

    for (const mediaSource of allSources) {
      const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video')
      const audioStreams = mediaSource.MediaStreams?.filter(s => s.Type === 'Audio') || []
      const subtitleStreams = mediaSource.MediaStreams?.filter(s => s.Type === 'Subtitle') || []

      if (!videoStream || audioStreams.length === 0) continue

      const audioTracks: AudioTrack[] = audioStreams.map((stream, index) => ({
        index,
        codec: normalizeAudioCodec(stream.Codec, stream.Profile),
        channels: normalizeAudioChannels(stream.Channels, stream.ChannelLayout),
        bitrate: normalizeBitrate(stream.BitRate, 'bps'),
        language: stream.Language,
        title: stream.DisplayTitle || stream.Title,
        profile: stream.Profile,
        sampleRate: normalizeSampleRate(stream.SampleRate),
        isDefault: stream.IsDefault,
        hasObjectAudio: hasObjectAudio(stream.Codec, stream.Profile, stream.DisplayTitle || stream.Title, stream.ChannelLayout),
      }))

      const subtitleTracks: SubtitleTrack[] = subtitleStreams.map((stream, index) => ({
        index,
        codec: stream.Codec || 'unknown',
        language: stream.Language,
        title: stream.DisplayTitle || stream.Title,
        isDefault: stream.IsDefault,
        isForced: stream.IsForced,
      }))

      const bestAudioTrack = selectBestAudioTrack(audioTracks) || audioTracks[0]
      const audioStream = audioStreams.find(s => s.Index === audioStreams[bestAudioTrack.index]?.Index) || audioStreams[0]

      const width = videoStream.Width || 0
      const height = videoStream.Height || 0
      const resolution = normalizeResolution(width, height)
      const hdrFormat = normalizeHdrFormat(videoStream.VideoRange, undefined, undefined, videoStream.BitDepth, videoStream.Profile) || 'None'

      const filePath = mediaSource.Path
      if (!filePath) continue

      const parsed = getFileNameParser().parse(filePath)
      const edition = (parsed?.type === 'movie' ? parsed.edition : undefined) || undefined
      const source = parsed?.type !== 'music' ? parsed?.source : undefined
      const sourceType = source && /remux/i.test(source) ? 'REMUX' : source && /web-dl|webdl/i.test(source) ? 'WEB-DL' : undefined

      const labelParts = [resolution]
      if (hdrFormat !== 'None') labelParts.push(hdrFormat)
      if (sourceType) labelParts.push(sourceType)
      if (edition) labelParts.push(edition)

      versions.push({
        version_source: `jellyfin_source_${mediaSource.Id}`,
        edition,
        source_type: sourceType,
        label: labelParts.join(' '),
        file_path: filePath,
        file_size: mediaSource.Size || 0,
        duration: mediaSource.RunTimeTicks ? Math.floor(mediaSource.RunTimeTicks / 10000) : 0,
        resolution,
        width,
        height,
        video_codec: normalizeVideoCodec(videoStream.Codec),
        video_bitrate: MediaTransformer.calculateReliableVideoBitrate(videoStream.BitRate, mediaSource.Bitrate, audioTracks, 'bps'),
        audio_codec: normalizeAudioCodec(audioStream?.Codec, audioStream?.Profile),
        audio_channels: normalizeAudioChannels(audioStream?.Channels, audioStream?.ChannelLayout),
        audio_bitrate: bestAudioTrack.bitrate,
        video_frame_rate: normalizeFrameRate(videoStream.RealFrameRate),
        color_bit_depth: videoStream.BitDepth,
        hdr_format: hdrFormat,
        color_space: videoStream.ColorSpace,
        video_profile: videoStream.Profile,
        video_level: videoStream.Level,
        audio_profile: audioStream?.Profile,
        audio_sample_rate: normalizeSampleRate(audioStream?.SampleRate),
        has_object_audio: hasObjectAudio(audioStream?.Codec, audioStream?.Profile, audioStream?.DisplayTitle || audioStream?.Title, audioStream?.ChannelLayout),
        audio_tracks: JSON.stringify(audioTracks),
        subtitle_tracks: subtitleTracks.length > 0 ? JSON.stringify(subtitleTracks) : undefined,
        container: normalizeContainer(mediaSource.Container),
      })
    }

    if (versions.length === 0) throw new IncompleteMetadataError(item.Id, 'Valid Media Versions', providerType)
    if (versions.length > 1) extractVersionNames(versions)
    const best = versions.reduce((a, b) => calculateVersionScore(b) > calculateVersionScore(a) ? b : a)

    const isEpisode = item.Type === 'Episode'

    let posterUrl: string | undefined
    if (isEpisode) {
      if (item.SeriesId && item.SeriesPrimaryImageTag) posterUrl = buildImageUrl(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag)
      else if (item.SeriesId) posterUrl = buildImageUrl(item.SeriesId, 'Primary')
    } else {
      if (item.ImageTags?.Primary) posterUrl = buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
    }

    let episodeThumbUrl: string | undefined
    if (isEpisode) {
      if (item.ImageTags?.Primary) episodeThumbUrl = buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      else if (item.ImageTags?.Screenshot) episodeThumbUrl = buildImageUrl(item.Id, 'Screenshot', item.ImageTags.Screenshot)
    }

    let seasonPosterUrl: string | undefined
    if (isEpisode && item.SeasonId) {
      if (item.ParentPrimaryImageItemId && item.ParentPrimaryImageTag) seasonPosterUrl = buildImageUrl(item.ParentPrimaryImageItemId, 'Primary', item.ParentPrimaryImageTag)
      else if (item.ParentPrimaryImageTag) seasonPosterUrl = buildImageUrl(item.SeasonId, 'Primary', item.ParentPrimaryImageTag)
    }

    const seriesTmdbId = isEpisode ? item.SeriesProviderIds?.Tmdb : undefined

    return {
      mediaItem: {
        source_id: sourceId,
        source_type: providerType,
        plex_id: item.Id,
        title: item.Name,
        sort_title: isEpisode ? undefined : (item.SortName || undefined),
        year: item.ProductionYear,
        type: isEpisode ? MediaItemType.Episode : MediaItemType.Movie,
        series_title: item.SeriesName,
        season_number: item.ParentIndexNumber,
        episode_number: item.IndexNumber,
        file_path: best.file_path,
        file_size: best.file_size,
        duration: best.duration,
        resolution: best.resolution,
        width: best.width,
        height: best.height,
        video_codec: best.video_codec,
        video_bitrate: best.video_bitrate,
        audio_codec: best.audio_codec,
        audio_channels: best.audio_channels,
        audio_bitrate: best.audio_bitrate,
        video_frame_rate: best.video_frame_rate,
        color_bit_depth: best.color_bit_depth,
        hdr_format: best.hdr_format,
        color_space: best.color_space,
        video_profile: best.video_profile,
        video_level: best.video_level,
        audio_profile: best.audio_profile,
        audio_sample_rate: best.audio_sample_rate,
        has_object_audio: best.has_object_audio,
        audio_tracks: best.audio_tracks,
        subtitle_tracks: best.subtitle_tracks,
        container: best.container,
        version_count: versions.length,
        imdb_id: item.ProviderIds?.Imdb,
        tmdb_id: item.ProviderIds?.Tmdb,
        series_tmdb_id: seriesTmdbId,
        poster_url: posterUrl,
        episode_thumb_url: episodeThumbUrl,
        season_poster_url: seasonPosterUrl,
        summary: item.Overview || undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as MediaItem,
      versions: versions.map(v => ({ ...v, media_item_id: 0 })) as any,
    }
  }

  /**
   * Transform a Kodi Media Item.
   */
  static fromKodi(item: KodiMediaItem, sourceId: string, type: MediaItemType, buildImageUrl: (url: string) => string): { mediaItem: MediaItem, versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } {
    const videoStream = item.streamdetails?.video?.[0]
    if (!videoStream) throw new IncompleteMetadataError(String(item.movieid || item.episodeid), 'Video Stream', ProviderType.Kodi)

    const width = videoStream.width || 0
    const height = videoStream.height || 0
    const resolution = normalizeResolution(width, height)
    const hdrFormat = normalizeHdrFormat(videoStream.hdrtype, undefined, undefined, undefined, undefined) || 'None'
    const duration = videoStream.duration || 0

    const audioTracks: AudioTrack[] = (item.streamdetails?.audio || []).map((stream, index) => ({
      index,
      codec: normalizeAudioCodec(stream.codec),
      channels: normalizeAudioChannels(stream.channels, undefined),
      language: stream.language,
      bitrate: 0, 
      hasObjectAudio: hasObjectAudio(stream.codec, undefined, item.title, undefined),
    }))

    const subtitleTracks: SubtitleTrack[] = (item.streamdetails?.subtitle || []).map((stream, index) => ({
      index,
      codec: 'unknown',
      language: stream.language,
    }))

    const filePath = item.file || ''
    if (!filePath) throw new IncompleteMetadataError(String(item.movieid || item.episodeid), 'file', ProviderType.Kodi)
    
    const parsed = getFileNameParser().parse(filePath)
    const edition = (parsed?.type === 'movie' ? parsed.edition : undefined) || undefined
    const source = parsed?.type !== 'music' ? parsed?.source : undefined
    const sourceType = source && /remux/i.test(source) ? 'REMUX' : source && /web-dl|webdl/i.test(source) ? 'WEB-DL' : undefined

    const labelParts = [resolution]
    if (hdrFormat !== 'None') labelParts.push(hdrFormat)
    if (sourceType) labelParts.push(sourceType)
    if (edition) labelParts.push(edition)

    const isEpisode = type === MediaItemType.Episode

    const version: Omit<MediaItemVersion, 'id' | 'media_item_id'> = {
      version_source: `kodi_${type}_${item.movieid || item.episodeid}`,
      edition,
      source_type: sourceType,
      label: labelParts.join(' '),
      file_path: filePath,
      file_size: 0, 
      duration,
      resolution,
      width,
      height,
      video_codec: normalizeVideoCodec(videoStream.codec),
      video_bitrate: 0,
      audio_codec: audioTracks[0]?.codec,
      audio_channels: audioTracks[0]?.channels,
      audio_bitrate: 0,
      hdr_format: hdrFormat,
      has_object_audio: audioTracks[0]?.hasObjectAudio,
      audio_tracks: JSON.stringify(audioTracks),
      subtitle_tracks: subtitleTracks.length > 0 ? JSON.stringify(subtitleTracks) : undefined,
      container: normalizeContainer(filePath.split('.').pop()),
    }

    return {
      mediaItem: {
        source_id: sourceId,
        source_type: ProviderType.Kodi,
        plex_id: isEpisode ? `episode-${item.episodeid}` : `movie-${item.movieid}`,
        title: item.title,
        year: isEpisode ? undefined : item.year,
        type,
        series_title: item.showtitle,
        season_number: item.season,
        episode_number: item.episode,
        file_path: version.file_path,
        file_size: version.file_size,
        duration: version.duration,
        resolution: version.resolution,
        width: version.width,
        height: version.height,
        video_codec: version.video_codec,
        video_bitrate: 0,
        audio_codec: version.audio_codec,
        audio_channels: version.audio_channels,
        audio_bitrate: 0,
        hdr_format: version.hdr_format,
        has_object_audio: version.has_object_audio,
        audio_tracks: version.audio_tracks,
        subtitle_tracks: version.subtitle_tracks,
        container: version.container,
        version_count: 1,
        imdb_id: item.imdbnumber,
        tmdb_id: undefined,
        poster_url: type === MediaItemType.Episode ? buildImageUrl(item.art?.['tvshow.poster'] || item.art?.['season.poster'] || '') : buildImageUrl(item.art?.poster || ''),
        episode_thumb_url: type === MediaItemType.Episode ? buildImageUrl(item.art?.thumb || '') : undefined,
        season_poster_url: type === MediaItemType.Episode ? buildImageUrl(item.art?.['season.poster'] || '') : undefined,
        summary: item.plot,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as MediaItem,
      versions: [version],
    }
  }
}
