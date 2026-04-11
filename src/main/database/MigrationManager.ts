import { DatabaseSync } from 'node:sqlite'
import { getLoggingService } from '../services/LoggingService'
import { DATABASE_SCHEMA } from './schema'

export interface Migration {
  version: number
  description: string
  run: (db: DatabaseSync) => void
}

export class MigrationManager {
  constructor(private db: DatabaseSync) {}

  public async runMigrations(migrations: Migration[]): Promise<void> {
    this.ensureSchemaVersionTable()

    const currentVersion = this.getCurrentVersion()
    const pendingMigrations = migrations
      .filter(m => m.version > currentVersion)
      .sort((a, b) => a.version - b.version)

    if (pendingMigrations.length === 0) {
      getLoggingService().info('[MigrationManager]', 'Database is up to date')
      return
    }

    getLoggingService().info(
      '[MigrationManager]',
      `Found ${pendingMigrations.length} pending migrations. Current version: ${currentVersion}`
    )

    for (const migration of pendingMigrations) {
      try {
        getLoggingService().info(
          '[MigrationManager]',
          `Executing migration ${migration.version}: ${migration.description}`
        )
        
        // Execute migration within a manual transaction if possible
        this.db.exec('BEGIN IMMEDIATE')
        migration.run(this.db)
        this.updateVersion(migration.version)
        this.db.exec('COMMIT')
        
        getLoggingService().info('[MigrationManager]', `Migration ${migration.version} completed successfully`)
      } catch (error) {
        this.db.exec('ROLLBACK')
        getLoggingService().error(
          '[MigrationManager]',
          `FATAL: Migration ${migration.version} failed. App initialization halted.`,
          error
        )
        throw error // Propagate error to halt app startup
      }
    }
  }

  private ensureSchemaVersionTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    
    // Initialize version 0 if table is empty
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM schema_version')
    const result = stmt.get() as { count: number }
    if (result.count === 0) {
      this.db.prepare('INSERT INTO schema_version (id, version) VALUES (1, 0)').run()
    }
  }

  private getCurrentVersion(): number {
    const stmt = this.db.prepare('SELECT version FROM schema_version WHERE id = 1')
    const result = stmt.get() as { version: number }
    return result?.version || 0
  }

  private updateVersion(version: number): void {
    const stmt = this.db.prepare('UPDATE schema_version SET version = ?, updated_at = datetime(\'now\') WHERE id = 1')
    stmt.run(version)
  }
}

/**
 * Baseline migration that establishes the core schema as of April 2026.
 * Note: This replaces the legacy silent runMigrations loop.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial Baseline Schema',
    run: (db: DatabaseSync) => {
      // Execute the full baseline schema
      db.exec(DATABASE_SCHEMA)
      
      // Perform one-time baseline logic previously in DatabaseMigration.ts
      db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_tmdb_id ON media_items(tmdb_id) WHERE tmdb_id IS NOT NULL')
      db.exec('CREATE INDEX IF NOT EXISTS idx_media_items_imdb_id ON media_items(imdb_id) WHERE imdb_id IS NOT NULL')
      db.exec('CREATE INDEX IF NOT EXISTS idx_series_completeness_tmdb_id ON series_completeness(tmdb_id) WHERE tmdb_id IS NOT NULL')
    }
  },
  {
    version: 2,
    description: 'Normalize Media Item Audio Tracks',
    run: (db: DatabaseSync) => {
      // Create new normalized table
      db.exec(`
        CREATE TABLE IF NOT EXISTS media_item_audio_tracks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          media_item_id INTEGER NOT NULL,
          track_index INTEGER NOT NULL,
          codec TEXT NOT NULL,
          channels INTEGER NOT NULL,
          bitrate INTEGER,
          language TEXT,
          title TEXT,
          is_default INTEGER DEFAULT 0,
          is_forced INTEGER DEFAULT 0,
          is_external INTEGER DEFAULT 0,
          
          FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
        )
      `)
      
      const items = db.prepare('SELECT id, audio_tracks FROM media_items WHERE audio_tracks IS NOT NULL AND audio_tracks != \'[]\'').all() as any[]
      
      const insertStmt = db.prepare(`
        INSERT INTO media_item_audio_tracks (
          media_item_id, track_index, codec, channels, bitrate, language, title, is_default, is_forced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      
      for (const item of items) {
        const tracks = JSON.parse(item.audio_tracks)
        if (Array.isArray(tracks)) {
          tracks.forEach((t: any, idx: number) => {
            insertStmt.run(
              item.id,
              t.index ?? idx,
              t.codec || 'unknown',
              t.channels || 2,
              t.bitrate || null,
              t.language || null,
              t.title || null,
              t.isDefault ? 1 : 0,
              t.isForced ? 1 : 0
            )
          })
        }
      }
    }
  },
  {
    version: 3,
    description: 'Normalize Missing Items (Series & Collections)',
    run: (db: DatabaseSync) => {
      // 1. Normalize Series Missing Episodes
      db.exec(`
        CREATE TABLE IF NOT EXISTS series_missing_episodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          series_completeness_id INTEGER NOT NULL,
          season_number INTEGER NOT NULL,
          episode_number INTEGER NOT NULL,
          title TEXT,
          air_date TEXT,
          
          FOREIGN KEY (series_completeness_id) REFERENCES series_completeness(id) ON DELETE CASCADE
        )
      `)
      
      const series = db.prepare('SELECT id, missing_episodes FROM series_completeness WHERE missing_episodes IS NOT NULL AND missing_episodes != \'[]\'').all() as any[]
      const insertEpStmt = db.prepare(`
        INSERT INTO series_missing_episodes (series_completeness_id, season_number, episode_number, title, air_date)
        VALUES (?, ?, ?, ?, ?)
      `)
      
      for (const s of series) {
        const episodes = JSON.parse(s.missing_episodes)
        if (Array.isArray(episodes)) {
          episodes.forEach((ep: any) => {
            insertEpStmt.run(s.id, ep.season_number, ep.episode_number, ep.title || null, ep.air_date || null)
          })
        }
      }

      // 2. Normalize Collection Missing Movies
      db.exec(`
        CREATE TABLE IF NOT EXISTS collection_missing_movies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_id INTEGER NOT NULL,
          tmdb_id TEXT NOT NULL,
          title TEXT NOT NULL,
          release_date TEXT,
          
          FOREIGN KEY (collection_id) REFERENCES movie_collections(id) ON DELETE CASCADE
        )
      `)
      
      const collections = db.prepare('SELECT id, missing_movies FROM movie_collections WHERE missing_movies IS NOT NULL AND missing_movies != \'[]\'').all() as any[]
      const insertMovieStmt = db.prepare(`
        INSERT INTO collection_missing_movies (collection_id, tmdb_id, title, release_date)
        VALUES (?, ?, ?, ?)
      `)
      
      for (const c of collections) {
        const movies = JSON.parse(c.missing_movies)
        if (Array.isArray(movies)) {
          movies.forEach((m: any) => {
            insertMovieStmt.run(c.id, String(m.tmdb_id), m.title, m.release_date || null)
          })
        }
      }
    }
  }
]
