import { KodiRpcClient } from './KodiRpcClient'
import { KodiItemMapper } from './KodiItemMapper'
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
import type { MusicTrack } from '../../types/database'
import {
  calculateAlbumStats,
} from '../base/MusicScannerUtils'
import { getDatabase } from '../../database/getDatabase'
import { getQualityAnalyzer } from '../../services/QualityAnalyzer'
import { getErrorMessage } from '../../services/utils/errorUtils'

// Kodi JSON-RPC types (exported for mapper)
export interface KodiMovie {
  movieid: number
  title: string
  file: string
  year?: number
  runtime?: number
  plot?: string
  streamdetails: KodiStreamDetails
  imdbnumber?: string
  art?: { poster?: string; fanart?: string }
}

export interface KodiEpisode {
  episodeid: number
  title: string
  file: string
  tvshowid: number
  showtitle: string
  season: number
  episode: number
  runtime?: number
  plot?: string
  streamdetails: KodiStreamDetails
  art?: { thumb?: string; 'season.poster'?: string; 'tvshow.poster'?: string }
}

export interface KodiStreamDetails {
  video?: Array<{ codec?: string; width?: number; height?: number; duration?: number; stereomode?: string; hdrtype?: string }>
  audio?: Array<{ codec?: string; channels?: number; language?: string }>
  subtitle?: Array<{ language?: string }>
}

export interface KodiMusicArtist {
  artistid: number
  artist: string
  musicbrainzartistid?: string
  genre?: string[]
  description?: string
  thumbnail?: string
}

export interface KodiMusicAlbum {
  albumid: number
  title: string
  artistid: number[]
  artist: string[]
  displayartist?: string
  year?: number
  musicbrainzalbumid?: string
  musicbrainzreleasegroupid?: string
  genre?: string[]
  type?: string
  thumbnail?: string
}

export interface KodiMusicSong {
  songid: number
  title: string
  artistid: number[]
  artist: string[]
  displayartist?: string
  albumid: number
  album: string
  track: number
  disc: number
  duration: number
  file: string
  audio_codec?: string
  samplerate?: number
  bitdepth?: number
  musicbrainztrackid?: string
}

export class KodiProvider extends BaseMediaProvider {
  readonly providerType = 'kodi' as const
  private rpc: KodiRpcClient
  private mapper: KodiItemMapper

  constructor(config: SourceConfig) {
    super(config)
    const conn = config.connectionConfig
    this.rpc = new KodiRpcClient({
      host: (conn.host as string) || 'localhost',
      port: (conn.port as number) || 8080,
      username: conn.username as string,
      password: conn.password as string,
      sourceId: this.sourceId,
    })
    this.mapper = new KodiItemMapper(this.sourceId, this.rpc)
  }

  async testConnection(credentials?: ProviderCredentials): Promise<ConnectionTestResult> {
    const host = credentials?.host || this.rpc.getHost()
    const port = credentials?.port || this.rpc.getPort()
    
    // Create temporary client if credentials provided
    const client = credentials 
      ? new KodiRpcClient({ host, port, username: credentials.username, password: credentials.password, sourceId: this.sourceId })
      : this.rpc

    try {
      const startTime = Date.now()
      const result = await client.call<{ version: { major: number; minor: number; revision: number } }>('JSONRPC.Version')
      return {
        success: true,
        serverName: 'Kodi',
        serverVersion: `${result.version.major}.${result.version.minor}.${result.version.revision}`,
        latencyMs: Date.now() - startTime,
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    const result = await this.testConnection(credentials)
    if (result.success) {
      this.rpc = new KodiRpcClient({
        host: credentials.host!,
        port: credentials.port!,
        username: credentials.username,
        password: credentials.password,
        sourceId: this.sourceId,
      })
      this.mapper = new KodiItemMapper(this.sourceId, this.rpc)
      return { success: true }
    }
    return { success: false, error: result.error }
  }

  async isAuthenticated(): Promise<boolean> { return true }
  async disconnect(): Promise<void> {}

  async getLibraries(): Promise<MediaLibrary[]> {
    return [
      { id: 'movies', name: 'Movies', type: 'movie' },
      { id: 'shows', name: 'TV Shows', type: 'show' },
      { id: 'music', name: 'Music', type: 'music' },
    ]
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    if (itemId.startsWith('movie-')) {
      const id = parseInt(itemId.replace('movie-', ''), 10)
      const res = await this.rpc.call<{ movieid: number; title: string; file: string; streamdetails: any; art: any }>('VideoLibrary.GetMovieDetails', { movieid: id, properties: ['file', 'streamdetails', 'art'] })
      return this.mapper.convertToMediaMetadata(res as any, 'movie')
    } else {
      const id = parseInt(itemId.replace('episode-', ''), 10)
      const res = await this.rpc.call<{ episodeid: number; title: string; file: string; streamdetails: any; art: any }>('VideoLibrary.GetEpisodeDetails', { episodeid: id, properties: ['file', 'streamdetails', 'art'] })
      return this.mapper.convertToMediaMetadata(res as any, 'episode')
    }
  }

  async scanLibrary(libraryId: string, options?: ScanOptions): Promise<ScanResult> {
    if (libraryId === 'music') return this.scanMusicLibrary(options?.onProgress)
    
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    
    try {
      const db = getDatabase()
      const analyzer = getQualityAnalyzer()
      await analyzer.loadThresholdsFromDatabase()
      
      const items: Array<KodiMovie | KodiEpisode> = libraryId === 'movies'
        ? (await this.rpc.call<{ movies: KodiMovie[] }>('VideoLibrary.GetMovies', { properties: ['file', 'year', 'runtime', 'streamdetails', 'imdbnumber', 'art', 'plot'] })).movies
        : (await this.rpc.call<{ episodes: KodiEpisode[] }>('VideoLibrary.GetEpisodes', { properties: ['file', 'showtitle', 'season', 'episode', 'runtime', 'streamdetails', 'art', 'plot'] })).episodes

      if (!items) return { ...result, success: true }

      await db.startBatch()
      try {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (options?.onProgress) options.onProgress({ current: i + 1, total: items.length, phase: 'processing', currentItem: item.title, percentage: ((i + 1) / items.length) * 100 })
          
          const converted = await this.mapper.convertToMediaItem(item, libraryId === 'movies' ? 'movie' : 'episode')
          if (converted) {
            const { mediaItem, versions } = converted
            mediaItem.source_id = this.sourceId
            mediaItem.source_type = 'kodi'
            mediaItem.library_id = libraryId
            
            const id = await db.media.upsertItem(mediaItem)
            const scoredVersions = versions.map(v => ({ ...v, media_item_id: id, ...analyzer.analyzeVersion(v as any) }))
            db.media.syncItemVersions(id, scoredVersions as any)
            
            mediaItem.id = id
            await db.media.upsertQualityScore(await analyzer.analyzeMediaItem(mediaItem))
            result.itemsScanned++
          }
        }
      } finally { await db.endBatch() }

      result.success = true
    } catch (e: any) { result.errors.push(getErrorMessage(e)) }
    
    result.durationMs = Date.now() - startTime
    return result
  }

  async scanMusicLibrary(onProgress?: (p: any) => void): Promise<ScanResult> {
    const startTime = Date.now()
    const result: ScanResult = { success: false, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
    
    try {
      const db = getDatabase()
      const artists = (await this.rpc.call<{ artists: KodiMusicArtist[] }>('AudioLibrary.GetArtists', { properties: ['musicbrainzartistid', 'genre', 'description', 'thumbnail'] })).artists || []

      for (let i = 0; i < artists.length; i++) {
        const artist = artists[i]
        if (onProgress) onProgress({ current: i + 1, total: artists.length, phase: 'processing', currentItem: artist.artist, percentage: ((i + 1) / artists.length) * 100 })
        
        try {
          const artistId = await db.music.upsertArtist(this.mapper.convertToMusicArtist(artist, 'music'))
          const albums = (await this.rpc.call<{ albums: KodiMusicAlbum[] }>('AudioLibrary.GetAlbums', { filter: { artistid: artist.artistid }, properties: ['artistid', 'artist', 'displayartist', 'year', 'musicbrainzalbumid', 'musicbrainzreleasegroupid', 'genre', 'type', 'thumbnail'] })).albums || []
          
          let [tc, ac] = [0, 0]
          for (const album of albums) {
            const albumId = await db.music.upsertAlbum(this.mapper.convertToMusicAlbum(album, artistId, 'music'))
            const songs = (await this.rpc.call<{ songs: KodiMusicSong[] }>('AudioLibrary.GetSongs', { filter: { albumid: album.albumid }, properties: ['artistid', 'artist', 'displayartist', 'albumid', 'album', 'track', 'disc', 'duration', 'file', 'audio_codec', 'samplerate', 'bitdepth', 'musicbrainztrackid'] })).songs || []
            
            const trackDataList = songs.map(s => this.mapper.convertToMusicTrack(s, albumId, artistId, 'music')).filter(Boolean) as MusicTrack[]
            for (const t of trackDataList) { await db.music.upsertTrack(t); result.itemsScanned++ }
            
            const stats = calculateAlbumStats(trackDataList)
            await db.music.upsertAlbum({ ...this.mapper.convertToMusicAlbum(album, artistId, 'music'), ...stats, id: albumId })
            ac++; tc += trackDataList.length
          }
          await db.music.updateMusicArtistCounts(artistId, ac, tc)
        } catch (e: any) { result.errors.push(`Artist ${artist.artist}: ${getErrorMessage(e)}`) }
      }
      result.success = true
    } catch (e: any) { result.errors.push(getErrorMessage(e)) }
    
    result.durationMs = Date.now() - startTime
    return result
  }

  cancelMusicScan(): void {
    // Kodi scan is synchronous per artist/album, but we could add a flag if needed
  }
}
