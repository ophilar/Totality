import { MediaTransformer, IncompleteMetadataError } from '@main/providers/base/MediaTransformer'
import { MediaItemType } from '@main/types/database'
import type { MediaMetadata } from '@main/providers/base/MediaProvider'
import type { KodiMovie, KodiEpisode, KodiMusicArtist, KodiMusicAlbum, KodiMusicSong } from '@main/providers/kodi/KodiProvider'
import { KodiRpcClient } from '@main/providers/kodi/KodiRpcClient'
import { getLoggingService } from '@main/services/LoggingService'
import { isLosslessCodec, isHiRes } from '@main/providers/base/MusicScannerUtils'
import { MediaItem, MediaItemVersion, MusicArtist, MusicAlbum, MusicTrack, ProviderType } from '@main/types/database'
import * as fs from 'fs'

export class KodiItemMapper {
  constructor(
    private sourceId: string,
    private client: KodiRpcClient
  ) {}

  convertToMediaMetadata(item: KodiMovie | KodiEpisode, type: MediaItemType): MediaMetadata {
    try {
      const { mediaItem } = MediaTransformer.fromKodi(item as any, this.sourceId, type, (url) => this.client.buildImageUrl(url))
      return {
        providerId: this.sourceId,
        providerType: ProviderType.Kodi,
        itemId: mediaItem.plex_id || '',
        title: item.title,
        type: mediaItem.type,
        year: 'year' in item ? item.year : undefined,
        filePath: mediaItem.file_path,
        resolution: mediaItem.resolution,
        videoCodec: mediaItem.video_codec,
        audioCodec: mediaItem.audio_codec,
        audioChannels: mediaItem.audio_channels,
        audioBitrate: mediaItem.audio_bitrate,
        posterUrl: mediaItem.poster_url,
        imdbId: mediaItem.imdb_id,
      }
    } catch (error) {
      if (error instanceof IncompleteMetadataError) {
        return {
          providerId: this.sourceId,
          providerType: ProviderType.Kodi,
          itemId: type === MediaItemType.Movie ? `movie-${(item as KodiMovie).movieid}` : `episode-${(item as KodiEpisode).episodeid}`,
          title: item.title,
          type,
        }
      }
      throw error
    }
  }

  async convertToMediaItem(item: KodiMovie | KodiEpisode, type: MediaItemType): Promise<{ mediaItem: MediaItem; versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } | null> {
    try {
      return MediaTransformer.fromKodi(item as any, this.sourceId, type, (url) => this.client.buildImageUrl(url))
    } catch (error) {
      if (error instanceof IncompleteMetadataError) {
        getLoggingService().warn('[KodiItemMapper]', error.message)
      } else {
        getLoggingService().error('[KodiItemMapper]', 'Transformation error:', error)
      }
      return null
    }
  }

  convertToMusicArtist(item: KodiMusicArtist, libraryId?: string): MusicArtist {
    return {
      source_id: this.sourceId,
      source_type: ProviderType.Kodi,
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
      source_type: ProviderType.Kodi,
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
      source_type: ProviderType.Kodi,
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
