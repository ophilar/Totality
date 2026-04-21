import * as path from 'path'
import * as fs from 'fs'
import {
  normalizeVideoCodec,
  normalizeAudioCodec,
  normalizeResolution,
  normalizeHdrFormat,
  normalizeBitrate,
  normalizeFrameRate,
  normalizeAudioChannels,
  normalizeSampleRate,
  normalizeContainer,
  hasObjectAudio,
} from '../../services/MediaNormalizer'
import { selectBestAudioTrack } from '../utils/ProviderUtils'
import { getFileNameParser } from '../../services/FileNameParser'
import { extractVersionNames } from '../utils/VersionNaming'
import { getMediaFileAnalyzer } from '../../services/MediaFileAnalyzer'
import {
  isLosslessCodec,
  isHiRes,
  extractMusicBrainzId,
  MUSICBRAINZ_ARTIST_KEYS,
  MUSICBRAINZ_ALBUM_KEYS,
  MUSICBRAINZ_TRACK_KEYS,
} from '../base/MusicScannerUtils'
import type {
  MediaMetadata,
} from '../base/MediaProvider'
import type {
  MediaItem,
  MediaItemVersion,
  AudioTrack,
  SubtitleTrack,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
} from '../../types/database'
import type {
  JellyfinMediaItem,
  JellyfinMusicArtist,
  JellyfinMusicAlbum,
  JellyfinMusicTrack,
} from './JellyfinEmbyBase'
import { JellyfinApiClient } from './JellyfinApiClient'

export class JellyfinItemMapper {
  constructor(
    private sourceId: string,
    private providerType: 'jellyfin' | 'emby',
    private client: JellyfinApiClient
  ) {}

  mapLibraryType(collectionType?: string): 'movie' | 'show' | 'music' | 'unknown' {
    switch (collectionType) {
      case 'movies':
      case 'homevideos':
      case 'musicvideos':
      case 'boxsets':
        return 'movie'
      case 'tvshows':
        return 'show'
      case 'music':
        return 'music'
      default:
        return 'unknown'
    }
  }

  convertToMediaMetadata(item: JellyfinMediaItem): MediaMetadata {
    const mediaSource = item.MediaSources?.[0]
    const videoStream = mediaSource?.MediaStreams?.find(s => s.Type === 'Video')
    const audioStream = mediaSource?.MediaStreams?.find(s => s.Type === 'Audio')
    const isEpisode = item.Type === 'Episode'

    let posterUrl: string | undefined
    if (isEpisode) {
      if (item.SeriesId && item.SeriesPrimaryImageTag) {
        posterUrl = this.client.buildImageUrl(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag)
      } else if (item.SeriesId) {
        posterUrl = this.client.buildImageUrl(item.SeriesId, 'Primary')
      }
    } else {
      if (item.ImageTags?.Primary) {
        posterUrl = this.client.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      }
    }

    const width = videoStream?.Width || 0
    const height = videoStream?.Height || 0

    let audioBitrate = audioStream?.BitRate
    if (!audioBitrate && mediaSource?.Bitrate && videoStream?.BitRate) {
      audioBitrate = mediaSource.Bitrate - videoStream.BitRate
    } else if (!audioBitrate && audioStream) {
      const codecLower = (audioStream.Codec || '').toLowerCase()
      const channels = audioStream.Channels || 6
      if (codecLower.includes('truehd') || codecLower.includes('mlp')) {
        audioBitrate = channels * 500 * 1000
      } else if (codecLower.includes('dts') && (codecLower.includes('hd') || codecLower.includes('ma') || codecLower.includes('x'))) {
        audioBitrate = channels * 400 * 1000
      } else if (codecLower === 'flac') {
        audioBitrate = channels * 200 * 1000
      }
    }

    return {
      providerId: this.sourceId,
      providerType: this.providerType,
      itemId: item.Id,
      title: item.Name,
      sortTitle: item.SortName,
      type: isEpisode ? 'episode' : 'movie',
      year: item.ProductionYear,
      seriesTitle: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      imdbId: item.ProviderIds?.Imdb,
      tmdbId: item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb, 10) : undefined,
      filePath: mediaSource?.Path,
      fileSize: mediaSource?.Size,
      duration: mediaSource?.RunTimeTicks ? Math.floor(mediaSource.RunTimeTicks / 10000) : undefined,
      container: normalizeContainer(mediaSource?.Container),
      resolution: normalizeResolution(width, height),
      width,
      height,
      videoCodec: normalizeVideoCodec(videoStream?.Codec),
      videoBitrate: normalizeBitrate(videoStream?.BitRate || mediaSource?.Bitrate, 'bps'),
      videoFrameRate: normalizeFrameRate(videoStream?.RealFrameRate),
      colorBitDepth: videoStream?.BitDepth,
      hdrFormat: normalizeHdrFormat(
        videoStream?.VideoRange,
        undefined,
        undefined,
        videoStream?.BitDepth,
        videoStream?.Profile
      ),
      colorSpace: videoStream?.ColorSpace,
      videoProfile: videoStream?.Profile,
      audioCodec: normalizeAudioCodec(audioStream?.Codec, audioStream?.Profile),
      audioChannels: normalizeAudioChannels(audioStream?.Channels, audioStream?.ChannelLayout),
      audioBitrate: normalizeBitrate(audioBitrate, 'bps'),
      audioSampleRate: normalizeSampleRate(audioStream?.SampleRate),
      hasObjectAudio: hasObjectAudio(
        audioStream?.Codec,
        audioStream?.Profile,
        audioStream?.DisplayTitle || audioStream?.Title,
        audioStream?.ChannelLayout
      ),
      posterUrl,
    }
  }

  async convertToMediaItem(item: JellyfinMediaItem): Promise<{ mediaItem: MediaItem; versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } | null> {
    const allSources = item.MediaSources || []
    if (allSources.length === 0) return null

    type VersionData = Omit<MediaItemVersion, 'id' | 'media_item_id'>
    const versions: VersionData[] = []

    for (const mediaSource of allSources) {
      const videoStream = mediaSource.MediaStreams?.find(s => s.Type === 'Video')
      const audioStreams = mediaSource.MediaStreams?.filter(s => s.Type === 'Audio') || []
      const subtitleStreams = mediaSource.MediaStreams?.filter(s => s.Type === 'Subtitle') || []

      if (!videoStream || audioStreams.length === 0) continue

      const totalBitrate = mediaSource.Bitrate || 0
      const videoBitrate = videoStream.BitRate || 0

      const hasMissingBitrate = audioStreams.some(s => !s.BitRate)
      let ffprobeBitrates: Map<number, number> | null = null

      if (hasMissingBitrate && mediaSource.Path) {
        ffprobeBitrates = await this.getAudioBitratesViaFFprobe(mediaSource.Path)
      }

      const audioTracks: AudioTrack[] = audioStreams.map((stream, index) => {
        let streamBitrate = stream.BitRate
        if (!streamBitrate && ffprobeBitrates) {
          const ffprobeBitrate = ffprobeBitrates.get(stream.Index)
          if (ffprobeBitrate) streamBitrate = ffprobeBitrate * 1000
        }

        if (!streamBitrate && totalBitrate > videoBitrate && audioStreams.length === 1) {
          streamBitrate = totalBitrate - videoBitrate
        } else if (!streamBitrate && totalBitrate > videoBitrate && audioStreams.length > 1) {
          const codecLower = (stream.Codec || '').toLowerCase()
          const channels = stream.Channels || 6
          if (codecLower.includes('truehd') || codecLower.includes('mlp')) {
            streamBitrate = channels * 500 * 1000
          } else if (codecLower.includes('dts') && (codecLower.includes('hd') || codecLower.includes('ma') || codecLower.includes('x'))) {
            streamBitrate = channels * 400 * 1000
          } else if (codecLower === 'flac') {
            streamBitrate = channels * 200 * 1000
          }
        }

        return {
          index,
          codec: normalizeAudioCodec(stream.Codec, stream.Profile),
          channels: normalizeAudioChannels(stream.Channels, stream.ChannelLayout),
          bitrate: normalizeBitrate(streamBitrate, 'bps'),
          language: stream.Language,
          title: stream.DisplayTitle || stream.Title,
          profile: stream.Profile,
          sampleRate: normalizeSampleRate(stream.SampleRate),
          isDefault: stream.IsDefault,
          hasObjectAudio: hasObjectAudio(
            stream.Codec,
            stream.Profile,
            stream.DisplayTitle || stream.Title,
            stream.ChannelLayout
          ),
        }
      })

      const subtitleTracks: SubtitleTrack[] = subtitleStreams.map((stream, index) => ({
        index,
        codec: stream.Codec || 'unknown',
        language: stream.Language,
        title: stream.DisplayTitle || stream.Title,
        isDefault: stream.IsDefault,
        isForced: stream.IsForced,
      }))

      if (mediaSource.Path) {
        try {
          const videoDir = path.dirname(mediaSource.Path)
          const videoBaseName = path.basename(mediaSource.Path, path.extname(mediaSource.Path))
          if (fs.existsSync(videoDir)) {
            const dirFiles = fs.readdirSync(videoDir)
            const subExtensions = ['.srt', '.sub', '.ass', '.ssa', '.vtt', '.sup']

            for (const file of dirFiles) {
              const ext = path.extname(file).toLowerCase()
              if (!subExtensions.includes(ext)) continue
              if (!file.startsWith(videoBaseName)) continue

              const stripped = path.basename(file, ext)
              const parts = stripped.substring(videoBaseName.length).split('.')
              const langCode = parts.filter(p => p.length >= 2 && p.length <= 3).pop()

              const codec = ext.slice(1)
              const alreadyPresent = subtitleTracks.some(t => t.language === langCode && t.codec === codec)
              if (!alreadyPresent) {
                subtitleTracks.push({
                  index: subtitleTracks.length,
                  codec,
                  language: langCode,
                  title: file,
                  isDefault: false,
                  isForced: file.toLowerCase().includes('.forced.'),
                })
              }
            }
          }
        } catch { /* ignore */ }
      }

      const bestAudioTrack = selectBestAudioTrack(audioTracks) || audioTracks[0]
      const audioStream = audioStreams.find(s => s.Index === audioStreams[bestAudioTrack.index]?.Index) || audioStreams[0]

      const width = videoStream.Width || 0
      const height = videoStream.Height || 0
      const resolution = normalizeResolution(width, height)
      const hdrFormat = normalizeHdrFormat(
        videoStream.VideoRange,
        undefined,
        undefined,
        videoStream.BitDepth,
        videoStream.Profile
      ) || 'None'

      const filePath = mediaSource.Path || ''
      const parsed = getFileNameParser().parse(filePath)
      const edition = (parsed?.type === 'movie' ? parsed.edition : undefined) || undefined
      const source = parsed?.type !== 'music' ? parsed?.source : undefined
      const sourceType = source && /remux/i.test(source) ? 'REMUX' : source && /web-dl|webdl/i.test(source) ? 'WEB-DL' : undefined

      const containerBps = mediaSource.Bitrate || 0
      const streamVideoBps = videoStream.BitRate || 0
      const totalAudioBps = audioTracks.reduce((sum, t) => sum + ((t.bitrate || 0) * 1000), 0)

      let videoBps: number
      if (streamVideoBps > 0 && containerBps > 0 && streamVideoBps < containerBps * 0.85) {
        videoBps = streamVideoBps
      } else if (containerBps > 0 && totalAudioBps > 0) {
        videoBps = Math.max(0, (streamVideoBps || containerBps) - totalAudioBps)
      } else {
        videoBps = streamVideoBps || containerBps
      }

      const labelParts = [resolution]
      if (hdrFormat !== 'None') labelParts.push(hdrFormat)
      if (sourceType) labelParts.push(sourceType)
      if (edition) labelParts.push(edition)

      versions.push({
        version_source: `jellyfin_source_${mediaSource.Id}`,
        edition,
        source_type: sourceType,
        label: labelParts.join(' '),
        file_path: mediaSource.Path || '',
        file_size: mediaSource.Size || 0,
        duration: mediaSource.RunTimeTicks ? Math.floor(mediaSource.RunTimeTicks / 10000) : 0,
        resolution,
        width,
        height,
        video_codec: normalizeVideoCodec(videoStream.Codec),
        video_bitrate: normalizeBitrate(videoBps, 'bps'),
        audio_codec: normalizeAudioCodec(audioStream.Codec, audioStream.Profile),
        audio_channels: normalizeAudioChannels(audioStream.Channels, audioStream.ChannelLayout),
        audio_bitrate: bestAudioTrack.bitrate,
        video_frame_rate: normalizeFrameRate(videoStream.RealFrameRate),
        color_bit_depth: videoStream.BitDepth,
        hdr_format: hdrFormat,
        color_space: videoStream.ColorSpace,
        video_profile: videoStream.Profile,
        video_level: videoStream.Level,
        audio_profile: audioStream.Profile,
        audio_sample_rate: normalizeSampleRate(audioStream.SampleRate),
        has_object_audio: hasObjectAudio(
          audioStream.Codec,
          audioStream.Profile,
          audioStream.DisplayTitle || audioStream.Title,
          audioStream.ChannelLayout
        ),
        audio_tracks: JSON.stringify(audioTracks),
        subtitle_tracks: subtitleTracks.length > 0 ? JSON.stringify(subtitleTracks) : undefined,
        container: normalizeContainer(mediaSource.Container),
      })
    }

    if (versions.length === 0) return null
    if (versions.length > 1) extractVersionNames(versions)

    const best = versions.reduce((a, b) => this.calculateVersionScore(b) > this.calculateVersionScore(a) ? b : a)
    const isEpisode = item.Type === 'Episode'

    let posterUrl: string | undefined
    if (isEpisode) {
      if (item.SeriesId && item.SeriesPrimaryImageTag) {
        posterUrl = this.client.buildImageUrl(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag)
      } else if (item.SeriesId) {
        posterUrl = this.client.buildImageUrl(item.SeriesId, 'Primary')
      }
    } else {
      if (item.ImageTags?.Primary) {
        posterUrl = this.client.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      }
    }

    let episodeThumbUrl: string | undefined
    if (isEpisode) {
      if (item.ImageTags?.Primary) {
        episodeThumbUrl = this.client.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
      } else if (item.ImageTags?.Screenshot) {
        episodeThumbUrl = this.client.buildImageUrl(item.Id, 'Screenshot', item.ImageTags.Screenshot)
      } else if (item.ImageTags?.Thumb) {
        episodeThumbUrl = this.client.buildImageUrl(item.Id, 'Thumb', item.ImageTags.Thumb)
      } else if (item.ParentThumbItemId && item.ParentThumbImageTag) {
        episodeThumbUrl = this.client.buildImageUrl(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag)
      } else {
        episodeThumbUrl = this.client.buildImageUrl(item.Id, 'Primary')
      }
    }

    let seasonPosterUrl: string | undefined
    if (isEpisode && item.SeasonId) {
      if (item.ParentPrimaryImageItemId && item.ParentPrimaryImageTag) {
        seasonPosterUrl = this.client.buildImageUrl(item.ParentPrimaryImageItemId, 'Primary', item.ParentPrimaryImageTag)
      } else if (item.ParentPrimaryImageTag) {
        seasonPosterUrl = this.client.buildImageUrl(item.SeasonId, 'Primary', item.ParentPrimaryImageTag)
      } else {
        seasonPosterUrl = this.client.buildImageUrl(item.SeasonId, 'Primary')
      }
    }

    const seriesTmdbId = isEpisode ? item.SeriesProviderIds?.Tmdb : undefined

    return {
      mediaItem: {
        plex_id: item.Id,
        title: item.Name,
        sort_title: isEpisode ? ((item as any)._seriesSortName || undefined) : (item.SortName || undefined),
        year: item.ProductionYear,
        type: isEpisode ? 'episode' : 'movie',
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
      versions,
    }
  }

  convertToMusicArtist(item: JellyfinMusicArtist, libraryId?: string): MusicArtist {
    const musicbrainzId = extractMusicBrainzId(item.ProviderIds, ...MUSICBRAINZ_ARTIST_KEYS)
    const thumbUrl = item.ImageTags?.Primary ? this.client.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary) : undefined

    return {
      source_id: this.sourceId,
      source_type: this.providerType,
      library_id: libraryId,
      provider_id: item.Id,
      name: item.Name,
      sort_name: item.SortName,
      musicbrainz_id: musicbrainzId,
      genres: item.Genres ? JSON.stringify(item.Genres) : undefined,
      biography: item.Overview,
      thumb_url: thumbUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  convertToMusicAlbum(item: JellyfinMusicAlbum, artistId?: number, libraryId?: string): MusicAlbum {
    const musicbrainzId = extractMusicBrainzId(item.ProviderIds, ...MUSICBRAINZ_ALBUM_KEYS)
    const artistName = item.AlbumArtist || item.AlbumArtists?.[0]?.Name || item.Artists?.[0] || 'Unknown Artist'
    let thumbUrl: string | undefined
    if (item.ImageTags?.Primary) {
      thumbUrl = this.client.buildImageUrl(item.Id, 'Primary', item.ImageTags.Primary)
    }

    return {
      source_id: this.sourceId,
      source_type: this.providerType,
      library_id: libraryId,
      provider_id: item.Id,
      artist_id: artistId,
      artist_name: artistName,
      title: item.Name,
      sort_title: item.SortName || undefined,
      year: item.ProductionYear,
      musicbrainz_id: musicbrainzId,
      genres: item.Genres ? JSON.stringify(item.Genres) : undefined,
      track_count: item.ChildCount,
      total_duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000) : undefined,
      thumb_url: thumbUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  convertToMusicTrack(item: JellyfinMusicTrack, albumId?: number, artistId?: number, libraryId?: string): MusicTrack | null {
    const mediaSource = item.MediaSources?.[0]
    const audioStream = mediaSource?.MediaStreams?.find(s => s.Type === 'Audio')
    if (!mediaSource) return null

    const audioCodec = audioStream?.Codec || 'unknown'
    const sampleRate = audioStream?.SampleRate || 44100
    const bitDepth = audioStream?.BitDepth || 16
    const lossless = isLosslessCodec(audioCodec)
    const hiRes = isHiRes(sampleRate, bitDepth, lossless)

    const musicbrainzId = extractMusicBrainzId(item.ProviderIds, ...MUSICBRAINZ_TRACK_KEYS)
    const artistName = item.AlbumArtist || item.ArtistItems?.[0]?.Name || item.Artists?.[0] || 'Unknown Artist'
    const uniqueMoods = Array.from(new Set([...(item.Moods || []), ...(item.Tags || [])]))

    return {
      source_id: this.sourceId,
      source_type: this.providerType,
      library_id: libraryId,
      provider_id: item.Id,
      album_id: albumId,
      artist_id: artistId,
      album_name: item.Album,
      artist_name: artistName,
      title: item.Name,
      track_number: item.IndexNumber,
      disc_number: item.ParentIndexNumber || 1,
      duration: item.RunTimeTicks ? Math.floor(item.RunTimeTicks / 10000) : undefined,
      file_path: mediaSource.Path,
      file_size: mediaSource.Size,
      container: mediaSource.Container,
      audio_codec: audioCodec,
      audio_bitrate: normalizeBitrate(mediaSource.Bitrate, 'bps'),
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      channels: audioStream?.Channels,
      is_lossless: lossless,
      is_hi_res: hiRes,
      musicbrainz_id: musicbrainzId,
      mood: uniqueMoods.length > 0 ? JSON.stringify(uniqueMoods) : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  groupMovieVersions(items: JellyfinMediaItem[], libraryType: string): JellyfinMediaItem[][] {
    if (libraryType === 'show') return items.map(item => [item])
    const groups = new Map<string, JellyfinMediaItem[]>()
    for (const item of items) {
      const tmdbId = item.ProviderIds?.Tmdb
      const groupKey = tmdbId ? `tmdb:${tmdbId}` : `title:${this.normalizeGroupTitle(item.Name || '')}|${item.ProductionYear || ''}`
      if (!groups.has(groupKey)) groups.set(groupKey, [])
      groups.get(groupKey)!.push(item)
    }
    return Array.from(groups.values())
  }

  private normalizeGroupTitle(title: string): string {
    return title.toLowerCase().trim()
      .replace(/\s*[-:(]\s*(director'?s?\s*cut|extended|unrated|theatrical|imax|remastered|special\s*edition|ultimate\s*edition|collector'?s?\s*edition)\s*[):]?\s*$/i, '')
      .replace(/\s*\(\s*\)\s*$/, '').trim()
  }

  private calculateVersionScore(v: Partial<MediaItemVersion>): number {
    const res = v.resolution || 'SD'
    const tierRank = res.includes('2160') ? 4 : res.includes('1080') ? 3 : res.includes('720') ? 2 : 1
    const hdrBonus = (v.hdr_format && v.hdr_format !== 'None') ? 1000 : 0
    const bitrateScore = (v.video_bitrate || 0) / 1000
    return tierRank * 100000 + hdrBonus + bitrateScore
  }

  private async getAudioBitratesViaFFprobe(filePath: string): Promise<Map<number, number> | null> {
    if (!filePath || !fs.existsSync(filePath)) return null
    try {
      const analyzer = getMediaFileAnalyzer()
      if (!await analyzer.isAvailable()) return null
      const result = await analyzer.analyzeFile(filePath)
      if (!result.success || result.audioTracks.length === 0) return null
      const bitrateMap = new Map<number, number>()
      for (const track of result.audioTracks) {
        if (track.bitrate) bitrateMap.set(track.index, track.bitrate)
      }
      return bitrateMap.size > 0 ? bitrateMap : null
    } catch { return null }
  }
}
