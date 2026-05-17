import { getErrorMessage } from '@main/services/utils/errorUtils'
import { getLoggingService } from '@main/services/LoggingService'
import axios, { AxiosInstance } from 'axios'
import { app } from 'electron'
import { getDatabase } from '@main/database/BetterSQLiteService'
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
} from '@main/services/MediaNormalizer'
import { selectBestAudioTrack } from '@main/providers/utils/ProviderUtils'
import { getFileNameParser } from '@main/services/FileNameParser'
import { extractVersionNames } from '@main/providers/utils/VersionNaming'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { MediaTransformer } from '@main/providers/base/MediaTransformer'
import {
  BaseMediaProvider,
  ProviderCredentials,
  AuthResult,
  MediaLibrary,
  ScanOptions,
  ScanResult,
  MediaMetadata,
  SourceConfig,
  ServerInstance,
  ProgressCallback,
} from '@main/providers/base/MediaProvider'
import { LibraryType, ProviderType, MediaItemType } from '@main/types/database'
import type { ConnectionTestResult } from '@main/types/ipc'


import type {
  PlexAuthPin,
  PlexServer,
  PlexLibrary,
  PlexMediaItem,
  PlexMusicArtist,
  PlexMusicAlbum,
  PlexMusicTrack,
  PlexResource,
} from '@main/types/plex'
import type { MediaItem, MediaItemVersion, AudioTrack, SubtitleTrack, MusicArtist, MusicAlbum, MusicTrack } from '@main/types/database'

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
  readonly providerType: ProviderType = ProviderType.Plex

  private authToken: string | null = null
  private selectedServer: PlexServer | null = null
  private api: AxiosInstance

  private scanCancelled = false
  private musicScanCancelled = false

  private get plexApiUrl(): string {
    return (this.config.connectionConfig as any)?.plexApiUrl || 'https://plex.tv/api/v2'
  }

  constructor(config: SourceConfig) {
    super(config)

    this.api = axios.create({
      timeout: 30000,
      headers: {
        'X-Plex-Client-Identifier': CLIENT_IDENTIFIER,
        'X-Plex-Product': PRODUCT_NAME,
        'X-Plex-Version': app.getVersion(),
        'X-Plex-Platform': process.platform === 'win32' ? 'Windows' : 'macOS',
        Accept: 'application/json',
      },
    })

    if (config.connectionConfig?.token) {
      this.authToken = config.connectionConfig.token
    }
  }

  async requestAuthPin(): Promise<PlexAuthPin> {
    try {
      const response = await this.api.post(`${this.plexApiUrl}/pins`, {
        strong: true,
      })
      return response.data as PlexAuthPin
    } catch (error) {
      getLoggingService().error('[PlexProvider]', 'Failed to request auth PIN:', error)
      throw new Error('Failed to initiate Plex authentication')
    }
  }

  getAuthUrl(_pinId: number, code: string): string {
    const authBase = (this.config.connectionConfig as any)?.plexTvUrl || 'https://app.plex.tv/auth'
    const params = new URLSearchParams({
      clientID: CLIENT_IDENTIFIER,
      code: code,
      'context[device][product]': PRODUCT_NAME,
      'context[device][platform]': process.platform === 'win32' ? 'Windows' : 'macOS',
      'context[device][device]': PRODUCT_NAME
    })
    return `${authBase}/#!?${params.toString()}`
  }

  async checkAuthPin(pinId: number): Promise<string | null> {
    try {
      const response = await this.api.get(`${this.plexApiUrl}/pins/${pinId}`)
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
      const libraryInfo = (await this.getLibraries()).find(l => l.id === libraryId)
      
      if (libraryInfo?.type === LibraryType.Music) {
        return this.scanMusicLibrary(libraryId, options?.onProgress)
      }

      const items = await this.paginatedPlexFetch<PlexMediaItem>(url, params)
      const totalItems = items.length
      getLoggingService().info('[PlexProvider]', `Retrieved ${totalItems} items from Plex`)

      const validPlexIds = new Set<string>()

      let scanned = 0
      const BATCH_SIZE = 15 // Number of items to fetch metadata for in parallel

      try {
        for (let i = 0; i < totalItems; i += BATCH_SIZE) {
          if (this.scanCancelled) {
            getLoggingService().info('[PlexProvider]', `Scan cancelled at ${scanned}/${totalItems}`)
            result.cancelled = true
            break
          }

          const batch = items.slice(i, i + BATCH_SIZE)
          
          // STEP 1: Fetch all metadata in parallel OUTSIDE the transaction
          const batchResults = await Promise.all(batch.map(async (plexItem) => {
            try {
              if (plexItem.type === 'show') {
                const episodes = await this.getShowEpisodes(plexItem.ratingKey)
                
                // Fetch details for episodes in parallel too (limited)
                const EP_CHUNK_SIZE = 5
                const detailedEpisodes = []
                for (let k = 0; k < episodes.length; k += EP_CHUNK_SIZE) {
                  const chunk = episodes.slice(k, k + EP_CHUNK_SIZE)
                  const chunkDetails = await Promise.all(chunk.map(ep => this.getItemMetadataDetailed(ep.ratingKey)))
                  detailedEpisodes.push(...chunkDetails.filter(d => d !== null))
                }

                return { type: 'show', plexItem, detailedEpisodes }
              } else {
                const detail = await this.getItemMetadataDetailed(plexItem.ratingKey)
                return { type: 'movie', plexItem, detail }
              }
            } catch (err) {
              getLoggingService().error('[PlexProvider]', `Failed to fetch metadata for ${plexItem.title}:`, err)
              return { type: 'error', plexItem, error: err }
            }
          }))

          // STEP 2: Prepare all database-ready data and perform quality analysis
          const preparedData: any[] = []
          const analyzer = getQualityAnalyzer()
          // Ensure thresholds are loaded once before the batch
          await analyzer.loadThresholdsFromDatabase()

          for (const res of batchResults) {
            if (res.type === 'error') {
              result.errors.push(`Metadata fetch failed for ${res.plexItem.title}: ${getErrorMessage(res.error)}`)
              continue
            }

            if (res.type === 'show' && res.detailedEpisodes) {
              const { plexItem, detailedEpisodes } = res
              let showTmdbId: string | undefined
              if (plexItem.Guid) {
                for (const guid of plexItem.Guid) {
                  if (guid.id.includes('tmdb://')) {
                    showTmdbId = guid.id.replace('tmdb://', '').split('?')[0]
                  }
                }
              }

              const showPoster = plexItem.thumb ? `${this.selectedServer!.uri}${plexItem.thumb}?X-Plex-Token=${this.selectedServer!.accessToken}` : undefined
              const ownedEpisodes = detailedEpisodes.length
              const ownedSeasons = new Set(detailedEpisodes.map(e => e.parentIndex)).size

              const episodesToSave = await Promise.all(detailedEpisodes.map(async (detail) => {
                const mapped = this.convertToMediaItem(detail, showTmdbId, plexItem.titleSort)
                if (!mapped) return null
                
                // Perform quality analysis sync/async safely before transaction
                const qualityScore = await analyzer.analyzeMediaItem(mapped.mediaItem)
                
                return { mapped, qualityScore, ratingKey: detail.ratingKey }
              }))

              preparedData.push({
                type: 'show',
                title: plexItem.title,
                tmdbId: showTmdbId,
                posterUrl: showPoster,
                ownedSeasons,
                ownedEpisodes,
                episodes: episodesToSave.filter(e => e !== null)
              })
            } else if (res.type === 'movie' && res.detail) {
              try {
                const result = MediaTransformer.fromPlex(res.detail, this.sourceId, this.selectedServer!.uri, this.selectedServer!.accessToken)
                const qualityScore = await analyzer.analyzeMediaItem(result.mediaItem)
                preparedData.push({ type: 'movie', mapped: result, qualityScore, ratingKey: res.plexItem.ratingKey })
              } catch (e) {
                if (e instanceof IncompleteMetadataError) getLoggingService().warn('[PlexProvider]', e.message)
                else getLoggingService().error('[PlexProvider]', `Error mapping movie ${res.plexItem.ratingKey}:`, e)
              }
            }
          }

          // STEP 3: Write to DB inside a fast, PURELY SYNCHRONOUS transaction
          await db.startBatch()
          try {
            for (const data of preparedData) {
              if (data.type === 'show') {
                await db.tvShows.upsertCompleteness({
                  series_title: data.title,
                  source_id: this.sourceId,
                  library_id: libraryId,
                  total_seasons: data.ownedSeasons,
                  total_episodes: data.ownedEpisodes,
                  owned_seasons: data.ownedSeasons,
                  owned_episodes: data.ownedEpisodes,
                  missing_seasons: '[]',
                  missing_episodes: '[]',
                  completeness_percentage: 100,
                  tmdb_id: data.tmdbId,
                  poster_url: data.posterUrl,
                  status: 'Continuing',
                })

                for (const ep of data.episodes) {
                  validPlexIds.add(ep.ratingKey)
                  await this.saveMediaItemSync(ep.mapped, ep.qualityScore, db, libraryId)
                  result.itemsScanned++
                }
              } else {
                validPlexIds.add(data.ratingKey)
                await this.saveMediaItemSync(data.mapped, data.qualityScore, db, libraryId)
                result.itemsScanned++
              }

              scanned++
              if (options?.onProgress && scanned % 5 === 0) {
                options.onProgress({
                  current: scanned,
                  total: totalItems,
                  phase: 'processing',
                  percentage: Math.round((scanned / totalItems) * 100),
                  currentItem: data.title || (data.mapped?.mediaItem.title)
                })
              }
            }
          } finally {
            await db.endBatch()
          }

          // Small yield to keep event loop happy and allow other IPCs
          await new Promise(r => setTimeout(r, 0))
        }
      } finally {
        if (db.isInTransaction()) {
          try { db.endBatch() } catch { /* ignore */ }
        }
      }

      if (!result.cancelled && (options?.forceFullScan || !options?.sinceTimestamp)) {
        getLoggingService().info('[PlexProvider]', `Reconciling library ${libraryId}...`)
        const type = libraryInfo?.type === LibraryType.Show ? MediaItemType.Episode : MediaItemType.Movie
        
        const removed = db.media.removeStaleProviderItems(this.sourceId, libraryId, type, validPlexIds)
        result.itemsRemoved = removed
        getLoggingService().info('[PlexProvider]', `Reconciling ${type}s: ${validPlexIds.size} in scan, removed ${removed} stale items from DB`)
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

  private async saveMediaItemSync(mapped: { mediaItem: MediaItem; versions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] }, qualityScore: any, db: any, libraryId: string): Promise<void> {
    const mediaId = await db.media.upsertItem({
      ...mapped.mediaItem,
      source_id: this.sourceId,
      library_id: libraryId
    })

    await db.media.syncItemVersions(mediaId, mapped.versions.map(v => ({ ...v, media_item_id: mediaId })))
    await db.media.updateBestVersion(mediaId)

    qualityScore.media_item_id = mediaId
    await db.media.upsertQualityScore(qualityScore)
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    const detail = await this.getItemMetadataDetailed(itemId)
    if (!detail) throw new Error(`Item not found: ${itemId}`)

    const { mediaItem } = MediaTransformer.fromPlex(detail, this.sourceId, this.selectedServer?.uri, this.selectedServer?.accessToken)

    return {
      providerId: itemId,
      providerType: ProviderType.Plex,
      itemId,
      title: detail.title,
      type: detail.type === 'episode' ? MediaItemType.Episode : MediaItemType.Movie,
      year: detail.year,
      filePath: mediaItem.file_path,
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
    try {
      const result = MediaTransformer.fromPlex(item, this.sourceId, this.selectedServer?.uri, this.selectedServer?.accessToken)
      if (item.type === 'episode' && showTitleSort) {
        result.mediaItem.sort_title = showTitleSort
      }
      if (showTmdbId) {
        result.mediaItem.series_tmdb_id = showTmdbId
      }
      return result
    } catch (error) {
      if (error instanceof IncompleteMetadataError) {
        getLoggingService().warn('[PlexProvider]', error.message)
      } else {
        getLoggingService().error('[PlexProvider]', 'Transformation error:', error)
      }
      return null
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
      const detailedResults = await Promise.all(tracks.map(async (t: PlexMusicTrack) => {
        const d = await this.api.get(`${this.selectedServer!.uri}/library/metadata/${t.ratingKey}`, { headers: { 'X-Plex-Token': this.selectedServer!.accessToken } })
        return d.data?.MediaContainer?.Metadata?.[0]
      }))
      const detailed: PlexMusicTrack[] = detailedResults.filter(Boolean) as PlexMusicTrack[]
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
      source_type: ProviderType.Plex,
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
      source_type: ProviderType.Plex,
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
      source_type: ProviderType.Plex,
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
}
