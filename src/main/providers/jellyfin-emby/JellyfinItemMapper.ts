import { MediaTransformer, IncompleteMetadataError } from '@main/providers/base/MediaTransformer'
import {
  normalizeBitrate,
} from '@main/services/MediaNormalizer'
import {
  isLosslessCodec,
  isHiRes,
  extractMusicBrainzId,
  MUSICBRAINZ_ARTIST_KEYS,
  MUSICBRAINZ_ALBUM_KEYS,
  MUSICBRAINZ_TRACK_KEYS,
} from '@main/providers/base/MusicScannerUtils'
import type {
  MediaMetadata,
} from '@main/providers/base/MediaProvider'
import { LibraryType, ProviderType, MediaItemType } from '@main/types/database'
import type {
  MediaItem,
  MediaItemVersion,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
} from '@main/types/database'
import type { JellyfinMediaItem, JellyfinMusicArtist, JellyfinMusicAlbum, JellyfinMusicTrack } from '@main/providers/jellyfin-emby/JellyfinTypes'
import { JellyfinApiClient } from '@main/providers/jellyfin-emby/JellyfinApiClient'
import { getLoggingService } from '@main/services/LoggingService'

export class JellyfinItemMapper {
  constructor(
    private sourceId: string,
    private providerType: ProviderType,
    private client: JellyfinApiClient
  ) {}

  mapLibraryType(collectionType?: string): LibraryType {
    switch (collectionType) {
      case 'movies':
      case 'homevideos':
      case 'musicvideos':
      case 'boxsets':
        return LibraryType.Movie
      case 'tvshows':
        return LibraryType.Show
      case 'music':
        return LibraryType.Music
      default:
        return LibraryType.Unknown
    }
  }

  convertToMediaMetadata(item: JellyfinMediaItem): MediaMetadata {
    try {
      const { mediaItem } = MediaTransformer.fromJellyfin(item, this.sourceId, this.providerType, (id, t, tag) => this.client.buildImageUrl(id, t, tag))
      return {
        providerId: this.sourceId,
        providerType: this.providerType,
        itemId: item.Id,
        title: item.Name,
        type: mediaItem.type,
        year: item.ProductionYear,
        filePath: mediaItem.file_path,
        resolution: mediaItem.resolution,
        videoCodec: mediaItem.video_codec,
        audioCodec: mediaItem.audio_codec,
        audioChannels: mediaItem.audio_channels,
        audioBitrate: mediaItem.audio_bitrate,
        posterUrl: mediaItem.poster_url,
        imdbId: mediaItem.imdb_id,
        tmdbId: mediaItem.tmdb_id ? parseInt(mediaItem.tmdb_id, 10) : undefined,
      }
    } catch (error) {
      if (error instanceof IncompleteMetadataError) {
        return {
          providerId: this.sourceId,
          providerType: this.providerType,
          itemId: item.Id,
          title: item.Name,
          type: item.Type === 'Episode' ? MediaItemType.Episode : MediaItemType.Movie,
          year: item.ProductionYear,
        }
      }
      throw error
    }
  }

  async convertToMediaItem(item: JellyfinMediaItem): Promise<{ mediaItem: MediaItem; versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } | null> {
    try {
      return MediaTransformer.fromJellyfin(item, this.sourceId, this.providerType, (id, t, tag) => this.client.buildImageUrl(id, t, tag))
    } catch (error) {
      if (error instanceof IncompleteMetadataError) {
        getLoggingService().warn('[JellyfinItemMapper]', error.message)
      } else {
        getLoggingService().error('[JellyfinItemMapper]', 'Transformation error:', error)
      }
      return null
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

  groupMovieVersions(items: JellyfinMediaItem[], libraryType: LibraryType): JellyfinMediaItem[][] {
    if (libraryType === LibraryType.Show) return items.map(item => [item])
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
}
