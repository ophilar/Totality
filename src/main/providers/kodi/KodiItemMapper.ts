import * as fs from 'fs'
import {
  normalizeResolution,
  normalizeHdrFormat,
  hasObjectAudio,
} from '../../services/MediaNormalizer'
import {
  estimateAudioBitrate,
} from '../utils/ProviderUtils'
import { getFileNameParser } from '../../services/FileNameParser'
import {
  isLosslessCodec,
  isHiRes,
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
  KodiMovie,
  KodiEpisode,
  KodiMusicArtist,
  KodiMusicAlbum,
  KodiMusicSong,
} from './KodiProvider'
import { KodiRpcClient } from './KodiRpcClient'

export class KodiItemMapper {
  constructor(
    private sourceId: string,
    private client: KodiRpcClient
  ) {}

  convertToMediaMetadata(item: KodiMovie | KodiEpisode, type: 'movie' | 'episode'): MediaMetadata {
    const videoStream = item.streamdetails?.video?.[0]
    const audioStream = item.streamdetails?.audio?.[0]
    const width = videoStream?.width || 0
    const height = videoStream?.height || 0
    const resolution = normalizeResolution(width, height)
    const duration = videoStream?.duration || (item.runtime ? item.runtime * 60 : undefined)

    let posterUrl: string | undefined
    const art = item.art as any
    if (type === 'episode') {
      posterUrl = this.client.buildImageUrl(art?.['tvshow.poster'] || art?.['season.poster'])
    } else {
      posterUrl = this.client.buildImageUrl(art?.poster)
    }

    const audioBitrate = estimateAudioBitrate(audioStream?.codec, audioStream?.channels)

    const isEpisode = type === 'episode'
    const movieItem = item as KodiMovie
    const episodeItem = item as KodiEpisode

    return {
      providerId: this.sourceId,
      providerType: 'kodi',
      itemId: type === 'movie' ? `movie-${movieItem.movieid}` : `episode-${episodeItem.episodeid}`,
      title: item.title,
      type: type,
      year: isEpisode ? undefined : movieItem.year,
      seriesTitle: isEpisode ? episodeItem.showtitle : undefined,
      seasonNumber: isEpisode ? episodeItem.season : undefined,
      episodeNumber: isEpisode ? episodeItem.episode : undefined,
      imdbId: isEpisode ? undefined : movieItem.imdbnumber,
      filePath: item.file,
      fileSize: this.getFileSize(item.file),
      duration,
      resolution,
      width,
      height,
      videoCodec: videoStream?.codec,
      hdrFormat: normalizeHdrFormat(videoStream?.hdrtype, undefined, undefined, undefined, undefined),
      audioCodec: audioStream?.codec,
      audioChannels: audioStream?.channels,
      audioBitrate,
      hasObjectAudio: hasObjectAudio(audioStream?.codec, undefined, item.title, undefined),
      posterUrl,
    }
  }

  async convertToMediaItem(item: KodiMovie | KodiEpisode, type: 'movie' | 'episode'): Promise<{ mediaItem: MediaItem; versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } | null> {
    const videoStream = item.streamdetails?.video?.[0]
    if (!videoStream) return null

    const width = videoStream.width || 0
    const height = videoStream.height || 0
    const resolution = normalizeResolution(width, height)
    const hdrFormat = normalizeHdrFormat(videoStream.hdrtype, undefined, undefined, undefined, undefined) || 'None'
    const duration = videoStream.duration || (item.runtime ? item.runtime * 60 : 0)
    const fileSize = this.getFileSize(item.file)

    const audioTracks: AudioTrack[] = (item.streamdetails?.audio || []).map((stream, index) => ({
      index,
      codec: stream.codec || 'unknown',
      channels: stream.channels || 2,
      language: stream.language,
      bitrate: estimateAudioBitrate(stream.codec, stream.channels),
      hasObjectAudio: hasObjectAudio(stream.codec, undefined, item.title, undefined),
    }))

    const subtitleTracks: SubtitleTrack[] = (item.streamdetails?.subtitle || []).map((stream, index) => ({
      index,
      codec: 'unknown',
      language: stream.language,
    }))

    const filePath = item.file || ''
    const parsed = getFileNameParser().parse(filePath)
    const edition = (parsed?.type === 'movie' ? parsed.edition : undefined) || undefined
    const source = parsed?.type !== 'music' ? parsed?.source : undefined
    const sourceType = source && /remux/i.test(source) ? 'REMUX' : source && /web-dl|webdl/i.test(source) ? 'WEB-DL' : undefined

    const labelParts = [resolution]
    if (hdrFormat !== 'None') labelParts.push(hdrFormat)
    if (sourceType) labelParts.push(sourceType)
    if (edition) labelParts.push(edition)

    const isEpisode = type === 'episode'
    const movieItem = item as KodiMovie
    const episodeItem = item as KodiEpisode

    const version: Omit<MediaItemVersion, 'id' | 'media_item_id'> = {
      version_source: `kodi_${type}_${type === 'movie' ? movieItem.movieid : episodeItem.episodeid}`,
      edition,
      source_type: sourceType,
      label: labelParts.join(' '),
      file_path: item.file,
      file_size: fileSize,
      duration,
      resolution,
      width,
      height,
      video_codec: videoStream.codec || 'unknown',
      video_bitrate: 0,
      audio_codec: audioTracks[0]?.codec,
      audio_channels: audioTracks[0]?.channels,
      audio_bitrate: audioTracks[0]?.bitrate,
      hdr_format: hdrFormat,
      has_object_audio: audioTracks[0]?.hasObjectAudio,
      audio_tracks: JSON.stringify(audioTracks),
      subtitle_tracks: subtitleTracks.length > 0 ? JSON.stringify(subtitleTracks) : undefined,
    }

    const mediaItem: MediaItem = {
      plex_id: type === 'movie' ? `movie-${movieItem.movieid}` : `episode-${episodeItem.episodeid}`,
      title: item.title,
      year: isEpisode ? undefined : movieItem.year,
      type: type,
      series_title: isEpisode ? episodeItem.showtitle : undefined,
      season_number: isEpisode ? episodeItem.season : undefined,
      episode_number: isEpisode ? episodeItem.episode : undefined,
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
      audio_bitrate: version.audio_bitrate,
      hdr_format: version.hdr_format,
      has_object_audio: version.has_object_audio,
      audio_tracks: version.audio_tracks,
      subtitle_tracks: version.subtitle_tracks,
      version_count: 1,
      imdb_id: isEpisode ? undefined : movieItem.imdbnumber,
      poster_url: isEpisode ? this.client.buildImageUrl((item.art as any)?.['tvshow.poster'] || (item.art as any)?.['season.poster']) : this.client.buildImageUrl((item.art as any)?.poster),
      episode_thumb_url: isEpisode ? this.client.buildImageUrl((item.art as any)?.thumb) : undefined,
      season_poster_url: isEpisode ? this.client.buildImageUrl((item.art as any)?.['season.poster']) : undefined,
      summary: item.plot,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    return { mediaItem, versions: [version] }
  }

  convertToMusicArtist(item: KodiMusicArtist, libraryId?: string): MusicArtist {
    return {
      source_id: this.sourceId,
      source_type: 'kodi',
      library_id: libraryId,
      provider_id: `artist-${item.artistid}`,
      name: item.artist,
      musicbrainz_id: item.musicbrainzartistid,
      genres: item.genre ? JSON.stringify(item.genre) : undefined,
      biography: item.description,
      thumb_url: item.thumbnail ? this.client.buildImageUrl(item.thumbnail) : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  convertToMusicAlbum(item: KodiMusicAlbum, artistId?: number, libraryId?: string): MusicAlbum {
    return {
      source_id: this.sourceId,
      source_type: 'kodi',
      library_id: libraryId,
      provider_id: `album-${item.albumid}`,
      artist_id: artistId,
      artist_name: item.displayartist || (item.artist && item.artist[0]) || 'Unknown Artist',
      title: item.title,
      year: item.year,
      musicbrainz_id: item.musicbrainzalbumid,
      genres: item.genre ? JSON.stringify(item.genre) : undefined,
      thumb_url: item.thumbnail ? this.client.buildImageUrl(item.thumbnail) : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  convertToMusicTrack(item: KodiMusicSong, albumId?: number, artistId?: number, libraryId?: string): MusicTrack | null {
    const audioCodec = item.audio_codec || 'unknown'
    const lossless = isLosslessCodec(audioCodec)

    return {
      source_id: this.sourceId,
      source_type: 'kodi',
      library_id: libraryId,
      provider_id: `song-${item.songid}`,
      album_id: albumId,
      artist_id: artistId,
      album_name: item.album,
      artist_name: item.displayartist || (item.artist && item.artist[0]) || 'Unknown Artist',
      title: item.title,
      track_number: item.track,
      disc_number: item.disc || 1,
      duration: item.duration ? item.duration * 1000 : undefined,
      file_path: item.file,
      file_size: this.getFileSize(item.file),
      audio_codec: audioCodec,
      is_lossless: lossless,
      is_hi_res: isHiRes(item.samplerate, item.bitdepth, lossless),
      musicbrainz_id: item.musicbrainztrackid,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private getFileSize(filePath?: string): number {
    if (!filePath) return 0
    try {
      if (fs.existsSync(filePath)) {
        return fs.statSync(filePath).size
      }
    } catch { /* ignore */ }
    return 0
  }
}
