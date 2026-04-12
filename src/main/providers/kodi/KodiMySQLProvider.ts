// @ts-nocheck
import { KodiSqlBaseProvider } from './KodiSqlBaseProvider'
import {
  SourceConfig,
  MediaLibrary,
  ProviderType,
  ProviderCredentials,
  AuthResult,
} from '../base/MediaProvider'
import {
  getKodiMySQLConnectionService,
  type KodiMySQLConfig,
} from '../../services/KodiMySQLConnectionService'
import {
  QUERY_MOVIE_COUNT,
  QUERY_EPISODE_COUNT,
  QUERY_MUSIC_SONG_COUNT
} from './KodiDatabaseSchema'
import { getLoggingService } from '../../services/LoggingService'
import { getErrorMessage } from '../../services/utils/errorUtils'
import type { Pool } from 'mysql2/promise'

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

  protected async queryAll<T>(sql: string, params: any[] = []): Promise<T[]> {
    const pool = await this.getVideoPool()
    // MySQL uses ? for placeholders, same as SQLite
    // We might need to adjust some syntax if it's too SQLite-specific
    const [rows] = await pool.execute(sql, params)
    return rows as T[]
  }

  protected async queryOne<T>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.queryAll<T>(sql, params)
    return rows.length > 0 ? rows[0] : null
  }

  private async getVideoPool(): Promise<Pool> {
    if (this.videoPool) return this.videoPool
    if (!this.mysqlConfig) throw new Error('MySQL config not found')
    
    const service = getKodiMySQLConnectionService()
    this.videoPool = await service.getConnection(this.mysqlConfig, 'video')
    return this.videoPool
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    const libraries: MediaLibrary[] = []
    try {
      // Adjust count queries for MySQL SIGNED vs INTEGER if needed
      // Actually COUNT(*) is portable.
      const movieCount = (await this.queryOne<any>(QUERY_MOVIE_COUNT))?.count || 0
      const episodeCount = (await this.queryOne<any>(QUERY_EPISODE_COUNT))?.count || 0

      if (movieCount > 0) libraries.push({ id: 'movies', name: 'Movies', type: 'movie', itemCount: movieCount })
      if (episodeCount > 0) libraries.push({ id: 'tvshows', name: 'TV Shows', type: 'show', itemCount: episodeCount })
      
      if (this.mysqlConfig?.musicDatabaseName) {
        const service = getKodiMySQLConnectionService()
        const mPool = await service.getConnection(this.mysqlConfig, 'music')
        const [rows] = await mPool.execute(QUERY_MUSIC_SONG_COUNT)
        const songCount = (rows as any)?.[0]?.count || 0
        if (songCount > 0) libraries.push({ id: 'music', name: 'Music', type: 'music', itemCount: songCount })
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
        databasePrefix: (credentials as any).databasePrefix || 'kodi_',
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

  async testConnection(): Promise<any> {
    try {
      await this.getVideoPool()
      return { success: true, serverName: 'Kodi MySQL Server' }
    } catch (err) {
      return { success: false, error: getErrorMessage(err) }
    }
  }

  async disconnect(): Promise<void> {
    const service = getKodiMySQLConnectionService()
    if (this.mysqlConfig) {
      await service.closeConnections(this.mysqlConfig)
      this.videoPool = null
      this.musicPool = null
    }
  }

  getConnectionConfig(): any {
    return this.mysqlConfig
  }
}
