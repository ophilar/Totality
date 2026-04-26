import { getErrorMessage } from '../../services/utils/errorUtils'
import { getLoggingService } from '../../services/LoggingService'
import axios, { AxiosInstance } from 'axios'
import { getDatabase } from '../../database/getDatabase'
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
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import {
  BaseMediaProvider,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  ProgressCallback,
  SourceConfig,
  ProviderType,
  LibraryType,
} from '../base/MediaProvider'

import type {
  PlexAuthPin,
  PlexServer,
  PlexLibrary,
  PlexMediaItem,
  PlexMusicArtist,
  PlexMusicAlbum,
  PlexMusicTrack,
  PlexResource,
} from '../../types/plex'
import type { MediaItem, MediaItemVersion, AudioTrack, SubtitleTrack, MusicArtist, MusicAlbum, MusicTrack } from '../../types/database'

export interface PlexCollection {
  key: string
  title: string
  type: string
  childCount?: number
}

const PLEX_API_URL = 'https://plex.tv/api/v2'
const PLEX_TV_URL = 'https://plex.tv'
const CLIENT_IDENTIFIER = 'totality'
const PRODUCT_NAME = 'Totality'

function getReliableVideoBitrate(
  videoStreamBitrate: number | undefined,
  mediaBitrate: number | undefined,
  audioStreams: Array<{ bitrate?: number }>
): number {
  const overall = mediaBitrate || 0
  const audioBitrateSum = audioStreams.reduce((sum, s) => sum + (s.bitrate || 0), 0)
  const calculated = Math.max(0, overall - audioBitrateSum)

  if (videoStreamBitrate && overall > 0 && videoStreamBitrate >= overall * 0.3) {
    return videoStreamBitrate
  }
  if (videoStreamBitrate && !overall) {
    return videoStreamBitrate
  }
  return calculated || overall
}

export class PlexProvider extends BaseMediaProvider {
  readonly providerType: ProviderType = 'plex' as ProviderType

  private authToken: string | null = null
  private selectedServer: PlexServer | null = null
  private api: AxiosInstance

  private scanCancelled = false
  private musicScanCancelled = false
  private warnedSkippedItems = new Set<string>()

  constructor(config: SourceConfig) {
    super(config)

    this.api = axios.create({
      headers: {
        'X-Plex-Client-Identifier': CLIENT_IDENTIFIER,
        'X-Plex-Product': PRODUCT_NAME,
        'X-Plex-Version': '1.0.0',
        'X-Plex-Platform': 'Windows',
        Accept: 'application/json',
      },
    })

    if (config.connectionConfig?.token) {
      this.authToken = config.connectionConfig.token
    }
  }

  async requestAuthPin(): Promise<PlexAuthPin> {
    try {
      const response = await this.api.post(`${PLEX_API_URL}/pins`, {
        strong: true,
      })
      return response.data as PlexAuthPin
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to request auth PIN:', error)
      throw new Error('Failed to initiate Plex authentication')
    }
  }

  getAuthUrl(_pinId: number, code: string): string {
    return `https://app.plex.tv/auth#?clientID=${CLIENT_IDENTIFIER}&code=${code}&context[device][product]=${PRODUCT_NAME}`
  }

  async checkAuthPin(pinId: number): Promise<string | null> {
    try {
      const response = await this.api.get(`${PLEX_API_URL}/pins/${pinId}`)
      const pin = response.data as PlexAuthPin

      if (pin.authToken) {
        this.authToken = pin.authToken
        return pin.authToken
      }

      return null
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to check auth PIN:', error)
      return null
    }
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      if (credentials.token) {
        const response = await this.api.get(`${PLEX_TV_URL}/users/account`, {
          headers: {
            'X-Plex-Token': credentials.token,
          },
        })

        if (response.data) {
          this.authToken = credentials.token
          return {
            success: true,
            token: credentials.token,
            userName: response.data.username || response.data.title,
          }
        }
      }

      return {
        success: false,
        error: 'Invalid or missing token',
      }
    } catch (error: unknown) {
      getLoggingService().error('[PlexProvider]', 'Plex authentication failed:', error)
      return {
        success: false,
        error: getErrorMessage(error) || 'Authentication failed',
      }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return this.authToken !== null
  }

  async disconnect(): Promise<void> {
    this.authToken = null
    this.selectedServer = null
  }

  async discoverServers(): Promise<ServerInstance[]> {
    if (!this.authToken) {
      throw new Error('Not authenticated')
    }

    try {
      const response = await this.api.get(`${PLEX_API_URL}/resources`, {
        headers: {
          'X-Plex-Token': this.authToken,
        },
        params: {
          includeHttps: 1,
          includeRelay: 1,
        },
      })

      const resources: PlexResource[] = Array.isArray(response.data) ? response.data : []
      const servers = resources.filter((r) => r.provides === 'server')

      return servers.map((server) => {
        const localHttp = server.connections?.find((c) => c.local && c.protocol === 'http')
        const preferredConnection = localHttp || server.connections?.[0]

        return {
          id: server.clientIdentifier,
          name: server.name,
          address: preferredConnection?.address || server.publicAddress || '',
          port: preferredConnection?.port || 32400,
          version: server.productVersion,
          isLocal: preferredConnection?.local || false,
          isOwned: server.owned === true || server.owned === 1,
          protocol: preferredConnection?.protocol || 'https',
        }
      })
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to discover servers:', error)
      throw new Error('Failed to discover Plex servers')
    }
  }

  async selectServer(serverId: string): Promise<boolean> {
    if (!this.authToken) {
      throw new Error('Not authenticated')
    }

    try {
      const response = await this.api.get(`${PLEX_API_URL}/resources`, {
        headers: {
          'X-Plex-Token': this.authToken,
        },
        params: {
          includeHttps: 1,
        },
      })

      const resources: PlexResource[] = Array.isArray(response.data) ? response.data : []
      const server = resources.find((r) => r.clientIdentifier === serverId)

      if (server) {
        const localConn = server.connections?.find((c) => c.local)
        const remoteConn = server.connections?.find((c) => !c.local)
        const connection = localConn || remoteConn

        if (!connection) {
          throw new Error(`No valid connections found for server: ${server.name}`)
        }

        this.selectedServer = {
          host: connection.address,
          scheme: connection.protocol as 'http' | 'https',
          machineIdentifier: server.clientIdentifier,
          version: server.productVersion,
          address: connection.address,
          name: server.name,
          uri: connection.uri,
          port: connection.port,
          accessToken: server.accessToken || this.authToken || '',
          owned: (server.owned === true || server.owned === 1),
        }

        this.config.connectionConfig = {
          ...this.config.connectionConfig,
          serverId: server.clientIdentifier,
          token: this.authToken,
        }

        return true
      }

      return false
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to select server:', error)
      return false
    }
  }

  getSelectedServer(): PlexServer | null {
    return this.selectedServer
  }

  hasSelectedServer(): boolean {
    return this.selectedServer !== null
  }

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.selectedServer) {
      return { success: false, error: 'No server selected' }
    }

    try {
      const response = await this.api.get(`${this.selectedServer.uri}/identity`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
        timeout: 5000,
      })

      if (response.status === 200) {
        return {
          success: true,
          serverVersion: this.selectedServer.version,
        }
      }

      return { success: false, error: `Server returned status ${response.status}` }
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'Connection failed',
      }
    }
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    try {
      const response = await this.api.get(`${this.selectedServer.uri}/library/sections`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })

      const sections: PlexLibrary[] = response.data.MediaContainer?.Directory || []
      return sections
        .filter((s) => s.type === 'movie' || s.type === 'show' || s.type === 'artist')
        .map((s) => ({
          id: s.key,
          name: s.title,
          type: s.type === 'show' ? LibraryType.Show : (s.type === 'artist' ? LibraryType.Music : LibraryType.Movie),
          collectionType: s.type,
          itemCount: s.count,
        }))
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to get libraries:', error)
      return []
    }
  }

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    if (!this.selectedServer) {
      throw new Error('No server selected')
    }

    const startTime = Date.now()
    this.scanCancelled = false
    const result: ScanResult = {
      success: false,
      itemsScanned: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      errors: [],
      durationMs: 0,
    }

    try {
      const db = getDatabase()
      const url = `${this.selectedServer.uri}/library/sections/${libraryId}/all`
      const params: Record<string, unknown> = {}

      getLoggingService().info('[PlexProvider]', `Fetching items for library ${libraryId}...`)
      const items = await this.paginatedPlexFetch<PlexMediaItem>(url, params)
      const totalItems = items.length
      getLoggingService().info('[PlexProvider]', `Retrieved ${totalItems} items from Plex`)

      if (options?.forceFullScan || !options?.sinceTimestamp) {
        getLoggingService().info('[PlexProvider]', `Reconciling library ${libraryId}...`)
        const existingPlexIds = items.map((item: any) => item.ratingKey)
        const libraryInfo = (await this.getLibraries()).find(l => l.id === libraryId)
        const type = libraryInfo?.type === LibraryType.Show ? 'episode' : 'movie'
        
        const removed = db.media.removeStaleMediaItems(new Set(existingPlexIds), type as 'movie' | 'episode')
        result.itemsRemoved = removed
        getLoggingService().info('[PlexProvider]', `Reconciling ${type}s: ${totalItems} in Plex, removed ${removed} stale items from DB`)
      }

      let scanned = 0
      const BATCH_SIZE = 10
      const COMMIT_INTERVAL = 25

      try {
        for (let i = 0; i < totalItems; i += BATCH_SIZE) {
          if (this.scanCancelled) {
            getLoggingService().info('[PlexProvider]', `Scan cancelled at ${scanned}/${totalItems}`)
            result.cancelled = true
            break
          }

          if (scanned % COMMIT_INTERVAL === 0 || i === 0) {
            db.startBatch()
          }

          const batch = items.slice(i, i + BATCH_SIZE)
          for (const plexItem of batch) {
            try {
              if (plexItem.type === 'show') {
                const episodes = await this.getShowEpisodes(plexItem.ratingKey)
                for (const ep of episodes) {
                  await this.processPlexItem(ep, db)
                  result.itemsScanned++
                }
              } else {
                await this.processPlexItem(plexItem, db)
                result.itemsScanned++
              }

              scanned++
              if (options?.onProgress && scanned % 5 === 0) {
                options.onProgress({
                  current: scanned,
                  total: totalItems,
                  phase: 'processing',
                  percentage: Math.round((scanned / totalItems) * 100),
                  currentItem: plexItem.title
                })
              }
            } catch (err) {
              result.errors.push(`Failed to process ${plexItem.title}: ${getErrorMessage(err)}`)
            }

            if (scanned % COMMIT_INTERVAL === 0) {
              db.endBatch()
              await new Promise(r => setTimeout(r, 10))
              if (scanned < totalItems) db.startBatch()
            }
          }
        }
      } finally {
        if (db.isInTransaction()) {
          try { db.endBatch() } catch { /* ignore */ }
        }
      }

      result.success = true
      result.durationMs = Date.now() - startTime
      return result
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Scan failed:', error)
      result.errors.push(getErrorMessage(error))
      result.durationMs = Date.now() - startTime
      return result
    }
  }

  private async processPlexItem(plexItem: PlexMediaItem, db: any): Promise<void> {
    const detail = await this.getItemMetadataDetailed(plexItem.ratingKey)
    if (!detail) return

    const mapped = this.convertToMediaItem(detail)
    if (!mapped) return

    const mediaId = db.media.upsertItem({
      ...mapped.mediaItem,
      source_id: this.sourceId
    })

    db.media.syncItemVersions(mediaId, mapped.versions.map(v => ({ ...v, media_item_id: mediaId })))
    db.media.updateBestVersion(mediaId)

    const score = await getQualityAnalyzer().analyzeMediaItem(mapped.mediaItem)
    db.media.upsertQualityScore(score)
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    const detail = await this.getItemMetadataDetailed(itemId)
    if (!detail) throw new Error(`Item not found: ${itemId}`)

    const mapped = this.convertToMediaItem(detail)
    if (!mapped) throw new Error(`Unsupported item type: ${detail.type}`)

    return {
      providerId: itemId,
      providerType: 'plex',
      itemId,
      title: detail.title,
      type: detail.type === 'episode' ? 'episode' : 'movie',
      year: detail.year,
      filePath: mapped.mediaItem.file_path,
    }
  }

  private async getItemMetadataDetailed(ratingKey: string): Promise<PlexMediaItem | null> {
    if (!this.selectedServer) return null
    try {
      const response = await this.api.get(`${this.selectedServer.uri}/library/metadata/${ratingKey}`, {
        headers: {
          'X-Plex-Token': this.selectedServer.accessToken,
        },
      })
      return response.data.MediaContainer?.Metadata?.[0] || null
    } catch (error) {
      getLoggingService().error('[PlexProvider]', `Failed to get metadata for ${ratingKey}:`, error)
      return null
    }
  }

  private async getShowEpisodes(showKey: string): Promise<PlexMediaItem[]> {
    if (!this.selectedServer) return []
    const url = `${this.selectedServer.uri}/library/metadata/${showKey}/allLeaves`
    return this.paginatedPlexFetch<PlexMediaItem>(url)
  }

  private async paginatedPlexFetch<T>(url: string, params: Record<string, unknown> = {}): Promise<T[]> {
    if (!this.selectedServer) return []
    const allItems: T[] = []
    let offset = 0
    const limit = 500
    while (true) {
      const response = await this.api.get(url, {
        headers: { 'X-Plex-Token': this.selectedServer.accessToken },
        params: { ...params, 'X-Plex-Container-Start': offset, 'X-Plex-Container-Size': limit },
      })
      const container = response.data.MediaContainer
      const items = container?.Metadata || container?.Directory || []
      allItems.push(...items)
      if (!items.length || allItems.length >= (container?.totalSize || container?.size || 0)) break
      offset += items.length
    }
    return allItems
  }

  private convertToMediaItem(item: PlexMediaItem, showTmdbId?: string, showTitleSort?: string): { mediaItem: MediaItem; versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] } | null {
    const allMedia = item.Media || []
    if (allMedia.length === 0) return null

    type VersionData = Omit<MediaItemVersion, 'id' | 'media_item_id'>
    const versions: VersionData[] = []

    for (const media of allMedia) {
      const part = media.Part?.[0]
      if (!part) continue

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
        video_bitrate: normalizeBitrate(getReliableVideoBitrate(videoStream.bitrate, media.bitrate, audioStreams), 'kbps'),
        audio_codec: normalizeAudioCodec(media.audioCodec, audioStream?.profile),
        audio_channels: normalizeAudioChannels(media.audioChannels, audioStream.audioChannelLayout),
        audio_bitrate: normalizeBitrate(audioStream.bitrate, 'kbps'),
        video_frame_rate: normalizeFrameRate(videoStream.frameRate),
        color_bit_depth: videoStream.bitDepth,
        hdr_format: hdrFormat,
        color_space: videoStream.colorSpace,
        video_profile: videoStream.profile,
        video_level: videoStream.level,
        audio_profile: audioStream.profile,
        audio_sample_rate: normalizeSampleRate(audioStream.samplingRate),
        has_object_audio: hasObjectAudio(audioStream.codec, audioStream.profile, audioStream.displayTitle || audioStream.title, audioStream.audioChannelLayout),
        audio_tracks: JSON.stringify(audioTracks),
        subtitle_tracks: subtitleTracks.length > 0 ? JSON.stringify(subtitleTracks) : undefined,
        container: normalizeContainer(part.container || media.container),
      })
    }

    if (versions.length === 0) return null
    if (versions.length > 1) extractVersionNames(versions)
    const best = versions.reduce((a, b) => this.calculateVersionScore(b) > this.calculateVersionScore(a) ? b : a)

    let imdbId, tmdbId
    if (item.Guid) {
      for (const guid of item.Guid) {
        if (guid.id.includes('imdb://')) imdbId = guid.id.replace('imdb://', '')
        else if (guid.id.includes('tmdb://')) tmdbId = guid.id.replace('tmdb://', '').split('?')[0]
      }
    }

    let posterUrl, episodeThumbUrl, seasonPosterUrl
    if (this.selectedServer) {
      if (item.thumb) {
        const thumbPath = item.type === 'episode' && item.grandparentThumb ? item.grandparentThumb : item.thumb
        posterUrl = `${this.selectedServer.uri}${thumbPath}?X-Plex-Token=${this.selectedServer.accessToken}`
      }
      if (item.type === 'episode') {
        if (item.thumb) episodeThumbUrl = `${this.selectedServer.uri}${item.thumb}?X-Plex-Token=${this.selectedServer.accessToken}`
        if (item.parentThumb) seasonPosterUrl = `${this.selectedServer.uri}${item.parentThumb}?X-Plex-Token=${this.selectedServer.accessToken}`
      }
    }

    return {
      mediaItem: {
        plex_id: item.ratingKey,
        title: item.title,
        sort_title: item.type === 'episode' ? (showTitleSort || undefined) : (item.titleSort || undefined),
        year: item.year,
        type: item.type as 'movie' | 'episode',
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
        series_tmdb_id: showTmdbId || undefined,
        poster_url: posterUrl,
        episode_thumb_url: episodeThumbUrl,
        season_poster_url: seasonPosterUrl,
        summary: item.summary || undefined,
      } as MediaItem,
      versions: versions.map(v => ({ ...v, media_item_id: 0 })) as any,
    }
  }

  async getMusicArtists(libraryKey: string): Promise<PlexMusicArtist[]> {
    if (!this.selectedServer) throw new Error('No server selected')
    const url = `${this.selectedServer.uri}/library/sections/${libraryKey}/all`
    return await this.paginatedPlexFetch<PlexMusicArtist>(url, { type: 8 })
  }

  async getMusicAlbums(libraryKey: string, artistKey?: string): Promise<PlexMusicAlbum[]> {
    if (!this.selectedServer) throw new Error('No server selected')
    if (artistKey) {
      const url = `${this.selectedServer.uri}/library/metadata/${artistKey}/children`
      const response = await this.api.get(url, { headers: { 'X-Plex-Token': this.selectedServer.accessToken } })
      return response.data?.MediaContainer?.Metadata || []
    } else {
      const url = `${this.selectedServer.uri}/library/sections/${libraryKey}/all`
      return await this.paginatedPlexFetch<PlexMusicAlbum>(url, { type: 9 })
    }
  }

  async getMusicTracks(albumKey: string): Promise<PlexMusicTrack[]> {
    if (!this.selectedServer) throw new Error('No server selected')
    const url = `${this.selectedServer.uri}/library/metadata/${albumKey}/children`
    const response = await this.api.get(url, { headers: { 'X-Plex-Token': this.selectedServer.accessToken } })
    const tracks = response.data?.MediaContainer?.Metadata || []
    if (tracks.length > 0 && !tracks[0].Media) {
       const detailed: PlexMusicTrack[] = []
       for (const t of tracks) {
         const d = await this.api.get(`${this.selectedServer.uri}/library/metadata/${t.ratingKey}`, { headers: { 'X-Plex-Token': this.selectedServer.accessToken } })
         if (d.data?.MediaContainer?.Metadata?.[0]) detailed.push(d.data.MediaContainer.Metadata[0])
       }
       return detailed
    }
    return tracks
  }

  async scanMusicLibrary(libraryId: string, onProgress?: ProgressCallback): Promise<ScanResult> {
    this.musicScanCancelled = false
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    try {
      const db = getDatabase()
      const artists = await this.getMusicArtists(libraryId)
      const totalArtists = artists.length
      let processed = 0
      for (const plexArtist of artists) {
        if (this.musicScanCancelled) { result.cancelled = true; break }
        try {
          const artistId = await db.music.upsertArtist(this.convertToMusicArtist(plexArtist, libraryId))
          const albums = await this.getMusicAlbums(libraryId, plexArtist.ratingKey)
          for (const plexAlbum of albums) {
            const albumData = this.convertToMusicAlbum(plexAlbum, artistId, libraryId)
            const tracks = await this.getMusicTracks(plexAlbum.ratingKey)
            albumData.track_count = tracks.length
            const albumId = await db.music.upsertAlbum(albumData)
            for (const plexTrack of tracks) {
              const trackData = this.convertToMusicTrack(plexTrack, albumId, artistId, libraryId)
              if (trackData) { await db.music.upsertTrack(trackData); result.itemsScanned++ }
            }
          }
          processed++
          if (onProgress) onProgress({ current: processed, total: totalArtists, phase: 'processing', percentage: (processed / totalArtists) * 100, currentItem: plexArtist.title })
        } catch (err) { result.errors.push(`Artist ${plexArtist.title}: ${getErrorMessage(err)}`) }
      }
      result.success = true
    } catch (err) { result.errors.push(getErrorMessage(err)) }
    result.durationMs = Date.now() - startTime
    return result
  }

  private convertToMusicArtist(item: PlexMusicArtist, libraryId: string): MusicArtist {
    return {
      source_id: this.sourceId,
      source_type: 'plex',
      library_id: libraryId,
      provider_id: item.ratingKey,
      name: item.title,
      genres: JSON.stringify(item.Genre?.map(g => g.tag) || []),
      thumb_url: item.thumb ? `${this.selectedServer?.uri}${item.thumb}?X-Plex-Token=${this.selectedServer?.accessToken}` : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private convertToMusicAlbum(item: PlexMusicAlbum, artistId: number, libraryId: string): MusicAlbum {
    return {
      source_id: this.sourceId,
      source_type: 'plex',
      library_id: libraryId,
      provider_id: item.ratingKey,
      artist_id: artistId,
      artist_name: item.parentTitle || 'Unknown Artist',
      title: item.title,
      year: item.year,
      thumb_url: item.thumb ? `${this.selectedServer?.uri}${item.thumb}?X-Plex-Token=${this.selectedServer?.accessToken}` : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  private convertToMusicTrack(item: PlexMusicTrack, albumId: number, artistId: number, libraryId: string): MusicTrack | null {
    const media = item.Media?.[0]
    const part = media?.Part?.[0]
    if (!media || !part) return null
    return {
      source_id: this.sourceId,
      source_type: 'plex',
      library_id: libraryId,
      provider_id: item.ratingKey,
      album_id: albumId,
      artist_id: artistId,
      album_name: item.parentTitle,
      artist_name: item.grandparentTitle || 'Unknown Artist',
      title: item.title,
      track_number: item.index,
      disc_number: item.parentIndex || 1,
      duration: item.duration,
      file_path: part.file,
      file_size: part.size,
      container: media.container,
      audio_codec: media.audioCodec || 'unknown',
      audio_bitrate: media.bitrate,
      channels: media.audioChannels,
      is_lossless: ['flac', 'alac', 'wav', 'dsd'].some(c => (media.audioCodec || '').toLowerCase().includes(c)),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  cancelScan(): void { this.scanCancelled = true }
  cancelMusicScan(): void { this.musicScanCancelled = true }
  isScanCancelled(): boolean { return this.scanCancelled }
  isMusicScanCancelled(): boolean { return this.musicScanCancelled }
  setAuthToken(token: string): void { this.authToken = token }
  setSelectedServer(server: PlexServer): void {
    this.selectedServer = server
    // @ts-ignore
    this.config.connectionConfig = { ...this.config.connectionConfig, serverId: server.machineIdentifier, token: this.authToken || '' }
  }

  private calculateVersionScore(v: VersionData): number {
    let score = 0
    if (v.resolution === '4K') score += 1000
    else if (v.resolution === '1080p') score += 500
    if (v.hdr_format && v.hdr_format !== 'None') score += 200
    score += (v.video_bitrate || 0) / 1000
    return score
  }
}
