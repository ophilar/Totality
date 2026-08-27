import { KodiSqlBaseProvider } from '@main/providers/kodi/KodiSqlBaseProvider'
import {
  SourceConfig,
  MediaLibrary,
  MediaMetadata,
  ProviderCredentials,
  AuthResult,
} from '@main/providers/base/MediaProvider'
import { LibraryType, ProviderType } from '@main/types/database'
import {
  getKodiMySQLConnectionService,
  type KodiMySQLConfig,
} from '@main/services/KodiMySQLConnectionService'
import {
  QUERY_MOVIE_COUNT,
  QUERY_EPISODE_COUNT,
  QUERY_MUSIC_SONG_COUNT,
  QUERY_MOVIE_BY_ID,
  QUERY_EPISODE_BY_ID,
  type KodiMovieWithDetails,
  type KodiEpisodeWithDetails,
} from '@main/providers/kodi/KodiDatabaseSchema'
import { KodiMappingUtils } from '@main/providers/kodi/KodiMappingUtils'
import { getLoggingService } from '@main/services/LoggingService'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import type { Pool } from 'mysql2/promise'
import type { ConnectionTestResult } from '@main/types/ipc'

interface KodiCountRow { count?: number }

/**
 * KodiMySQLProvider
 *
 * Implements the MediaProvider interface for Kodi by connecting to a MySQL/MariaDB
 * shared database.
 */
export class KodiMySQLProvider extends KodiSqlBaseProvider {
  readonly providerType: ProviderType = 'kodi-mysql' as ProviderType

  private mysqlConfig: KodiMySQLConfig | null = null
  private videoPool: Pool | null = null
  private musicPool: Pool | null = null

  constructor(config: SourceConfig) {
    super(config)
    if (config.connectionConfig) {
      this.mysqlConfig = config.connectionConfig as KodiMySQLConfig
    }
  }

  protected async queryAll<T>(sql: string, params: Array<string | number | null> = [], dbType: 'video' | 'music' = 'video'): Promise<T[]> {
    const pool = dbType === 'music' ? await this.getMusicPool() : await this.getVideoPool()
    // MySQL uses ? for placeholders, same as SQLite
    // We might need to adjust some syntax if it's too SQLite-specific
    const [rows] = await pool.execute(sql, params)
    return rows as T[]
  }

  protected async queryOne<T>(sql: string, params: Array<string | number | null> = [], dbType: 'video' | 'music' = 'video'): Promise<T | null> {
    const rows = await this.queryAll<T>(sql, params, dbType)
    return rows.length > 0 ? rows[0] : null
  }

  private async getVideoPool(): Promise<Pool> {
    if (this.videoPool) return this.videoPool
    if (!this.mysqlConfig) throw new Error('MySQL config not found')
    
    const service = getKodiMySQLConnectionService()
    return this.videoPool = await service.createPool(this.mysqlConfig, this.mysqlConfig.videoDatabaseName)
  }

  private async getMusicPool(): Promise<Pool> {
    if (this.musicPool) return this.musicPool
    if (!this.mysqlConfig) throw new Error('MySQL config not found')
    if (!this.mysqlConfig.musicDatabaseName) throw new Error('Music database not configured')

    const service = getKodiMySQLConnectionService()
    return this.musicPool = await service.createPool(this.mysqlConfig, this.mysqlConfig.musicDatabaseName)
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    const libraries: MediaLibrary[] = []
    try {
      // Adjust count queries for MySQL SIGNED vs INTEGER if needed
      // Actually COUNT(*) is portable.
      const movieCount = (await this.queryOne<KodiCountRow>(QUERY_MOVIE_COUNT))?.count || 0
      const episodeCount = (await this.queryOne<KodiCountRow>(QUERY_EPISODE_COUNT))?.count || 0

      if (movieCount > 0) libraries.push({ id: 'movies', name: 'Movies', type: LibraryType.Movie, itemCount: movieCount })
      if (episodeCount > 0) libraries.push({ id: 'tvshows', name: 'TV Shows', type: LibraryType.Show, itemCount: episodeCount })
      
      if (this.mysqlConfig?.musicDatabaseName) {
        const mPool = await this.getMusicPool()
        const [rows] = await mPool.execute(QUERY_MUSIC_SONG_COUNT)
        const songCount = (rows as KodiCountRow[])?.[0]?.count || 0
        if (songCount > 0) libraries.push({ id: 'music', name: 'Music', type: LibraryType.Music, itemCount: songCount })
      }
    } catch (err) {
      getLoggingService().error('[KodiMySQLProvider]', 'Error reading video libraries:', err)
    }
    return libraries
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    try {
      const config: KodiMySQLConfig = {
        host: credentials.host || '',
        port: credentials.port || 3306,
        username: credentials.username || '',
        password: credentials.password || '',
        databasePrefix: credentials.databasePrefix || 'kodi_',
      }
      
      const service = getKodiMySQLConnectionService()
      const detection = await service.detectDatabases(config)
      
      if (!detection.videoDatabase) {
        return { success: false, error: 'No Kodi video database detected' }
      }

      this.mysqlConfig = {
        ...config,
        videoDatabaseName: detection.videoDatabase,
        musicDatabaseName: detection.musicDatabase || undefined,
      }

      return { success: true, serverName: `Kodi MySQL (${config.host})` }
    } catch (err) {
      return { success: false, error: getErrorMessage(err) }
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.getVideoPool()
      return { success: true, serverName: 'Kodi MySQL Server' }
    } catch (err) {
      return { success: false, error: getErrorMessage(err) }
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return this.mysqlConfig !== null && Boolean(this.mysqlConfig.videoDatabaseName)
  }

  async getItemMetadata(itemId: string): Promise<MediaMetadata> {
    const id = Number(itemId)
    if (!Number.isInteger(id) || id < 0) throw new Error(`Invalid Kodi item ID: ${itemId}`)
    const movie = await this.queryOne<KodiMovieWithDetails>(QUERY_MOVIE_BY_ID, [id])
    if (movie) return KodiMappingUtils.mapMovieToMetadata(movie, this.sourceId)
    const episode = await this.queryOne<KodiEpisodeWithDetails>(QUERY_EPISODE_BY_ID, [id])
    if (episode) return KodiMappingUtils.mapEpisodeToMetadata(episode, this.sourceId)
    throw new Error(`Kodi item not found: ${itemId}`)
  }

  async disconnect(): Promise<void> {
    const service = getKodiMySQLConnectionService()
    if (this.mysqlConfig) {
      await service.closePool(this.mysqlConfig, this.mysqlConfig.videoDatabaseName)
      if (this.mysqlConfig.musicDatabaseName) await service.closePool(this.mysqlConfig, this.mysqlConfig.musicDatabaseName)
      this.videoPool = null
      this.musicPool = null
    }
  }

  getConnectionConfig(): KodiMySQLConfig {
    if (!this.mysqlConfig) throw new Error('Kodi MySQL connection is not configured')
    return this.mysqlConfig
  }
}
