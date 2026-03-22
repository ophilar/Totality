import {
  normalizeVideoCodec,
  normalizeAudioCodec,
  normalizeResolution,
} from '../../services/MediaNormalizer'
import type { MediaMetadata } from '../base/MediaProvider'
import type { MusicArtist, MusicAlbum, MusicTrack, AlbumType } from '../../types/database'
import {
  KodiMovieWithDetails,
  KodiEpisodeWithDetails,
  buildFilePath,
  convertKodiImageUrl as schemaConvertKodiImageUrl,
} from './KodiDatabaseSchema'
import {
  KodiMusicArtistResult,
  KodiMusicAlbumResult,
  KodiMusicSongResult,
  parseTrackNumber,
  buildMusicFilePath,
  guessCodecFromExtension,
} from './KodiMusicDatabaseSchema'
import { isLosslessCodec } from '../base/MusicScannerUtils'

/**
 * KodiMappingUtils
 *
 * Centralized logic for mapping Kodi database records (SQL/RPC)
 * to Totality's internal MediaMetadata and Database types.
 */

export class KodiMappingUtils {
  /**
   * Convert Kodi image URL to a usable URL
   */
  static convertImageUrl(kodiUrl: string | null | undefined, baseUrl?: string): string {
    if (!kodiUrl) return ''

    // If it's already a regular URL, return as-is
    if (kodiUrl.startsWith('http://') || kodiUrl.startsWith('https://')) {
      return kodiUrl
    }

    // For Kodi's image:// URLs via JSON-RPC/Web Server
    if (kodiUrl.startsWith('image://') && baseUrl) {
      const encodedUrl = encodeURIComponent(kodiUrl)
      return `${baseUrl.replace(/\/$/, '')}/image/${encodedUrl}`
    }

    // Use schema-level conversion for local paths
    return schemaConvertKodiImageUrl(kodiUrl) || ''
  }

  /**
   * Map Kodi Movie Result to MediaMetadata
   */
  static mapMovieToMetadata(
    item: KodiMovieWithDetails,
    sourceId: string,
    baseUrl?: string
  ): MediaMetadata {
    const filePath = buildFilePath(item.filepath || '', item.filename || '')

    return {
      providerId: sourceId,
      providerType: 'kodi' as any,
      itemId: String(item.idMovie),
      title: item.title || 'Unknown Movie',
      type: 'movie',
      year: item.year || undefined,
      duration: item.videoDuration ? item.videoDuration * 1000 : undefined,
      posterUrl: this.convertImageUrl(item.posterUrl, baseUrl),
      backdropUrl: this.convertImageUrl(item.fanartUrl, baseUrl),
      filePath,
      resolution: normalizeResolution(item.videoWidth || 0, item.videoHeight || 0),
      videoCodec: normalizeVideoCodec(item.videoCodec || ''),
      width: item.videoWidth || undefined,
      height: item.videoHeight || undefined,
      audioCodec: normalizeAudioCodec(item.audioCodec || ''),
      audioChannels: item.audioChannels || undefined,
    }
  }

  /**
   * Map Kodi Episode Result to MediaMetadata
   */
  static mapEpisodeToMetadata(
    item: KodiEpisodeWithDetails,
    sourceId: string,
    baseUrl?: string
  ): MediaMetadata {
    const filePath = buildFilePath(item.filepath || '', item.filename || '')

    return {
      providerId: sourceId,
      providerType: 'kodi' as any,
      itemId: String(item.idEpisode),
      title: item.title || `Episode ${item.episodeNumber}`,
      type: 'episode',
      seriesTitle: item.showTitle || 'Unknown Series',
      seasonNumber: item.seasonNumber || undefined,
      episodeNumber: item.episodeNumber || undefined,
      duration: item.videoDuration ? item.videoDuration * 1000 : undefined,
      episodeThumbUrl: this.convertImageUrl(item.thumbUrl, baseUrl),
      posterUrl: this.convertImageUrl(item.seasonPosterUrl || item.showPosterUrl, baseUrl),
      seasonPosterUrl: this.convertImageUrl(item.seasonPosterUrl, baseUrl),
      filePath,
      resolution: normalizeResolution(item.videoWidth || 0, item.videoHeight || 0),
      videoCodec: normalizeVideoCodec(item.videoCodec || ''),
      width: item.videoWidth || undefined,
      height: item.videoHeight || undefined,
      audioCodec: normalizeAudioCodec(item.audioCodec || ''),
      audioChannels: item.audioChannels || undefined,
    }
  }

  /**
   * Convert Kodi Music Artist to MusicArtist
   */
  static mapToMusicArtist(item: KodiMusicArtistResult, sourceId: string, sourceType: string, baseUrl?: string): MusicArtist {
    return {
      source_id: sourceId,
      source_type: sourceType as any,
      library_id: 'music',
      provider_id: String(item.idArtist),
      name: item.strArtist,
      sort_name: item.strSortName || undefined,
      musicbrainz_id: item.strMusicBrainzArtistID || undefined,
      genres: item.strGenres || undefined,
      biography: item.strBiography || undefined,
      thumb_url: this.convertImageUrl(item.thumbUrl || '', baseUrl),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Kodi Music Album to MusicAlbum
   */
  static mapToMusicAlbum(item: KodiMusicAlbumResult, sourceId: string, sourceType: string, artistId?: number, baseUrl?: string): MusicAlbum {
    const kodiType = (item.strType || '').toLowerCase()
    let albumType: AlbumType | undefined = undefined
    if (kodiType === 'album') albumType = 'album'
    else if (kodiType === 'ep') albumType = 'ep'
    else if (kodiType === 'single') albumType = 'single'
    else if (kodiType === 'compilation') albumType = 'compilation'
    else if (kodiType === 'live') albumType = 'live'
    else if (kodiType === 'soundtrack') albumType = 'soundtrack'
    else if (kodiType) albumType = 'unknown'

    return {
      source_id: sourceId,
      source_type: sourceType as any,
      library_id: 'music',
      provider_id: String(item.idAlbum),
      artist_id: artistId,
      artist_name: item.strArtistDisp || 'Unknown Artist',
      title: item.strAlbum,
      musicbrainz_id: item.strMusicBrainzAlbumID || undefined,
      musicbrainz_release_group_id: item.strReleaseGroupMBID || undefined,
      genres: item.strGenres || undefined,
      studio: item.strLabel || undefined,
      album_type: albumType,
      thumb_url: this.convertImageUrl(item.thumbUrl || '', baseUrl),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  /**
   * Convert Kodi Music Song to MusicTrack
   */
  static mapToMusicTrack(
    item: KodiMusicSongResult,
    sourceId: string,
    sourceType: string,
    albumId?: number,
    artistId?: number
  ): MusicTrack {
    const { disc, track } = parseTrackNumber(item.iTrack)
    const filePath = buildMusicFilePath(item.strPath, item.strFileName)
    const audioCodec = guessCodecFromExtension(item.strFileName)
    const lossless = isLosslessCodec(audioCodec)

    return {
      source_id: sourceId,
      source_type: sourceType as any,
      library_id: 'music',
      provider_id: String(item.idSong),
      album_id: albumId,
      artist_id: artistId,
      album_name: item.albumTitle || undefined,
      artist_name: item.artistDisp || 'Unknown Artist',
      title: item.strTitle,
      track_number: track,
      disc_number: disc,
      duration: item.iDuration ? item.iDuration * 1000 : undefined,
      file_path: filePath,
      audio_codec: audioCodec,
      is_lossless: lossless,
      musicbrainz_id: item.strMusicBrainzTrackID || undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }
}
