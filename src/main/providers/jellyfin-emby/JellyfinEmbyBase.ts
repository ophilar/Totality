import { JellyfinApiClient } from './JellyfinApiClient'
import { JellyfinItemMapper } from './JellyfinItemMapper'
import {
  BaseMediaProvider,
  ProviderCredentials,
  AuthResult,
  ConnectionTestResult,
  MediaLibrary,
  MediaMetadata,
  ScanResult,
  ScanOptions,
  SourceConfig,
} from '../base/MediaProvider'
import type { MediaItem, MediaItemVersion, MusicTrack } from '../../types/database'
import {
  calculateAlbumStats,
} from '../base/MusicScannerUtils'
import { getLoggingService } from '../../services/LoggingService'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getTMDBService } from '../../services/TMDBService'
import { getMovieCollectionService } from '../../services/MovieCollectionService'
import { calculateVersionScore } from '../utils/ProviderUtils'
import { extractVersionNames } from '../utils/VersionNaming'
import { getErrorMessage } from '../../services/utils/errorUtils'

// Jellyfin/Emby API response types
export interface JellyfinAuthResponse {
  User: { Id: string; Name: string; ServerId: string }
  AccessToken: string
  ServerId: string
}

export interface JellyfinLibrary {
  Id: string
  Name: string
  CollectionType?: string
  ItemCount?: number
  ItemId?: string
}

export interface JellyfinMediaItem {
  Id: string
  Name: string
  Type: string
  ProductionYear?: number
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  Path?: string
  Overview?: string
  MediaSources?: JellyfinMediaSource[]
  ProviderIds?: { Imdb?: string; Tmdb?: string }
  ImageTags?: { Primary?: string; Thumb?: string; Screenshot?: string }
  SeriesId?: string
  SeasonId?: string
  SeriesPrimaryImageTag?: string
  ParentPrimaryImageTag?: string
  ParentPrimaryImageItemId?: string
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  SeriesProviderIds?: { Imdb?: string; Tmdb?: string }
  DateCreated?: string
  PremiereDate?: string
  SortName?: string
  _seriesSortName?: string // Internal property added by mapper
}

export interface JellyfinMediaSource {
  Id: string
  Path?: string
  Size?: number
  Container?: string
  RunTimeTicks?: number
  Bitrate?: number
  MediaStreams?: JellyfinMediaStream[]
}

export interface JellyfinMediaStream {
  Type: 'Video' | 'Audio' | 'Subtitle'
  Index: number
  Codec?: string
  CodecTag?: string
  Language?: string
  Title?: string
  DisplayTitle?: string
  IsDefault?: boolean
  Width?: number
  Height?: number
  BitRate?: number
  RealFrameRate?: number
  BitDepth?: number
  VideoRange?: string
  ColorSpace?: string
  Profile?: string
  Level?: number
  Channels?: number
  SampleRate?: number
  ChannelLayout?: string
  IsForced?: boolean
}

export interface JellyfinMusicArtist {
  Id: string
  Name: string
  Overview?: string
  ProviderIds?: Record<string, string>
  ImageTags?: { Primary?: string; Thumb?: string }
  Genres?: string[]
  SortName?: string
}

export interface JellyfinMusicAlbum {
  Id: string
  Name: string
  AlbumArtists?: Array<{ Id: string; Name: string }>
  AlbumArtist?: string
  Artists?: string[]
  ProductionYear?: number
  ProviderIds?: Record<string, string>
  ImageTags?: { Primary?: string; Thumb?: string }
  Genres?: string[]
  ChildCount?: number
  RunTimeTicks?: number
  SortName?: string
}

export interface JellyfinMusicTrack {
  Id: string
  Name: string
  AlbumId?: string
  Album?: string
  AlbumArtist?: string
  Artists?: string[]
  ArtistItems?: Array<{ Id: string; Name: string }>
  IndexNumber?: number
  ParentIndexNumber?: number
  RunTimeTicks?: number
  MediaSources?: JellyfinMediaSource[]
  Path?: string
  ProviderIds?: Record<string, string>
  ImageTags?: { Primary?: string; Thumb?: string }
  PrimaryImageTag?: string
  Moods?: string[]
  Tags?: string[]
}

export abstract class JellyfinEmbyBase extends BaseMediaProvider {
  abstract readonly providerType: 'jellyfin' | 'emby'
  private _client: JellyfinApiClient | null = null
  private _mapper: JellyfinItemMapper | null = null

  protected scanCancelled = false
  protected musicScanCancelled = false

  protected abstract readonly authHeaderName: string
  protected abstract readonly clientName: string
  protected abstract readonly clientVersion: string

  constructor(config: SourceConfig) {
    super(config)
  }

  protected get client(): JellyfinApiClient {
    if (!this._client) {
      const conn = this.config.connectionConfig
      this._client = new JellyfinApiClient({
        serverUrl: (conn.serverUrl as string) || '',
        sourceId: this.sourceId,
        providerType: this.providerType,
        authHeaderName: this.authHeaderName,
        clientName: this.clientName,
        clientVersion: this.clientVersion,
        accessToken: (conn.accessToken as string) || '',
        apiKey: (conn.apiKey as string) || '',
        userId: (conn.userId as string) || '',
      })
    }
    return this._client
  }

  protected get mapper(): JellyfinItemMapper {
    if (!this._mapper) {
      this._mapper = new JellyfinItemMapper(this.sourceId, this.providerType, this.client)
    }
    return this._mapper
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      if (!credentials.serverUrl) return { success: false, error: 'Server URL is required' }
      this.client.setServerUrl(credentials.serverUrl)

      if (credentials.apiKey) {
        this.client.setApiKey(credentials.apiKey)
        const testResult = await this.testConnection()
        if (testResult.success) return { success: true, apiKey: credentials.apiKey, serverName: testResult.serverName }
        return { success: false, error: testResult.error || 'Invalid API key' }
      }

      if (credentials.username && credentials.password) {
        const response = await this.client.post<JellyfinAuthResponse>(
          '/Users/AuthenticateByName',
          { Username: credentials.username, Pw: credentials.password },
          { 'X-Emby-Authorization': this.client.buildAuthHeader() }
        )

        if (response.AccessToken) {
          this.client.setAccessToken(response.AccessToken, response.User.Id)
          return {
            success: true,
            token: response.AccessToken,
            userId: response.User.Id,
            userName: response.User.Name,
            serverName: response.ServerId,
          }
        }
      }
      return { success: false, error: 'Invalid credentials' }
    } catch (error: unknown) {
      getLoggingService().error('[JellyfinEmbyBase]', `${this.providerType} authentication failed:`, error)
      return { success: false, error: getErrorMessage(error) }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!(this.client.getAccessToken() || this.client.getApiKey())
  }

  async disconnect(): Promise<void> {
    this.client.setAccessToken('', '')
    this.client.setApiKey('')
  }

  async isQuickConnectEnabled(): Promise<boolean> { return this.client.isQuickConnectEnabled() }
  async initiateQuickConnect(): Promise<{ secret: string; code: string } | null> { return this.client.initiateQuickConnect() }
  async checkQuickConnectStatus(secret: string): Promise<{ authenticated: boolean; error?: string }> { return this.client.checkQuickConnectStatus(secret) }
  async completeQuickConnect(secret: string): Promise<AuthResult> { return this.client.completeQuickConnect(secret) }

  async testConnection(): Promise<ConnectionTestResult> {
    if (!this.client.getServerUrl()) return { success: false, error: 'Server URL not configured' }
    try {
      const startTime = Date.now()
      const response = await this.client.get<{ ServerName: string; Version: string }>('/System/Info/Public')
      return { success: true, serverName: response.ServerName, serverVersion: response.Version, latencyMs: Date.now() - startTime }
    } catch (error: unknown) { return { success: false, error: getErrorMessage(error) } }
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    if (!this.client.getServerUrl()) throw new Error('Not connected to server')
    const userId = this.client.getUserId()
    try {
      if (userId) {
        try {
          const response = await this.client.get<{ Items: JellyfinLibrary[] }>(`/Users/${userId}/Views`)
          const mediaTypes = ['movies', 'tvshows', 'homevideos', 'musicvideos', 'mixed', 'boxsets', 'music']
          const libraries = (response.Items || [])
            .filter(lib => {
              const collType = (lib.CollectionType || '').toLowerCase()
              return mediaTypes.includes(collType) || !lib.CollectionType
            })
            .map(lib => ({
              id: lib.Id,
              name: lib.Name,
              type: this.mapper.mapLibraryType(lib.CollectionType),
              collectionType: (lib.CollectionType || '').toLowerCase(),
              itemCount: lib.ItemCount,
            }))
          if (libraries.length > 0) return libraries
        } catch { /* fallback */ }
      }
      const response = await this.client.get<JellyfinLibrary[] | { Items: JellyfinLibrary[] }>('/Library/VirtualFolders')
      const folders = Array.isArray(response) ? response : response.Items || []
      const mediaTypes = ['movies', 'tvshows', 'homevideos', 'musicvideos', 'music', 'boxsets']
      return folders
        .filter((lib: JellyfinLibrary) => mediaTypes.includes((lib.CollectionType || '').toLowerCase()))
        .map((lib: JellyfinLibrary) => ({ id: lib.ItemId || lib.Id, name: lib.Name, type: this.mapper.mapLibraryType(lib.CollectionType), collectionType: (lib.CollectionType || '').toLowerCase(), itemCount: lib.ItemCount }))
    } catch (error: unknown) { throw new Error(`Failed to fetch libraries: ${getErrorMessage(error)}`) }
  }

  async getLibraryItems(libraryId: string, offset = 0, limit = 100): Promise<MediaMetadata[]> {
    if (!this.client.getServerUrl()) throw new Error('Not connected to server')
    try {
      const response = await this.client.get<{ Items: JellyfinMediaItem[] }>('/Items', { ParentId: libraryId, Recursive: true, IncludeItemTypes: 'Movie,Episode', Fields: 'Path,MediaSources,ProviderIds,Overview', StartIndex: offset, Limit: limit })
      return response.Items.map(item => this.mapper.convertToMediaMetadata(item))
    } catch (error: unknown) { throw new Error(`Failed to fetch library items: ${getErrorMessage(error)}`) }
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    if (!this.client.getServerUrl()) throw new Error('Not connected to server')
    try {
      const response = await this.client.get<JellyfinMediaItem>(`/Items/${itemId}`, { Fields: 'Path,MediaSources,ProviderIds,Overview' })
      return this.mapper.convertToMediaMetadata(response)
    } catch (error: unknown) { throw new Error(`Failed to fetch item metadata: ${getErrorMessage(error)}`) }
  }

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    const { onProgress, sinceTimestamp, forceFullScan } = options || {}
    const isIncremental = !!sinceTimestamp && !forceFullScan
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    try {
      const libraries = await this.getLibraries()
      const library = libraries.find(l => l.id === libraryId)
      const libraryType = library?.type || 'movie'
      const isBoxsets = library?.collectionType === 'boxsets'
      const allItems: JellyfinMediaItem[] = []
      const batchSize = 100
      const fieldsParam = 'Path,MediaSources,ProviderIds,DateCreated,PremiereDate,ParentId,SeriesId,SeasonId,ImageTags,SeriesPrimaryImageTag,ParentPrimaryImageItemId,ParentPrimaryImageTag,ParentThumbItemId,ParentThumbImageTag,ParentBackdropItemId,ParentBackdropImageTags,SortName,Overview'

      if (isBoxsets) {
        let boxsetOffset = 0
        let hasMoreBoxsets = true
        while (hasMoreBoxsets) {
          const res = await this.client.get<{ Items: JellyfinMediaItem[]; TotalRecordCount: number }>('/Items', { ParentId: libraryId, Recursive: true, IncludeItemTypes: 'BoxSet', Fields: 'ProviderIds,ImageTags', EnableTotalRecordCount: true, StartIndex: boxsetOffset, Limit: batchSize })
          const boxsets = res.Items || []
          for (const boxset of boxsets) {
            const movieRes = await this.client.get<{ Items: JellyfinMediaItem[] }>('/Items', { ParentId: boxset.Id, Recursive: true, IncludeItemTypes: 'Movie', Fields: fieldsParam, EnableImageTypes: 'Primary,Thumb,Screenshot,Banner,Backdrop', StartIndex: 0, Limit: 1000 })
            allItems.push(...movieRes.Items)
            const ownedTmdbIds = movieRes.Items.map(m => m.ProviderIds?.Tmdb).filter(Boolean) as string[]
            if (ownedTmdbIds.length > 0) {
              let resolvedTmdbCollectionId = boxset.ProviderIds?.Tmdb
              if (!resolvedTmdbCollectionId) {
                try {
                  const tmdb = getTMDBService()
                  const movieDetails = await tmdb.getMovieDetails(ownedTmdbIds[0])
                  if (movieDetails?.belongs_to_collection?.id) resolvedTmdbCollectionId = movieDetails.belongs_to_collection.id.toString()
                } catch { /* ignore */ }
              }
              if (resolvedTmdbCollectionId) {
                try {
                  const collectionService = getMovieCollectionService()
                  const res = await collectionService.lookupCollectionCompleteness(resolvedTmdbCollectionId, ownedTmdbIds)
                  if (res) {
                    await getDatabase().movieCollections.upsertCollection({
                      tmdb_collection_id: resolvedTmdbCollectionId, collection_name: boxset.Name, source_id: this.sourceId, library_id: libraryId, total_movies: res.totalMovies, owned_movies: res.ownedMovies, missing_movies: JSON.stringify(res.missingMovies), owned_movie_ids: JSON.stringify(ownedTmdbIds), completeness_percentage: res.completenessPercentage, poster_url: res.posterUrl, backdrop_url: res.backdropUrl
                    })
                  }
                } catch { /* ignore */ }
              }
            }
          }
          if (boxsets.length === 0 || allItems.length >= res.TotalRecordCount) hasMoreBoxsets = false
          else boxsetOffset += batchSize
        }
      } else {
        let offset = 0
        let hasMoreItems = true
        while (hasMoreItems) {
          const params: Record<string, unknown> = { ParentId: libraryId, Recursive: true, IncludeItemTypes: libraryType === 'show' ? 'Episode' : 'Movie', Fields: fieldsParam, EnableImageTypes: 'Primary,Thumb,Screenshot,Banner,Backdrop', EnableTotalRecordCount: true, StartIndex: offset, Limit: batchSize }
          if (isIncremental && sinceTimestamp) params.MinDateLastSaved = sinceTimestamp.toISOString()
          const response = await this.client.get<{ Items: JellyfinMediaItem[]; TotalRecordCount: number }>('/Items', params)
          allItems.push(...response.Items)
          if (allItems.length >= response.TotalRecordCount || response.Items.length === 0) hasMoreItems = false
          else offset += batchSize
        }
      }

      if (libraryType === 'show') {
        const seriesIds = Array.from(new Set(allItems.map(i => i.SeriesId).filter(Boolean))) as string[]
        for (let i = 0; i < seriesIds.length; i += 50) {
          const batchIds = seriesIds.slice(i, i + 50)
          try {
            const seriesResponse = await this.client.get<{ Items: JellyfinMediaItem[] }>('/Items', { Ids: batchIds.join(','), Fields: 'ProviderIds,ImageTags,SortName' })
            for (const series of seriesResponse.Items) {
              allItems.filter(item => item.SeriesId === series.Id).forEach(item => {
                item.SeriesProviderIds = series.ProviderIds
                if (!item.SeriesPrimaryImageTag && series.ImageTags?.Primary) item.SeriesPrimaryImageTag = series.ImageTags.Primary
                if (series.SortName) item._seriesSortName = series.SortName
              })
            }
          } catch { /* ignore */ }
        }
      }

      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()
      const scannedProviderIds = new Set<string>()
      await db.startBatch()
      const groups = this.mapper.groupMovieVersions(allItems, libraryType)
      const totalItems = allItems.length
      try {
        let itemIndex = 0
        for (const group of groups) {
          for (const item of group) {
            itemIndex++
            if (onProgress) onProgress({ current: itemIndex, total: totalItems, phase: 'processing', currentItem: item.Name, percentage: (itemIndex / totalItems) * 100 })
          }
          try {
            const allVersions: Omit<MediaItemVersion, 'id' | 'media_item_id'>[] = []
            let canonicalItem: MediaItem | null = null
            for (const item of group) {
              const converted = await this.mapper.convertToMediaItem(item)
              if (!converted) continue
              if (!canonicalItem) canonicalItem = converted.mediaItem
              allVersions.push(...converted.versions)
            }
            if (canonicalItem && allVersions.length > 0) {
              if (allVersions.length > 1) {
                extractVersionNames(allVersions)
                const best = allVersions.reduce((a, b) => calculateVersionScore(b) > calculateVersionScore(a) ? b : a)
                Object.assign(canonicalItem, best)
              }
              canonicalItem.version_count = allVersions.length
              canonicalItem.source_id = this.sourceId
              canonicalItem.source_type = this.providerType
              canonicalItem.library_id = libraryId
              const id = await db.media.upsertItem(canonicalItem)
              scannedProviderIds.add(canonicalItem.plex_id)
              const scoredVersions = allVersions.map(v => ({ ...v, media_item_id: id, ...analyzer.analyzeVersion(v as any) }))
              db.media.syncItemVersions(id, scoredVersions)
              canonicalItem.id = id
              await db.media.upsertQualityScore(await analyzer.analyzeMediaItem(canonicalItem))
              result.itemsScanned++
            }
          } catch (e: unknown) { result.errors.push(`Failed to process ${group[0]?.Name}: ${getErrorMessage(e)}`) }
          if (result.itemsScanned % 50 === 0) await db.forceSave()
        }
      } finally { await db.endBatch() }

      if (!isIncremental && scannedProviderIds.size > 0) {
        const itemType = libraryType === 'show' ? 'episode' : 'movie'
        const items = db.media.getItems({ type: itemType, sourceId: this.sourceId, libraryId })
        for (const item of items) if (!scannedProviderIds.has(item.plex_id) && item.id) { await db.media.deleteItem(item.id); result.itemsRemoved++ }
      }
      await db.sources.updateSourceScanTime(this.sourceId)
      result.success = true
    } catch (error: unknown) { result.errors.push(getErrorMessage(error)); }
    result.durationMs = Date.now() - startTime
    return result
  }

  async getMusicArtists(libraryId: string): Promise<JellyfinMusicArtist[]> {
    try {
      const allArtists: JellyfinMusicArtist[] = []
      let startIndex = 0
      const batchSize = 100
      let hasMore = true
      while (hasMore) {
        const res = await this.client.get<{ Items: JellyfinMusicArtist[]; TotalRecordCount?: number }>('/Artists/AlbumArtists', { ParentId: libraryId, Fields: 'ProviderIds,Genres,Overview,ImageTags,SortName', StartIndex: startIndex, Limit: batchSize, EnableTotalRecordCount: true })
        const items = res.Items || []
        allArtists.push(...items)
        startIndex += items.length
        hasMore = startIndex < (res.TotalRecordCount || 0) && items.length === batchSize
      }
      return allArtists
    } catch { throw new Error('Failed to fetch music artists') }
  }

  async getMusicAlbums(libraryId: string, artistId?: string): Promise<JellyfinMusicAlbum[]> {
    try {
      const allAlbums: JellyfinMusicAlbum[] = []
      let startIndex = 0
      const batchSize = 100
      let hasMore = true
      while (hasMore) {
        const params: Record<string, unknown> = { IncludeItemTypes: 'MusicAlbum', Recursive: true, Fields: 'ProviderIds,Genres,ImageTags,ChildCount,RunTimeTicks,AlbumArtist,AlbumArtists,Artists,PrimaryImageAspectRatio', EnableImages: true, EnableImageTypes: 'Primary,Thumb', StartIndex: startIndex, Limit: batchSize, EnableTotalRecordCount: true }
        if (artistId) params.AlbumArtistIds = artistId; else params.ParentId = libraryId
        const res = await this.client.get<{ Items: JellyfinMusicAlbum[]; TotalRecordCount?: number }>('/Items', params)
        const items = res.Items || []
        allAlbums.push(...items)
        startIndex += items.length
        hasMore = startIndex < (res.TotalRecordCount || 0) && items.length === batchSize
      }
      return allAlbums
    } catch { throw new Error('Failed to fetch music albums') }
  }

  async getMusicTracks(albumId: string): Promise<JellyfinMusicTrack[]> {
    try {
      const res = await this.client.get<{ Items: JellyfinMusicTrack[] }>('/Items', { ParentId: albumId, IncludeItemTypes: 'Audio', Fields: 'MediaSources,Path,ProviderIds,Artists,ArtistItems,ImageTags,PrimaryImageTag' })
      return res.Items || []
    } catch { throw new Error('Failed to fetch music tracks') }
  }

  async scanMusicLibrary(libraryId: string, onProgress?: (p: { current: number; total: number; phase: string; currentItem: string; percentage: number }) => void): Promise<ScanResult> {
    this.musicScanCancelled = false
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0, cancelled: false }
    try {
      const db = getDatabase()
      const scannedAlbumIds = new Set<string>()
      const processAlbum = async (jellyfinAlbum: JellyfinMusicAlbum, artistId: number | undefined, artistName?: string) => {
        const albumData = this.mapper.convertToMusicAlbum(jellyfinAlbum, artistId, libraryId)
        if (artistName && !albumData.artist_name) albumData.artist_name = artistName
        const tracks = await this.getMusicTracks(jellyfinAlbum.Id)
        if (!albumData.thumb_url && tracks.length > 0 && tracks[0].ImageTags?.Primary) albumData.thumb_url = this.client.buildImageUrl(tracks[0].Id, 'Primary', tracks[0].ImageTags.Primary)
        const trackDataList = tracks.map(t => this.mapper.convertToMusicTrack(t, undefined, artistId, libraryId)).filter(Boolean) as MusicTrack[]
        const stats = calculateAlbumStats(trackDataList)
        Object.assign(albumData, { ...stats })
        const albumId = await db.music.upsertAlbum(albumData)
        scannedAlbumIds.add(jellyfinAlbum.Id)
        for (const t of trackDataList) { t.album_id = albumId; await db.music.upsertTrack(t); result.itemsScanned++ }
      }

      const artists = await this.getMusicArtists(libraryId)
      for (const [idx, artist] of artists.entries()) {
        if (this.musicScanCancelled) { result.cancelled = true; break }
        try {
          const artistId = await db.music.upsertArtist(this.mapper.convertToMusicArtist(artist, libraryId))
          const albums = await this.getMusicAlbums(libraryId, artist.Id)
          let [tc, ac] = [0, 0]
          for (const album of albums) { await processAlbum(album, artistId); ac++; tc += (album.ChildCount || 0) }
          await db.music.updateMusicArtistCounts(artistId, ac, tc)
          if (onProgress) onProgress({ current: idx + 1, total: artists.length, phase: 'processing', currentItem: artist.Name, percentage: ((idx + 1) / artists.length) * 50 })
        } catch (e: unknown) { result.errors.push(`Artist ${artist.Name}: ${getErrorMessage(e)}`) }
      }

      if (!result.cancelled) {
        const allAlbums = await this.getMusicAlbums(libraryId)
        const unprocessed = allAlbums.filter(a => !scannedAlbumIds.has(a.Id))
        for (const [idx, album] of unprocessed.entries()) {
          if (this.musicScanCancelled) { result.cancelled = true; break }
          try {
            await processAlbum(album, undefined, album.AlbumArtist || album.AlbumArtists?.[0]?.Name || 'Various Artists')
            if (onProgress) onProgress({ current: idx + 1, total: unprocessed.length, phase: 'processing compilations', currentItem: album.Name, percentage: 50 + ((idx + 1) / unprocessed.length) * 50 })
          } catch (e: unknown) { result.errors.push(`Album ${album.Name}: ${getErrorMessage(e)}`) }
        }
      }
      result.success = true
    } catch (e: unknown) { result.errors.push(getErrorMessage(e)) }
    result.durationMs = Date.now() - startTime
    return result
  }

  cancelMusicScan(): void { this.musicScanCancelled = true }
}
