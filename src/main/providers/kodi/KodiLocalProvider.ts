import { KodiSqlBaseProvider } from '@main/providers/kodi/KodiSqlBaseProvider'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import {
  SourceConfig,
  MediaLibrary,
  MediaMetadata,
  ProviderCredentials,
  AuthResult,
} from '@main/providers/base/MediaProvider'
import { LibraryType, ProviderType } from '@main/types/database'
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
import type { ConnectionTestResult } from '@main/types/ipc'

interface KodiCountRow { count?: number }

/**
 * KodiLocalProvider
 *
 * Implements the MediaProvider interface for a local Kodi installation.
 * Accesses Kodi's SQLite databases directly from the local file system.
 */
export class KodiLocalProvider extends KodiSqlBaseProvider {
  readonly providerType: ProviderType = 'kodi-local' as ProviderType

  private databasePath: string = ''
  private musicDatabasePath: string = ''
  private db: DatabaseSync | null = null
  private musicDb: DatabaseSync | null = null

  constructor(config: SourceConfig) {
    super(config)
    if (config.connectionConfig) {
      const localConfig = config.connectionConfig as { databasePath?: string; musicDatabasePath?: string }
      this.databasePath = localConfig.databasePath || ''
      this.musicDatabasePath = localConfig.musicDatabasePath || ''
    }
  }

  protected async queryAll<T>(sql: string, params: Array<string | number | null> = [], dbType: 'video' | 'music' = 'video'): Promise<T[]> {
    const db = dbType === 'music' ? await this.getMusicDb() : await this.getDb()
    return db.prepare(sql).all(...params) as T[]
  }

  protected async queryOne<T>(sql: string, params: Array<string | number | null> = [], dbType: 'video' | 'music' = 'video'): Promise<T | null> {
    const db = dbType === 'music' ? await this.getMusicDb() : await this.getDb()
    return (db.prepare(sql).get(...params) as T) || null
  }

  private async getDb(): Promise<DatabaseSync> {
    if (this.db) return this.db
    if (!this.databasePath || !fs.existsSync(this.databasePath)) {
      throw new Error(`Kodi database not found at: ${this.databasePath}`)
    }
    const { DatabaseSync } = await import('node:sqlite')
    this.db = new DatabaseSync(this.databasePath, { readOnly: true })
    return this.db
  }

  private async getMusicDb(): Promise<DatabaseSync> {
    if (this.musicDb) return this.musicDb
    if (!this.musicDatabasePath || !fs.existsSync(this.musicDatabasePath)) {
      throw new Error(`Kodi music database not found at: ${this.musicDatabasePath}`)
    }
    const { DatabaseSync } = await import('node:sqlite')
    this.musicDb = new DatabaseSync(this.musicDatabasePath, { readOnly: true })
    return this.musicDb
  }

  async getLibraries(): Promise<MediaLibrary[]> {
    const libraries: MediaLibrary[] = []
    try {
      const movieCount = (await this.queryOne<KodiCountRow>(QUERY_MOVIE_COUNT))?.count || 0
      const episodeCount = (await this.queryOne<KodiCountRow>(QUERY_EPISODE_COUNT))?.count || 0

      if (movieCount > 0) libraries.push({ id: 'movies', name: 'Movies', type: LibraryType.Movie, itemCount: movieCount })
      if (episodeCount > 0) libraries.push({ id: 'tvshows', name: 'TV Shows', type: LibraryType.Show, itemCount: episodeCount })
      
      if (this.musicDatabasePath && fs.existsSync(this.musicDatabasePath)) {
        const mdb = await this.getMusicDb()
        const songCount = (mdb.prepare(QUERY_MUSIC_SONG_COUNT).get() as KodiCountRow)?.count || 0
        if (songCount > 0) libraries.push({ id: 'music', name: 'Music', type: LibraryType.Music, itemCount: songCount })
      }
    } catch (err) {
      getLoggingService().error('[KodiLocalProvider]', 'Error reading video libraries:', err)
    }
    return libraries
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.getDb()
      return { success: true, serverName: 'Local Kodi SQLite' }
    } catch (err) {
      return { success: false, error: getErrorMessage(err) }
    }
  }

  async authenticate(credentials: ProviderCredentials): Promise<AuthResult> {
    const databasePath = credentials.databasePath
    if (!databasePath || !fs.existsSync(databasePath)) {
      return { success: false, error: `Kodi database not found at: ${databasePath || '(not configured)'}` }
    }
    this.databasePath = databasePath
    this.musicDatabasePath = credentials.musicDatabasePath || ''
    return { success: true, serverName: 'Local Kodi SQLite' }
  }

  async isAuthenticated(): Promise<boolean> {
    return Boolean(this.databasePath) && fs.existsSync(this.databasePath)
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
    if (this.db) {
      this.db.close()
      this.db = null
    }
    if (this.musicDb) {
      this.musicDb.close()
      this.musicDb = null
    }
  }



  cancelScan(): void {
    // Basic implementation for KodiLocal
  }

  async importCollections(_onProgress?: (progress: { current: number; total: number; currentItem: string }) => void): Promise<void> {
    // Stub
  }

  async getCollections(): Promise<never[]> {
    return []
  }

  setFFprobeAnalysis(_enabled: boolean): void {
    // Stub
  }

  isFFprobeAnalysisEnabled(): boolean {
    return false
  }

  isFFprobeAvailable(): boolean {
    return false
  }

  getFFprobeVersion(): string {
    return 'N/A'
  }
}
