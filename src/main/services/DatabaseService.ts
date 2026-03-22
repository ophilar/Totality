import { getErrorMessage } from './utils/errorUtils'
import initSqlJs, { Database } from 'sql.js'
import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import { DATABASE_SCHEMA } from '../database/schema'
import { runMigration as runMultiSourceMigration, MIGRATION_VERSION as MULTI_SOURCE_VERSION } from '../database/migrations/001_multi_source'
import { runMigration as runKodiLocalMigration, MIGRATION_VERSION as KODI_LOCAL_VERSION } from '../database/migrations/002_kodi_local_support'
import { getCredentialEncryptionService } from './CredentialEncryptionService'
import { MusicRepository } from './database/repositories/MusicRepository'
import { ConfigRepository } from './database/repositories/ConfigRepository'
import { StatsRepository } from './database/repositories/StatsRepository'
import { NotificationRepository } from './database/repositories/NotificationRepository'
import { MediaRepository } from './database/repositories/MediaRepository'
import { WishlistRepository } from './database/repositories/WishlistRepository'
import { CollectionsRepository } from './database/repositories/CollectionsRepository'
import { CompletenessRepository } from './database/repositories/CompletenessRepository'
import type {
  Notification,
  GetNotificationsOptions,
  NotificationCountResult,
} from '../types/monitoring'
import type {
  MediaItem,
  QualityScore,
  MediaItemFilters,
  SeriesCompleteness,
  MovieCollection,
  MediaSource,
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MusicQualityScore,
  ArtistCompleteness,
  AlbumCompleteness,
  MusicFilters,
  WishlistItem,
  WishlistFilters,
  TVShowSummary,
  TVShowFilters,
  MediaItemVersion,
} from '../types/database'

export class DatabaseService {
  private db: Database | null = null
  private dbPath: string
  private _isInitialized = false
  private batchMode = false
  private pendingSave = false

  // Write mutex to prevent concurrent saves
  private saveQueue: Promise<void> = Promise.resolve()
  private isSaving = false

  // Repository instances (lazy-initialized)
  private _musicRepo: MusicRepository | null = null
  private _configRepo: ConfigRepository | null = null
  private _statsRepo: StatsRepository | null = null
  private _notificationRepo: NotificationRepository | null = null
  private _mediaRepo: MediaRepository | null = null
  private _wishlistRepo: WishlistRepository | null = null
  private _collectionsRepo: CollectionsRepository | null = null
  private _completenessRepo: CompletenessRepository | null = null

  /** Check if database is initialized */
  get isInitialized(): boolean {
    return this._isInitialized
  }

  /** Get the music repository instance */
  private get musicRepo(): MusicRepository {
    if (!this._musicRepo) {
      this._musicRepo = new MusicRepository(
        () => this.db,
        () => this.save()
      )
    }
    return this._musicRepo
  }

  private get configRepo(): ConfigRepository {
    if (!this._configRepo) {
      this._configRepo = new ConfigRepository(
        () => this.db,
        () => this.save()
      )
    }
    return this._configRepo
  }

  private get statsRepo(): StatsRepository {
    if (!this._statsRepo) {
      this._statsRepo = new StatsRepository(() => this.db)
    }
    return this._statsRepo
  }

  private get notificationRepo(): NotificationRepository {
    if (!this._notificationRepo) {
      this._notificationRepo = new NotificationRepository(
        () => this.db,
        () => this.save(),
        () => this.startBatch(),
        () => this.endBatch()
      )
    }
    return this._notificationRepo
  }

  private get mediaRepo(): MediaRepository {
    if (!this._mediaRepo) {
      this._mediaRepo = new MediaRepository(
        () => this.db,
        () => this.save()
      )
    }
    return this._mediaRepo
  }

  private get wishlistRepo(): WishlistRepository {
    if (!this._wishlistRepo) {
      this._wishlistRepo = new WishlistRepository(
        () => this.db,
        () => this.save(),
        () => this.startBatch(),
        () => this.endBatch()
      )
    }
    return this._wishlistRepo
  }

  private get collectionsRepo(): CollectionsRepository {
    if (!this._collectionsRepo) {
      this._collectionsRepo = new CollectionsRepository(
        () => this.db,
        () => this.save()
      )
    }
    return this._collectionsRepo
  }

  private get completenessRepo(): CompletenessRepository {
    if (!this._completenessRepo) {
      this._completenessRepo = new CompletenessRepository(
        () => this.db,
        () => this.save()
      )
    }
    return this._completenessRepo
  }


  constructor() {
    // Store database in user data directory
    const userDataPath = app.getPath('userData')
    this.dbPath = path.join(userDataPath, 'totality.db')
  }

  /**
   * Initialize the database
   */
  async initialize(): Promise<void> {
    if (this._isInitialized) {
      return
    }

    try {
      // Initialize SQL.js
      const SQL = await initSqlJs()

      // Check if database file exists
      let dbBuffer: Buffer | null = null
      try {
        dbBuffer = await fs.readFile(this.dbPath)
      } catch (error) {
        // Database doesn't exist yet
        console.log('Creating new database...')
      }

      // Create or load database
      if (dbBuffer) {
        this.db = new SQL.Database(dbBuffer)
        console.log('[Database] Database loaded from:', path.basename(this.dbPath))

        // Verify database integrity
        if (!await this.verifyIntegrity()) {
          console.warn('[Database] Integrity check failed, attempting restore from backup...')
          await this.restoreFromBackup(SQL)
        }
      } else {
        this.db = new SQL.Database()
        console.log('New database created')
      }

      // Run schema migrations
      await this.runMigrations()

      this._isInitialized = true
      console.log('Database initialized successfully')
    } catch (error) {
      console.error('Failed to initialize database:', error)
      throw error
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    try {
      // Check if quality_scores table exists and has the UNIQUE constraint
      const tableInfo = this.db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='quality_scores'`)

      if (tableInfo.length > 0 && tableInfo[0].values.length > 0) {
        const createTableSQL = tableInfo[0].values[0][0] as string

        // If UNIQUE constraint is missing, we need to recreate the table
        if (!createTableSQL.includes('UNIQUE')) {
          console.log('Migrating quality_scores table to add UNIQUE constraint...')

          // Backup existing data
          this.db.run('CREATE TABLE quality_scores_backup AS SELECT * FROM quality_scores')

          // Drop old table
          this.db.run('DROP TABLE quality_scores')

          // Create new table with UNIQUE constraint (from schema)
          // Schema will be executed below

          // Note: data will be lost, but this is acceptable for dev
          console.log('quality_scores table recreated with UNIQUE constraint')
        } else {
          // Try to add new tier columns if they don't exist
          const alterTableStatements = [
            'ALTER TABLE quality_scores ADD COLUMN quality_tier TEXT NOT NULL DEFAULT \'SD\'',
            'ALTER TABLE quality_scores ADD COLUMN tier_quality TEXT NOT NULL DEFAULT \'MEDIUM\'',
            'ALTER TABLE quality_scores ADD COLUMN tier_score INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE quality_scores ADD COLUMN bitrate_tier_score INTEGER NOT NULL DEFAULT 0',
            'ALTER TABLE quality_scores ADD COLUMN audio_tier_score INTEGER NOT NULL DEFAULT 0'
          ]

          for (const statement of alterTableStatements) {
            try {
              this.db.run(statement)
              console.log(`Added column: ${statement}`)
            } catch (error: unknown) {
              // Ignore "duplicate column" errors - column already exists
              if (!getErrorMessage(error)?.includes('duplicate column name')) {
                console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
              }
            }
          }
        }
      }

      // Migration: movie_collections - ensure we have tmdb_collection_id column
      // MUST run BEFORE schema execution since schema creates indexes on the column
      const movieCollectionsInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='movie_collections'`
      )
      if (movieCollectionsInfo.length > 0 && movieCollectionsInfo[0].values.length > 0) {
        const createTableSQL = movieCollectionsInfo[0].values[0][0] as string
        // If table has plex_collection_id (old schema), drop and recreate with tmdb_collection_id
        if (createTableSQL && createTableSQL.includes('plex_collection_id')) {
          console.log('Migrating movie_collections: plex_collection_id → tmdb_collection_id')
          this.db.run('DROP TABLE IF EXISTS movie_collections')
          this.db.run('DROP TABLE IF EXISTS media_item_collections')
          console.log('movie_collections table dropped for migration (will be recreated)')
        }
      }

      // Pre-migration: Add source_id and source_type columns to media_items if they don't exist
      // MUST run BEFORE schema execution since schema creates indexes on these columns
      const mediaItemsInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='media_items'`
      )
      if (mediaItemsInfo.length > 0 && mediaItemsInfo[0].values.length > 0) {
        const createTableSQL = mediaItemsInfo[0].values[0][0] as string
        // If table exists but doesn't have source_id column, add it
        if (createTableSQL && !createTableSQL.includes('source_id')) {
          console.log('Pre-migration: Adding source_id column to media_items...')
          try {
            this.db.run(`ALTER TABLE media_items ADD COLUMN source_id TEXT NOT NULL DEFAULT 'legacy'`)
          } catch (e: unknown) {
            if (!getErrorMessage(e).includes('duplicate column')) {
              console.log('Could not add source_id column:', getErrorMessage(e))
            }
          }
        }
        if (createTableSQL && !createTableSQL.includes('source_type')) {
          console.log('Pre-migration: Adding source_type column to media_items...')
          try {
            this.db.run(`ALTER TABLE media_items ADD COLUMN source_type TEXT NOT NULL DEFAULT 'plex'`)
          } catch (e: unknown) {
            if (!getErrorMessage(e).includes('duplicate column')) {
              console.log('Could not add source_type column:', getErrorMessage(e))
            }
          }
        }
        // Add library_id column BEFORE schema execution (schema creates indexes on it)
        if (createTableSQL && !createTableSQL.includes('library_id')) {
          console.log('Pre-migration: Adding library_id column to media_items...')
          try {
            this.db.run(`ALTER TABLE media_items ADD COLUMN library_id TEXT`)
          } catch (e: unknown) {
            if (!getErrorMessage(e).includes('duplicate column')) {
              console.log('Could not add library_id column:', getErrorMessage(e))
            }
          }
        }
      }

      // Pre-migration: Add library_id to music tables if they exist
      const musicTables = ['music_artists', 'music_albums', 'music_tracks']
      for (const tableName of musicTables) {
        const tableInfo = this.db.exec(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`
        )
        if (tableInfo.length > 0 && tableInfo[0].values.length > 0) {
          const createTableSQL = tableInfo[0].values[0][0] as string
          if (createTableSQL && !createTableSQL.includes('library_id')) {
            console.log(`Pre-migration: Adding library_id column to ${tableName}...`)
            try {
              this.db.run(`ALTER TABLE ${tableName} ADD COLUMN library_id TEXT`)
            } catch (e: unknown) {
              if (!getErrorMessage(e).includes('duplicate column')) {
                console.log(`Could not add library_id column to ${tableName}:`, getErrorMessage(e))
              }
            }
          }
        }
      }

      // Pre-migration: Add source_id/library_id to series_completeness if it exists
      const seriesInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='series_completeness'`
      )
      if (seriesInfo.length > 0 && seriesInfo[0].values.length > 0) {
        const createTableSQL = seriesInfo[0].values[0][0] as string
        if (createTableSQL && !createTableSQL.includes('source_id')) {
          console.log('Pre-migration: Adding source_id column to series_completeness...')
          try {
            this.db.run(`ALTER TABLE series_completeness ADD COLUMN source_id TEXT`)
          } catch (e: unknown) {
            if (!getErrorMessage(e).includes('duplicate column')) {
              console.log('Could not add source_id column:', getErrorMessage(e))
            }
          }
        }
        if (createTableSQL && !createTableSQL.includes('library_id')) {
          console.log('Pre-migration: Adding library_id column to series_completeness...')
          try {
            this.db.run(`ALTER TABLE series_completeness ADD COLUMN library_id TEXT`)
          } catch (e: unknown) {
            if (!getErrorMessage(e).includes('duplicate column')) {
              console.log('Could not add library_id column:', getErrorMessage(e))
            }
          }
        }
      }

      // Pre-migration: Add source_id/library_id to movie_collections if it exists
      const collectionsInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='movie_collections'`
      )
      if (collectionsInfo.length > 0 && collectionsInfo[0].values.length > 0) {
        const createTableSQL = collectionsInfo[0].values[0][0] as string
        if (createTableSQL && !createTableSQL.includes('source_id')) {
          console.log('Pre-migration: Adding source_id column to movie_collections...')
          try {
            this.db.run(`ALTER TABLE movie_collections ADD COLUMN source_id TEXT`)
          } catch (e: unknown) {
            if (!getErrorMessage(e).includes('duplicate column')) {
              console.log('Could not add source_id column:', getErrorMessage(e))
            }
          }
        }
        if (createTableSQL && !createTableSQL.includes('library_id')) {
          console.log('Pre-migration: Adding library_id column to movie_collections...')
          try {
            this.db.run(`ALTER TABLE movie_collections ADD COLUMN library_id TEXT`)
          } catch (e: unknown) {
            if (!getErrorMessage(e).includes('duplicate column')) {
              console.log('Could not add library_id column:', getErrorMessage(e))
            }
          }
        }
      }

      // Pre-migration: Add wishlist_items upgrade feature columns (must run BEFORE schema for indexes)
      const wishlistInfo = this.db.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='wishlist_items'`
      )
      if (wishlistInfo.length > 0 && wishlistInfo[0].values.length > 0) {
        const createTableSQL = wishlistInfo[0].values[0][0] as string
        if (createTableSQL && !createTableSQL.includes('reason')) {
          console.log('Pre-migration: Adding upgrade columns to wishlist_items...')
          const wishlistAlterStatements = [
            "ALTER TABLE wishlist_items ADD COLUMN reason TEXT DEFAULT 'missing'",
            'ALTER TABLE wishlist_items ADD COLUMN current_quality_tier TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_quality_level TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_resolution TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_video_codec TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN current_audio_codec TEXT',
            'ALTER TABLE wishlist_items ADD COLUMN media_item_id INTEGER'
          ]
          for (const statement of wishlistAlterStatements) {
            try {
              this.db.run(statement)
              console.log(`Added wishlist column: ${statement}`)
            } catch (e: unknown) {
              if (!getErrorMessage(e).includes('duplicate column')) {
                console.log(`Could not add wishlist column:`, getErrorMessage(e))
              }
            }
          }
        }
      }

      // Add status tracking columns to wishlist_items
      const wishlistStatusAlterStatements = [
        "ALTER TABLE wishlist_items ADD COLUMN status TEXT DEFAULT 'active'",
        'ALTER TABLE wishlist_items ADD COLUMN completed_at TEXT'
      ]
      for (const statement of wishlistStatusAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`Added wishlist column: ${statement}`)
        } catch (e: unknown) {
          if (!getErrorMessage(e).includes('duplicate column')) {
            console.log(`Could not add wishlist column:`, getErrorMessage(e))
          }
        }
      }

      // Migration: Add 'kodi-mysql' to source_type CHECK constraints for existing databases
      try {
        const checkInfo = this.db.exec(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='media_sources'"
        )
        if (checkInfo.length > 0 && checkInfo[0].values.length > 0) {
          const schemaSQL = checkInfo[0].values[0][0] as string
          if (schemaSQL && !schemaSQL.includes('kodi-mysql')) {
            this.db.run('PRAGMA writable_schema = ON')
            const tables = ['media_sources', 'media_items', 'music_artists', 'music_albums', 'music_tracks']
            for (const table of tables) {
              // Handle migration 001 format (missing 'local')
              this.db.run(
                `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = '${table}'`
              )
              // Handle schema.ts format (has 'local')
              this.db.run(
                `UPDATE sqlite_master SET sql = replace(sql, '''kodi-local'', ''local''))', '''kodi-local'', ''kodi-mysql'', ''local''))') WHERE type = 'table' AND name = '${table}'`
              )
            }
            this.db.run('PRAGMA writable_schema = OFF')
            this.db.run('PRAGMA integrity_check')
            console.log('[Database] Migration: Added kodi-mysql to source_type CHECK constraints')
          }
        }
      } catch (e: unknown) {
        console.log('[Database] kodi-mysql CHECK migration note:', getErrorMessage(e))
      }

      // Execute main schema (CREATE TABLE IF NOT EXISTS)
      this.db.run(DATABASE_SCHEMA)

      // Add new artwork columns to media_items if they don't exist
      const mediaItemsAlterStatements = [
        'ALTER TABLE media_items ADD COLUMN episode_thumb_url TEXT',
        'ALTER TABLE media_items ADD COLUMN season_poster_url TEXT'
      ]

      for (const statement of mediaItemsAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`Added column: ${statement}`)
        } catch (error: unknown) {
          // Ignore "duplicate column" errors - column already exists
          if (!getErrorMessage(error)?.includes('duplicate column name')) {
            console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
          }
        }
      }

      // Add enhanced quality metadata columns to media_items
      const enhancedQualityAlterStatements = [
        'ALTER TABLE media_items ADD COLUMN video_frame_rate REAL',
        'ALTER TABLE media_items ADD COLUMN color_bit_depth INTEGER',
        'ALTER TABLE media_items ADD COLUMN hdr_format TEXT',
        'ALTER TABLE media_items ADD COLUMN color_space TEXT',
        'ALTER TABLE media_items ADD COLUMN video_profile TEXT',
        'ALTER TABLE media_items ADD COLUMN video_level INTEGER',
        'ALTER TABLE media_items ADD COLUMN audio_profile TEXT',
        'ALTER TABLE media_items ADD COLUMN audio_sample_rate INTEGER',
        'ALTER TABLE media_items ADD COLUMN has_object_audio INTEGER DEFAULT 0',
        'ALTER TABLE media_items ADD COLUMN container TEXT'
      ]

      for (const statement of enhancedQualityAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`[Database] Added enhanced quality column: ${statement}`)
        } catch (error: unknown) {
          // Ignore "duplicate column" errors - column already exists
          if (!getErrorMessage(error)?.includes('duplicate column name')) {
            console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
          }
        }
      }

      // Add series_completeness metadata columns if they don't exist
      const seriesCompletenessAlterStatements = [
        'ALTER TABLE series_completeness ADD COLUMN tmdb_id TEXT',
        'ALTER TABLE series_completeness ADD COLUMN poster_url TEXT',
        'ALTER TABLE series_completeness ADD COLUMN backdrop_url TEXT',
        'ALTER TABLE series_completeness ADD COLUMN status TEXT'
      ]

      for (const statement of seriesCompletenessAlterStatements) {
        try {
          this.db.run(statement)
          console.log(`[Database] Added series_completeness column: ${statement}`)
        } catch (error: unknown) {
          // Ignore "duplicate column" errors - column already exists
          if (!getErrorMessage(error)?.includes('duplicate column name')) {
            console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
          }
        }
      }

      // Add series_tmdb_id column to media_items for storing show-level TMDB ID
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN series_tmdb_id TEXT')
        console.log('[Database] Added series_tmdb_id column to media_items')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Add user_fixed_match column to media_items for preserving user-selected matches during rescans
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN user_fixed_match INTEGER DEFAULT 0')
        console.log('[Database] Added user_fixed_match column to media_items')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Add user_fixed_match column to music_artists for preserving user-selected matches during rescans
      try {
        this.db.run('ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0')
        console.log('[Database] Added user_fixed_match column to music_artists')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Add user_fixed_match column to music_albums for preserving user-selected matches during rescans
      try {
        this.db.run('ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0')
        console.log('[Database] Added user_fixed_match column to music_albums')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Add audio_tracks column to media_items for storing all audio track info
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN audio_tracks TEXT')
        console.log('[Database] Added audio_tracks column to media_items')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Add subtitle_tracks column to media_items
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN subtitle_tracks TEXT')
        console.log('[Database] Added subtitle_tracks column to media_items')
      } catch (error: unknown) {
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Add file_mtime column to media_items for skip-unchanged-files optimization
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN file_mtime INTEGER')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Add file_mtime column to music_tracks for delta scanning optimization
      try {
        this.db.run('ALTER TABLE music_tracks ADD COLUMN file_mtime INTEGER')
        console.log('[Database] Added file_mtime column to music_tracks')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Run multi-source migration if needed
      let currentMigrationVersion = this.db.exec(`SELECT value FROM settings WHERE key = 'migration_version'`)
      let currentVersion = parseInt(currentMigrationVersion[0]?.values[0]?.[0] as string || '0', 10) || 0

      if (currentVersion < MULTI_SOURCE_VERSION) {
        console.log(`Running multi-source migration (current: ${currentVersion}, target: ${MULTI_SOURCE_VERSION})...`)
        await runMultiSourceMigration(this.db)
      } else {
        console.log(`Multi-source migration already applied (version: ${currentVersion})`)
      }

      // Run kodi-local migration if needed
      currentMigrationVersion = this.db.exec(`SELECT value FROM settings WHERE key = 'migration_version'`)
      currentVersion = parseInt(currentMigrationVersion[0]?.values[0]?.[0] as string || '0', 10) || 0

      if (currentVersion < KODI_LOCAL_VERSION) {
        console.log(`Running kodi-local migration (current: ${currentVersion}, target: ${KODI_LOCAL_VERSION})...`)
        await runKodiLocalMigration(this.db)
      } else {
        console.log(`Kodi-local migration already applied (version: ${currentVersion})`)
      }

      // Add is_enabled column to library_scans for library selection feature
      try {
        this.db.run('ALTER TABLE library_scans ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1')
        console.log('[Database] Added is_enabled column to library_scans')
      } catch (error: unknown) {
        // Ignore "duplicate column" errors - column already exists
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Migration: Add UNIQUE constraints to wishlist_items to prevent duplicates
      const wishlistUniqueCheck = this.db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_wishlist_items_unique_tmdb'"
      )
      if (!wishlistUniqueCheck.length || !wishlistUniqueCheck[0].values.length) {
        console.log('Adding unique constraints to wishlist_items...')

        // First, remove any existing duplicates (keep the oldest entry by lowest id)
        try {
          this.db.run(`
            DELETE FROM wishlist_items
            WHERE id NOT IN (
              SELECT MIN(id) FROM wishlist_items
              GROUP BY
                COALESCE(tmdb_id, ''),
                COALESCE(musicbrainz_id, ''),
                COALESCE(media_item_id, 0),
                media_type,
                COALESCE(series_title, ''),
                COALESCE(season_number, -1),
                COALESCE(reason, 'missing')
            )
          `)
          console.log('Removed duplicate wishlist items')
        } catch (e: unknown) {
          console.log('Could not remove duplicates:', getErrorMessage(e))
        }

        // Create unique indexes to prevent future duplicates
        const wishlistUniqueIndexes = [
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_tmdb
           ON wishlist_items(tmdb_id, reason)
           WHERE tmdb_id IS NOT NULL`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_musicbrainz
           ON wishlist_items(musicbrainz_id, reason)
           WHERE musicbrainz_id IS NOT NULL`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_media_item
           ON wishlist_items(media_item_id)
           WHERE media_item_id IS NOT NULL AND reason = 'upgrade'`,
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlist_items_unique_season
           ON wishlist_items(series_title, season_number, reason)
           WHERE media_type = 'season' AND tmdb_id IS NULL AND series_title IS NOT NULL`
        ]

        for (const indexSql of wishlistUniqueIndexes) {
          try {
            this.db.run(indexSql)
            console.log('Created wishlist unique index')
          } catch (e: unknown) {
            console.log('Could not create wishlist unique index:', getErrorMessage(e))
          }
        }
      }

      // Create exclusions table if it doesn't exist (for existing databases)
      try {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS exclusions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exclusion_type TEXT NOT NULL CHECK(exclusion_type IN (
              'media_upgrade',
              'collection_movie',
              'series_episode',
              'artist_album'
            )),
            reference_id INTEGER,
            reference_key TEXT,
            parent_key TEXT,
            title TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `)
        this.db.run('CREATE INDEX IF NOT EXISTS idx_exclusions_type_ref ON exclusions(exclusion_type, reference_id)')
        this.db.run('CREATE INDEX IF NOT EXISTS idx_exclusions_type_key ON exclusions(exclusion_type, reference_key, parent_key)')
      } catch (error: unknown) {
        console.log('[Database] Exclusions table migration:', getErrorMessage(error))
      }

      // Add sort_title column to media_items
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN sort_title TEXT')
      } catch { /* column may already exist */ }

      // Add version_count column to media_items for multi-version support
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN version_count INTEGER NOT NULL DEFAULT 1')
        console.log('[Database] Added version_count column to media_items')
      } catch (error: unknown) {
        if (!getErrorMessage(error)?.includes('duplicate column name')) {
          console.log(`[Database] ALTER TABLE error (may be expected): ${getErrorMessage(error)}`)
        }
      }

      // Populate media_item_versions from existing media_items (one version per item)
      try {
        const versionCount = this.db.exec('SELECT COUNT(*) FROM media_item_versions')
        const count = versionCount[0]?.values[0]?.[0] as number || 0
        if (count === 0) {
          const itemCount = this.db.exec('SELECT COUNT(*) FROM media_items')
          const items = itemCount[0]?.values[0]?.[0] as number || 0
          if (items > 0) {
            console.log(`[Database] Migrating ${items} existing items to versions table...`)
            this.db.run(`
              INSERT INTO media_item_versions (
                media_item_id, version_source, file_path, file_size, duration,
                resolution, width, height, video_codec, video_bitrate,
                audio_codec, audio_channels, audio_bitrate,
                video_frame_rate, color_bit_depth, hdr_format, color_space,
                video_profile, video_level, audio_profile, audio_sample_rate,
                has_object_audio, audio_tracks, subtitle_tracks, container, file_mtime,
                is_best, created_at, updated_at
              )
              SELECT
                id, 'primary', file_path, file_size, duration,
                resolution, width, height, video_codec, video_bitrate,
                audio_codec, audio_channels, audio_bitrate,
                video_frame_rate, color_bit_depth, hdr_format, color_space,
                video_profile, video_level, audio_profile, audio_sample_rate,
                has_object_audio, audio_tracks, subtitle_tracks, container, file_mtime,
                1, created_at, updated_at
              FROM media_items
            `)
            console.log(`[Database] Migrated ${items} items to versions table`)
          }
        }
      } catch (error: unknown) {
        const msg = getErrorMessage(error)
        if (!msg?.includes('no such table')) {
          console.error('[Database] Version migration error:', msg)
        }
      }

      // Add summary column to media_items
      try {
        this.db.run('ALTER TABLE media_items ADD COLUMN summary TEXT')
      } catch { /* column may already exist */ }

      // Migrate existing plain-text credentials to encrypted format
      await this.migrateCredentialsToEncrypted()

      // Clean up orphaned records from prior cascade delete bugs
      try {
        this.db.run(
          'DELETE FROM quality_scores WHERE media_item_id NOT IN (SELECT id FROM media_items)'
        )
        this.db.run(
          'DELETE FROM media_item_versions WHERE media_item_id NOT IN (SELECT id FROM media_items)'
        )
        this.db.run(
          'DELETE FROM media_item_collections WHERE media_item_id NOT IN (SELECT id FROM media_items)'
        )
      } catch (err) {
        console.warn('[Database] Orphan cleanup skipped:', err)
      }

      console.log('Database migrations completed')
    } catch (error) {
      console.error('Failed to run migrations:', error)
      throw error
    }
  }

  /**
   * Save database to disk
   * In batch mode, saves are deferred until endBatch() is called
   * Uses a mutex to prevent concurrent writes
   */
  async save(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // In batch mode, mark as pending but don't actually save yet
    if (this.batchMode) {
      this.pendingSave = true
      return
    }

    // Queue this save operation to prevent concurrent writes
    this.saveQueue = this.saveQueue.then(() => this.performSave())
    await this.saveQueue
  }

  /**
   * Start batch mode - defers disk writes for better performance
   * Call endBatch() when done to persist all changes
   */
  startBatch(): void {
    this.batchMode = true
    this.pendingSave = false
    console.log('Database batch mode started')
  }

  /**
   * End batch mode and save all pending changes
   */
  async endBatch(): Promise<void> {
    this.batchMode = false

    if (this.pendingSave) {
      console.log('Database batch mode ended, saving pending changes...')
      await this.forceSave()
    } else {
      console.log('Database batch mode ended, no pending changes')
    }
  }

  /**
   * Force save to disk, bypassing batch mode
   * Useful for periodic checkpoints during long operations
   * Uses a mutex to prevent concurrent writes
   */
  async forceSave(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // Queue this save operation to prevent concurrent writes
    this.saveQueue = this.saveQueue.then(() => this.performSave())
    await this.saveQueue
  }

  /**
   * Internal method to perform the actual save with atomic writes
   * Uses temp file + rename pattern for safer writes
   */
  private async performSave(): Promise<void> {
    if (this.isSaving || !this.db) return

    this.isSaving = true
    const tempPath = `${this.dbPath}.tmp`
    const backupPath = `${this.dbPath}.bak`

    try {
      const data = this.db.export()

      // Write to temp file first
      await fs.writeFile(tempPath, data)

      // Backup existing database (if it exists)
      if (await this.fileExists(this.dbPath)) {
        try {
          await fs.rename(this.dbPath, backupPath)
        } catch (backupError) {
          // If backup fails, try to copy instead (cross-device moves fail)
          await fs.copyFile(this.dbPath, backupPath)
          await fs.unlink(this.dbPath)
        }
      }

      // Atomic rename temp to actual
      await fs.rename(tempPath, this.dbPath)

      this.pendingSave = false
    } catch (error) {
      console.error('Failed to save database:', error)
      // Try to clean up temp file
      try {
        await fs.unlink(tempPath)
      } catch {
        // Ignore cleanup errors
      }
      throw error
    } finally {
      this.isSaving = false
    }
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Verify database integrity using PRAGMA integrity_check
   */
  private async verifyIntegrity(): Promise<boolean> {
    if (!this.db) return false

    try {
      const result = this.db.exec('PRAGMA integrity_check')
      const status = result[0]?.values[0]?.[0]
      if (status === 'ok') {
        console.log('[Database] Integrity check passed')
        return true
      }
      console.error('[Database] Integrity check failed:', status)
      return false
    } catch (error) {
      console.error('[Database] Integrity check error:', error)
      return false
    }
  }

  /**
   * Restore database from backup file
   */
  private async restoreFromBackup(SQL: Awaited<ReturnType<typeof initSqlJs>>): Promise<void> {
    const backupPath = `${this.dbPath}.bak`

    if (await this.fileExists(backupPath)) {
      try {
        const backupData = await fs.readFile(backupPath)
        this.db = new SQL.Database(backupData)
        console.log('[Database] Restored from backup')

        // Verify restored database
        if (!await this.verifyIntegrity()) {
          throw new Error('Backup database is also corrupted')
        }
        return
      } catch (error) {
        console.error('[Database] Failed to restore from backup:', error)
      }
    }

    // No backup or backup is also corrupted - create fresh database
    this.db = new SQL.Database()
    console.log('[Database] Created fresh database (no valid backup available)')
  }

  /**
   * Check if in batch mode
   */
  isInBatchMode(): boolean {
    return this.batchMode
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.save()
      this.db.close()
      this.db = null
      this._isInitialized = false
    }
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.dbPath
  }

  /** Valid table names for export/import/reset — used to prevent SQL injection */
  private static readonly ALLOWED_TABLES = new Set([
    'media_sources',
    'media_items',
    'quality_scores',
    'settings',
    'series_completeness',
    'movie_collections',
    'music_artists',
    'music_albums',
    'music_tracks',
    'music_quality_scores',
    'artist_completeness',
    'album_completeness',
  ])

  /** Validate a table name against the allowlist */
  private assertValidTable(table: string): void {
    if (!DatabaseService.ALLOWED_TABLES.has(table)) {
      throw new Error(`Invalid table name: ${table}`)
    }
  }

  /**
   * Export all database data to JSON
   */
  exportData(): Record<string, unknown[]> {
    if (!this.db) throw new Error('Database not initialized')

    const tables = [...DatabaseService.ALLOWED_TABLES]

    const exportedData: Record<string, unknown[]> = {
      _meta: [{
        exportedAt: new Date().toISOString(),
        version: '1.0',
        tables: tables,
      }]
    }

    for (const table of tables) {
      try {
        this.assertValidTable(table)
        const result = this.db.exec(`SELECT * FROM ${table}`)
        if (result.length > 0) {
          const columns = result[0].columns
          const rows = result[0].values.map(row => {
            const obj: Record<string, unknown> = {}
            columns.forEach((col, i) => {
              obj[col] = row[i]
            })
            return obj
          })
          exportedData[table] = rows
        } else {
          exportedData[table] = []
        }
      } catch (error) {
        console.log(`Table ${table} not found or error, skipping`)
        exportedData[table] = []
      }
    }

    return exportedData
  }

  /**
   * Export working document CSV for tracking upgrades and completions
   */
  exportWorkingCSV(options: {
    includeUpgrades: boolean
    includeMissingMovies: boolean
    includeMissingEpisodes: boolean
    includeMissingAlbums: boolean
  }): string {
    if (!this.db) throw new Error('Database not initialized')

    const sections: string[] = []

    if (options.includeUpgrades) {
      sections.push(this.buildUpgradeCandidatesSection())
    }
    if (options.includeMissingMovies) {
      sections.push(this.buildMissingMoviesSection())
    }
    if (options.includeMissingEpisodes) {
      sections.push(this.buildMissingEpisodesSection())
    }
    if (options.includeMissingAlbums) {
      sections.push(this.buildMissingAlbumsSection())
    }

    return sections.filter(s => s.length > 0).join('\n\n')
  }

  /**
   * Build the Upgrade Candidates section of the CSV
   */
  private buildUpgradeCandidatesSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        mi.title,
        mi.year,
        mi.type,
        mi.series_title,
        mi.season_number,
        mi.episode_number,
        qs.quality_tier,
        mi.resolution,
        mi.video_bitrate,
        mi.audio_channels,
        mi.video_codec,
        mi.tmdb_id,
        mi.imdb_id,
        mi.file_path
      FROM media_items mi
      JOIN quality_scores qs ON qs.media_item_id = mi.id
      WHERE qs.needs_upgrade = 1
      ORDER BY qs.quality_tier, mi.type, mi.title
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== UPGRADE CANDIDATES ===\nNo items need upgrading.'
    }

    const header = '=== UPGRADE CANDIDATES ==='
    const columnHeader = 'Title,Year,Type,Series,Season,Episode,Current Tier,Target Tier,Resolution,Video Bitrate,Audio Channels,Codec,TMDB ID,IMDB ID,File Path'

    const rows = result[0].values.map(row => {
      const [title, year, type, seriesTitle, seasonNum, episodeNum, qualityTier, resolution, videoBitrate, audioChannels, videoCodec, tmdbId, imdbId, filePath] = row

      // Determine target tier (next level up)
      const tierOrder = ['SD', '720p', '1080p', '4K']
      const currentIndex = tierOrder.indexOf(qualityTier as string)
      const targetTier = currentIndex < tierOrder.length - 1 ? tierOrder[currentIndex + 1] : qualityTier

      return [
        this.escapeCSV(title as string || ''),
        year || '',
        type || '',
        this.escapeCSV(seriesTitle as string || ''),
        seasonNum || '',
        episodeNum || '',
        qualityTier || '',
        targetTier,
        resolution || '',
        videoBitrate || '',
        audioChannels || '',
        videoCodec || '',
        tmdbId || '',
        imdbId || '',
        this.escapeCSV(filePath as string || '')
      ].join(',')
    })

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Build the Missing Movies section of the CSV
   */
  private buildMissingMoviesSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        mc.collection_name,
        mc.missing_movies
      FROM movie_collections mc
      WHERE mc.missing_movies IS NOT NULL
        AND mc.missing_movies != '[]'
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== MISSING MOVIES (Collections) ===\nNo missing movies found.'
    }

    const header = '=== MISSING MOVIES (Collections) ==='
    const columnHeader = 'Collection Name,Movie Title,Year,TMDB ID'

    const rows: string[] = []

    for (const row of result[0].values) {
      const [collectionName, missingMoviesJson] = row

      try {
        const missingMovies = JSON.parse(missingMoviesJson as string || '[]') as Array<{
          title: string
          year?: number
          tmdb_id: string
        }>

        for (const movie of missingMovies) {
          rows.push([
            this.escapeCSV(collectionName as string || ''),
            this.escapeCSV(movie.title || ''),
            movie.year || '',
            movie.tmdb_id || ''
          ].join(','))
        }
      } catch (e) {
        console.log('Error parsing missing movies JSON:', e)
      }
    }

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Build the Missing Episodes section of the CSV
   */
  private buildMissingEpisodesSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        sc.series_title,
        sc.missing_episodes,
        sc.tmdb_id
      FROM series_completeness sc
      WHERE sc.missing_episodes IS NOT NULL
        AND sc.missing_episodes != '[]'
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== MISSING TV EPISODES ===\nNo missing episodes found.'
    }

    const header = '=== MISSING TV EPISODES ==='
    const columnHeader = 'Series Title,Season,Episode,Episode Title,Air Date,TMDB ID'

    const rows: string[] = []

    for (const row of result[0].values) {
      const [seriesTitle, missingEpisodesJson, tmdbId] = row

      try {
        const missingEpisodes = JSON.parse(missingEpisodesJson as string || '[]') as Array<{
          season_number: number
          episode_number: number
          title?: string
          air_date?: string
        }>

        for (const episode of missingEpisodes) {
          rows.push([
            this.escapeCSV(seriesTitle as string || ''),
            episode.season_number || '',
            episode.episode_number || '',
            this.escapeCSV(episode.title || ''),
            episode.air_date || '',
            tmdbId || ''
          ].join(','))
        }
      } catch (e) {
        console.log('Error parsing missing episodes JSON:', e)
      }
    }

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Build the Missing Albums section of the CSV
   */
  private buildMissingAlbumsSection(): string {
    if (!this.db) return ''

    const result = this.db.exec(`
      SELECT
        ac.artist_name,
        ac.missing_albums,
        ac.missing_singles,
        ac.missing_eps
      FROM artist_completeness ac
      WHERE (ac.missing_albums IS NOT NULL AND ac.missing_albums != '[]')
         OR (ac.missing_singles IS NOT NULL AND ac.missing_singles != '[]')
         OR (ac.missing_eps IS NOT NULL AND ac.missing_eps != '[]')
    `)

    if (result.length === 0 || result[0].values.length === 0) {
      return '=== MISSING ALBUMS ===\nNo missing albums found.'
    }

    const header = '=== MISSING ALBUMS ==='
    const columnHeader = 'Artist Name,Album Title,Year,Album Type,MusicBrainz ID'

    const rows: string[] = []

    for (const row of result[0].values) {
      const [artistName, missingAlbumsJson, missingSinglesJson, missingEpsJson] = row

      // Process albums
      try {
        const albums = JSON.parse(missingAlbumsJson as string || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const album of albums) {
          rows.push([
            this.escapeCSV(artistName as string || ''),
            this.escapeCSV(album.title || ''),
            album.year || '',
            'Album',
            album.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }

      // Process singles
      try {
        const singles = JSON.parse(missingSinglesJson as string || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const single of singles) {
          rows.push([
            this.escapeCSV(artistName as string || ''),
            this.escapeCSV(single.title || ''),
            single.year || '',
            'Single',
            single.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }

      // Process EPs
      try {
        const eps = JSON.parse(missingEpsJson as string || '[]') as Array<{
          title: string
          year?: number
          musicbrainz_id: string
        }>
        for (const ep of eps) {
          rows.push([
            this.escapeCSV(artistName as string || ''),
            this.escapeCSV(ep.title || ''),
            ep.year || '',
            'EP',
            ep.musicbrainz_id || ''
          ].join(','))
        }
      } catch (e) { /* ignore */ }
    }

    return [header, columnHeader, ...rows].join('\n')
  }

  /**
   * Escape a value for CSV (handle commas, quotes, newlines)
   */
  private escapeCSV(value: string): string {
    if (!value) return ''
    // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return '"' + value.replace(/"/g, '""') + '"'
    }
    return value
  }

  /**
   * Import data from JSON export
   */
  async importData(data: Record<string, unknown[]>): Promise<{ imported: number; errors: string[] }> {
    if (!this.db) throw new Error('Database not initialized')

    const errors: string[] = []
    let imported = 0

    // Tables to import in order (respecting foreign keys)
    const importOrder = [
      'settings',
      'media_sources',
      'media_items',
      'quality_scores',
      'series_completeness',
      'movie_collections',
      'music_artists',
      'music_albums',
      'music_tracks',
      'music_quality_scores',
      'artist_completeness',
      'album_completeness',
    ]

    this.startBatch()

    try {
      for (const table of importOrder) {
        if (!data[table] || !Array.isArray(data[table]) || data[table].length === 0) {
          continue
        }
        this.assertValidTable(table)

        const rows = data[table] as Record<string, unknown>[]

        for (const row of rows) {
          try {
            const columns = Object.keys(row).filter(k => row[k] !== undefined)
            const values = columns.map(k => row[k]) as (string | number | null | Uint8Array)[]
            const placeholders = columns.map(() => '?').join(', ')

            // Use INSERT OR REPLACE to handle existing data
            // Note: table and column names are validated against allowlist above
            const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
            this.db.run(sql, values)
            imported++
          } catch (error: unknown) {
            errors.push(`${table}: ${getErrorMessage(error)}`)
          }
        }
      }
    } catch (error: unknown) {
      errors.push(`Import failed: ${getErrorMessage(error)}`)
    } finally {
      await this.endBatch()
    }

    return { imported, errors }
  }

  /**
   * Reset the database (delete all data)
   */
  async resetDatabase(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const tables = [
      'album_completeness',
      'artist_completeness',
      'music_quality_scores',
      'music_tracks',
      'music_albums',
      'music_artists',
      'movie_collections',
      'series_completeness',
      'quality_scores',
      'media_items',
      'media_sources',
      'settings',
    ]

    for (const table of tables) {
      try {
        this.assertValidTable(table)
        this.db.run(`DELETE FROM ${table}`)
      } catch (error) {
        console.log(`Could not clear table ${table}`)
      }
    }

    await this.save()
  }

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  async upsertMediaItem(item: MediaItem): Promise<number> {
    return this.mediaRepo.upsertMediaItem(item)
  }

  getMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): MediaItem[] {
    return this.mediaRepo.getMediaItems(filters)
  }

  countMediaItems(filters?: MediaItemFilters & { includeDisabledLibraries?: boolean }): number {
    return this.mediaRepo.countMediaItems(filters)
  }

  getMediaItemById(id: number): MediaItem | null {
    return this.mediaRepo.getMediaItemById(id)
  }

  getMediaItemsByTmdbIds(tmdbIds: string[]): Map<string, MediaItem> {
    return this.mediaRepo.getMediaItemsByTmdbIds(tmdbIds)
  }

  getEpisodeCountBySeriesTmdbId(seriesTmdbId: string): number {
    return this.mediaRepo.getEpisodeCountBySeriesTmdbId(seriesTmdbId)
  }

  getMediaItemByPath(filePath: string): MediaItem | null {
    return this.mediaRepo.getMediaItemByPath(filePath)
  }

  async deleteMediaItem(id: number): Promise<void> {
    return this.mediaRepo.deleteMediaItem(id)
  }

  upsertMediaItemVersion(version: MediaItemVersion): number {
    return this.mediaRepo.upsertMediaItemVersion(version)
  }

  getMediaItemVersions(mediaItemId: number): MediaItemVersion[] {
    return this.mediaRepo.getMediaItemVersions(mediaItemId)
  }

  deleteMediaItemVersions(mediaItemId: number): void {
    return this.mediaRepo.deleteMediaItemVersions(mediaItemId)
  }

  syncMediaItemVersions(mediaItemId: number, versions: MediaItemVersion[]): void {
    return this.mediaRepo.syncMediaItemVersions(mediaItemId, versions)
  }

  updateBestVersion(mediaItemId: number): void {
    return this.mediaRepo.updateBestVersion(mediaItemId)
  }

  async updateMediaItemArtwork(
    sourceId: string,
    plexId: string,
    artwork: {
      posterUrl?: string
      episodeThumbUrl?: string
      seasonPosterUrl?: string
    }
  ): Promise<void> {
    return this.mediaRepo.updateMediaItemArtwork(sourceId, plexId, artwork)
  }

  async updateSeriesMatch(
    seriesTitle: string,
    sourceId: string,
    tmdbId: string,
    posterUrl?: string,
    newSeriesTitle?: string
  ): Promise<number> {
    return this.mediaRepo.updateSeriesMatch(seriesTitle, sourceId, tmdbId, posterUrl, newSeriesTitle)
  }

  async updateMovieMatch(
    mediaItemId: number,
    tmdbId: string,
    posterUrl?: string,
    title?: string,
    year?: number
  ): Promise<void> {
    return this.mediaRepo.updateMovieMatch(mediaItemId, tmdbId, posterUrl, title, year)
  }

  async updateMovieWithTMDBId(
    mediaItemId: number,
    tmdbId: string
  ): Promise<void> {
    return this.mediaRepo.updateMovieWithTMDBId(mediaItemId, tmdbId)
  }

  async removeStaleMediaItems(validPlexIds: Set<string>, type: 'movie' | 'episode'): Promise<number> {
    return this.mediaRepo.removeStaleMediaItems(validPlexIds, type)
  }

  async upsertQualityScore(score: QualityScore): Promise<number> {
    return this.mediaRepo.upsertQualityScore(score)
  }

  getQualityScores(): QualityScore[] {
    return this.mediaRepo.getQualityScores()
  }

  getQualityScoreByMediaId(mediaItemId: number): QualityScore | null {
    return this.mediaRepo.getQualityScoreByMediaId(mediaItemId)
  }

  // ============================================================================
  // SETTINGS
  // ============================================================================

  getSetting(key: string): string | null {
    return this.configRepo.getSetting(key)
  }

  async setSetting(key: string, value: string): Promise<void> {
    return this.configRepo.setSetting(key, value)
  }

  getAllSettings(): Record<string, string> {
    return this.configRepo.getAllSettings()
  }

  getSettingsByPrefix(prefix: string): Record<string, string> {
    return this.configRepo.getSettingsByPrefix(prefix)
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  getLibraryStats(sourceId?: string): ReturnType<StatsRepository['getLibraryStats']> {
    return this.statsRepo.getLibraryStats(sourceId)
  }

  // ============================================================================
  // MEDIA SOURCES
  // ============================================================================

  /**
   * Insert or update a media source
   * Connection config is automatically encrypted before storage
   */
  async upsertMediaSource(source: Omit<MediaSource, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    if (!this.db) throw new Error('Database not initialized')

    // Encrypt sensitive fields in connection config
    const encryption = getCredentialEncryptionService()
    let connectionConfigToStore = source.connection_config

    try {
      const config = JSON.parse(source.connection_config)
      const encryptedConfig = encryption.encryptConnectionConfig(config)
      connectionConfigToStore = JSON.stringify(encryptedConfig)
    } catch {
      // If parsing fails, store as-is (shouldn't happen with valid JSON)
      console.warn('[DatabaseService] Failed to parse connection_config for encryption')
    }

    const sql = `
      INSERT INTO media_sources (
        source_id, source_type, display_name, connection_config, is_enabled,
        last_connected_at, last_scan_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        source_type = excluded.source_type,
        display_name = excluded.display_name,
        connection_config = excluded.connection_config,
        is_enabled = excluded.is_enabled,
        last_connected_at = excluded.last_connected_at,
        last_scan_at = excluded.last_scan_at
    `

    this.db.run(sql, [
      source.source_id,
      source.source_type,
      source.display_name,
      connectionConfigToStore,
      source.is_enabled ? 1 : 0,
      source.last_connected_at || null,
      source.last_scan_at || null,
    ])

    await this.save()
    return source.source_id
  }

  /**
   * Get all media sources
   * Connection config is automatically decrypted after retrieval
   */
  getMediaSources(type?: string): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM media_sources'
    const params: string[] = []

    if (type) {
      sql += ' WHERE source_type = ?'
      params.push(type)
    }

    sql += ' ORDER BY display_name ASC'

    const result = this.db.exec(sql, params)
    if (!result.length) return []

    const encryption = getCredentialEncryptionService()

    return this.rowsToObjects<MediaSource>(result[0]).map(source => {
      // Decrypt sensitive fields in connection config
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if parsing fails
      }

      return {
        ...source,
        connection_config: decryptedConfig,
        is_enabled: Boolean(source.is_enabled),
      }
    })
  }

  /**
   * Get enabled media sources
   * Connection config is automatically decrypted after retrieval
   */
  getEnabledMediaSources(): MediaSource[] {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT * FROM media_sources WHERE is_enabled = 1 ORDER BY display_name ASC'
    )
    if (!result.length) return []

    const encryption = getCredentialEncryptionService()

    return this.rowsToObjects<MediaSource>(result[0]).map(source => {
      // Decrypt sensitive fields in connection config
      let decryptedConfig = source.connection_config
      try {
        const config = JSON.parse(source.connection_config)
        const decrypted = encryption.decryptConnectionConfig(config)
        decryptedConfig = JSON.stringify(decrypted)
      } catch {
        // Keep original if parsing fails
      }

      return {
        ...source,
        connection_config: decryptedConfig,
        is_enabled: true,
      }
    })
  }

  /**
   * Get a media source by ID
   * Connection config is automatically decrypted after retrieval
   */
  getMediaSourceById(sourceId: string): MediaSource | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT * FROM media_sources WHERE source_id = ?',
      [sourceId]
    )
    if (!result.length) return null

    const sources = this.rowsToObjects<MediaSource>(result[0])
    if (!sources[0]) return null

    // Decrypt sensitive fields in connection config
    const encryption = getCredentialEncryptionService()
    let decryptedConfig = sources[0].connection_config
    try {
      const config = JSON.parse(sources[0].connection_config)
      const decrypted = encryption.decryptConnectionConfig(config)
      decryptedConfig = JSON.stringify(decrypted)
    } catch {
      // Keep original if parsing fails
    }

    return {
      ...sources[0],
      connection_config: decryptedConfig,
      is_enabled: Boolean(sources[0].is_enabled),
    }
  }

  /**
   * Update media source connection timestamp
   */
  async updateSourceConnectionTime(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `UPDATE media_sources SET last_connected_at = datetime('now') WHERE source_id = ?`,
      [sourceId]
    )
    await this.save()
  }

  /**
   * Update media source scan timestamp
   */
  async updateSourceScanTime(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `UPDATE media_sources SET last_scan_at = datetime('now') WHERE source_id = ?`,
      [sourceId]
    )
    await this.save()
  }

  // ============================================================================
  // LIBRARY SCAN TIMESTAMPS
  // ============================================================================

  /**
   * Update library scan timestamp
   */
  async updateLibraryScanTime(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    itemsScanned: number = 0
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
       VALUES (?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(source_id, library_id) DO UPDATE SET
         library_name = excluded.library_name,
         library_type = excluded.library_type,
         last_scan_at = datetime('now'),
         items_scanned = excluded.items_scanned`,
      [sourceId, libraryId, libraryName, libraryType, itemsScanned]
    )
    await this.save()
  }

  /**
   * Get library scan timestamp
   */
  getLibraryScanTime(sourceId: string, libraryId: string): string | null {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?',
      [sourceId, libraryId]
    )

    return result[0]?.values[0]?.[0] as string | null
  }

  /**
   * Get all library scan times for a source
   */
  getLibraryScanTimes(sourceId: string): Map<string, { lastScanAt: string; itemsScanned: number }> {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT library_id, last_scan_at, items_scanned FROM library_scans WHERE source_id = ?',
      [sourceId]
    )

    const map = new Map<string, { lastScanAt: string; itemsScanned: number }>()
    if (result.length > 0) {
      for (const row of result[0].values) {
        map.set(row[0] as string, {
          lastScanAt: row[1] as string,
          itemsScanned: (row[2] as number) || 0,
        })
      }
    }

    return map
  }

  /**
   * Delete library scan records for a source (called when source is deleted)
   */
  async deleteLibraryScanTimes(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run('DELETE FROM library_scans WHERE source_id = ?', [sourceId])
    await this.save()
  }

  /**
   * Check if a library is enabled
   */
  isLibraryEnabled(sourceId: string, libraryId: string): boolean {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT is_enabled FROM library_scans WHERE source_id = ? AND library_id = ?',
      [sourceId, libraryId]
    )

    // If no record exists, library is enabled by default
    if (!result[0]?.values[0]) return true
    return (result[0].values[0][0] as number) === 1
  }

  /**
   * Get all libraries for a source with their enabled status
   */
  getSourceLibraries(sourceId: string): Array<{
    libraryId: string
    libraryName: string
    libraryType: string
    isEnabled: boolean
    lastScanAt: string | null
    itemsScanned: number
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      `SELECT library_id, library_name, library_type, is_enabled, last_scan_at, items_scanned
       FROM library_scans WHERE source_id = ?`,
      [sourceId]
    )

    if (!result[0]) return []

    return result[0].values.map(row => ({
      libraryId: row[0] as string,
      libraryName: row[1] as string,
      libraryType: row[2] as string,
      isEnabled: (row[3] as number) === 1,
      lastScanAt: row[4] as string | null,
      itemsScanned: (row[5] as number) || 0,
    }))
  }

  /**
   * Get enabled library IDs for a source
   */
  getEnabledLibraryIds(sourceId: string): string[] {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(
      'SELECT library_id FROM library_scans WHERE source_id = ? AND is_enabled = 1',
      [sourceId]
    )

    if (!result[0]) return []
    return result[0].values.map(row => row[0] as string)
  }

  /**
   * Toggle a library's enabled status
   */
  async toggleLibrary(sourceId: string, libraryId: string, enabled: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    // Check if record exists
    const existing = this.db.exec(
      'SELECT id FROM library_scans WHERE source_id = ? AND library_id = ?',
      [sourceId, libraryId]
    )

    if (existing[0]?.values[0]) {
      // Update existing record
      this.db.run(
        'UPDATE library_scans SET is_enabled = ? WHERE source_id = ? AND library_id = ?',
        [enabled ? 1 : 0, sourceId, libraryId]
      )
    } else {
      // Insert new record (library hasn't been scanned yet)
      this.db.run(
        `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
         VALUES (?, ?, '', 'unknown', datetime('now'), 0, ?)`,
        [sourceId, libraryId, enabled ? 1 : 0]
      )
    }
    await this.save()
  }

  /**
   * Set library enabled status with metadata (used during initial setup)
   */
  async setLibraryEnabled(
    sourceId: string,
    libraryId: string,
    libraryName: string,
    libraryType: string,
    enabled: boolean
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
       VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
       ON CONFLICT(source_id, library_id) DO UPDATE SET
         library_name = excluded.library_name,
         library_type = excluded.library_type,
         is_enabled = excluded.is_enabled`,
      [sourceId, libraryId, libraryName, libraryType, enabled ? 1 : 0]
    )
    await this.save()
  }

  /**
   * Set multiple libraries' enabled status at once (batch operation)
   */
  async setLibrariesEnabled(
    sourceId: string,
    libraries: Array<{ id: string; name: string; type: string; enabled: boolean }>
  ): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.startBatch()
    for (const lib of libraries) {
      this.db.run(
        `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned, is_enabled)
         VALUES (?, ?, ?, ?, datetime('now'), 0, ?)
         ON CONFLICT(source_id, library_id) DO UPDATE SET
           library_name = excluded.library_name,
           library_type = excluded.library_type,
           is_enabled = excluded.is_enabled`,
        [sourceId, lib.id, lib.name, lib.type, lib.enabled ? 1 : 0]
      )
    }
    await this.endBatch()
  }

  /**
   * Toggle media source enabled status
   */
  async toggleMediaSource(sourceId: string, enabled: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      'UPDATE media_sources SET is_enabled = ? WHERE source_id = ?',
      [enabled ? 1 : 0, sourceId]
    )
    await this.save()
  }

  /**
   * Delete a media source and ALL its associated data
   */
  async deleteMediaSource(sourceId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    console.log(`[Database] Deleting source ${sourceId} and all associated data...`)

    // Delete quality scores for media items from this source
    this.db.run(
      `DELETE FROM quality_scores WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete wishlist items that reference media items being deleted (upgrade items)
    // Must be before media_items deletion since it references media_items
    this.db.run(
      `DELETE FROM wishlist_items WHERE media_item_id IN (
        SELECT id FROM media_items WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete media items
    this.db.run('DELETE FROM media_items WHERE source_id = ?', [sourceId])

    // Delete music quality scores for albums from this source
    this.db.run(
      `DELETE FROM music_quality_scores WHERE album_id IN (
        SELECT id FROM music_albums WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete album completeness data for albums from this source
    this.db.run(
      `DELETE FROM album_completeness WHERE album_id IN (
        SELECT id FROM music_albums WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete artist completeness data for artists from this source
    this.db.run(
      `DELETE FROM artist_completeness WHERE artist_name IN (
        SELECT name FROM music_artists WHERE source_id = ?
      )`,
      [sourceId]
    )

    // Delete music tracks
    this.db.run('DELETE FROM music_tracks WHERE source_id = ?', [sourceId])

    // Delete music albums
    this.db.run('DELETE FROM music_albums WHERE source_id = ?', [sourceId])

    // Delete music artists
    this.db.run('DELETE FROM music_artists WHERE source_id = ?', [sourceId])

    // Delete series completeness data for this source
    this.db.run('DELETE FROM series_completeness WHERE source_id = ?', [sourceId])

    // Delete movie collections data for this source
    this.db.run('DELETE FROM movie_collections WHERE source_id = ?', [sourceId])

    // Delete library scan timestamps
    this.db.run('DELETE FROM library_scans WHERE source_id = ?', [sourceId])

    // Delete notifications for this source
    this.db.run('DELETE FROM notifications WHERE source_id = ?', [sourceId])

    // Delete the source itself
    this.db.run('DELETE FROM media_sources WHERE source_id = ?', [sourceId])

    await this.save()
    console.log(`[Database] Deleted media source and all data: ${sourceId}`)
  }

  /** Get media items count by source */
  getMediaItemsCountBySource(sourceId: string): number {
    return this.statsRepo.getMediaItemsCountBySource(sourceId)
  }

  /** Get aggregated stats across all sources */
  getAggregatedSourceStats(): ReturnType<StatsRepository['getAggregatedSourceStats']> {
    return this.statsRepo.getAggregatedSourceStats()
  }

  // ============================================================================
  // SERIES COMPLETENESS
  // ============================================================================

  async upsertSeriesCompleteness(
    data: Omit<SeriesCompleteness, 'id' | 'created_at' | 'updated_at'>
  ): Promise<number> {
    return this.completenessRepo.upsertSeriesCompleteness(data)
  }

  getSeriesCompleteness(sourceId?: string): SeriesCompleteness[] {
    return this.completenessRepo.getSeriesCompleteness(sourceId)
  }

  getAllSeriesCompleteness(sourceId?: string, libraryId?: string): SeriesCompleteness[] {
    return this.completenessRepo.getAllSeriesCompleteness(sourceId, libraryId)
  }

  getSeriesCompletenessByTitle(seriesTitle: string, sourceId?: string, libraryId?: string): SeriesCompleteness | null {
    return this.completenessRepo.getSeriesCompletenessByTitle(seriesTitle, sourceId, libraryId)
  }

  getIncompleteSeries(sourceId?: string): SeriesCompleteness[] {
    return this.completenessRepo.getIncompleteSeries(sourceId)
  }

  async deleteSeriesCompleteness(id: number): Promise<boolean> {
    return this.completenessRepo.deleteSeriesCompleteness(id)
  }

  getTVShows(filters?: TVShowFilters): TVShowSummary[] {
    return this.completenessRepo.getTVShows(filters)
  }

  countTVShows(filters?: TVShowFilters): number {
    return this.completenessRepo.countTVShows(filters)
  }

  countTVEpisodes(filters?: TVShowFilters): number {
    return this.completenessRepo.countTVEpisodes(filters)
  }

  getLetterOffset(
    table: 'movies' | 'tvshows' | 'artists' | 'albums',
    letter: string,
    filters?: { sourceId?: string; libraryId?: string }
  ): number {
    return this.completenessRepo.getLetterOffset(table, letter, filters)
  }

  getEpisodesForSeries(seriesTitle: string, sourceId?: string, libraryId?: string): MediaItem[] {
    return this.completenessRepo.getEpisodesForSeries(seriesTitle, sourceId, libraryId)
  }

  getSeriesCompletenessStats(): {
    totalSeries: number
    completeSeries: number
    incompleteSeries: number
    totalMissingEpisodes: number
    averageCompleteness: number
  } {
    return this.completenessRepo.getSeriesCompletenessStats()
  }

  // ============================================================================
  // MOVIE COLLECTIONS
  // ============================================================================

  async upsertMovieCollection(
    data: Omit<MovieCollection, 'id' | 'created_at' | 'updated_at'>
  ): Promise<number> {
    return this.collectionsRepo.upsertMovieCollection(data)
  }

  getMovieCollections(sourceId?: string): MovieCollection[] {
    return this.collectionsRepo.getMovieCollections(sourceId)
  }

  getMovieCollectionByTmdbId(tmdbCollectionId: string): MovieCollection | null {
    return this.collectionsRepo.getMovieCollectionByTmdbId(tmdbCollectionId)
  }

  getIncompleteMovieCollections(sourceId?: string): MovieCollection[] {
    return this.collectionsRepo.getIncompleteMovieCollections(sourceId)
  }

  async deleteMovieCollection(id: number): Promise<boolean> {
    return this.collectionsRepo.deleteMovieCollection(id)
  }

  async clearMovieCollections(sourceId?: string): Promise<void> {
    return this.collectionsRepo.clearMovieCollections(sourceId)
  }

  async deleteSingleMovieCollections(): Promise<number> {
    return this.collectionsRepo.deleteSingleMovieCollections()
  }

  getMovieCollectionStats(): {
    total: number
    complete: number
    incomplete: number
    totalMissing: number
    avgCompleteness: number
  } {
    return this.collectionsRepo.getMovieCollectionStats()
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Migrate existing plain-text credentials to encrypted format
   * This runs during database initialization to encrypt any unencrypted credentials
   */
  private async migrateCredentialsToEncrypted(): Promise<void> {
    const encryption = getCredentialEncryptionService()

    if (!encryption.isEncryptionAvailable()) {
      console.log('[DatabaseService] Skipping credential encryption migration - not available on this platform')
      return
    }

    // Check if migration was already done
    const migrationDone = this.db!.exec(`SELECT value FROM settings WHERE key = 'credentials_encrypted'`)
    if (migrationDone.length > 0 && migrationDone[0].values[0]?.[0] === '1') {
      return
    }

    console.log('[DatabaseService] Migrating existing credentials to encrypted format...')

    let sourcesEncrypted = 0
    let settingsEncrypted = 0

    // Migrate media source credentials (read raw from DB, don't go through decryption)
    const sourcesResult = this.db!.exec('SELECT source_id, connection_config FROM media_sources')
    if (sourcesResult.length > 0) {
      for (const row of sourcesResult[0].values) {
        const sourceId = row[0] as string
        const connectionConfig = row[1] as string

        try {
          const config = JSON.parse(connectionConfig)
          let needsUpdate = false

          // Check if any sensitive field is unencrypted
          const sensitiveFields = ['token', 'accessToken', 'apiKey', 'password', 'secret']
          for (const field of sensitiveFields) {
            if (typeof config[field] === 'string' && config[field] && !encryption.isEncrypted(config[field])) {
              needsUpdate = true
              break
            }
          }

          if (needsUpdate) {
            const encryptedConfig = encryption.encryptConnectionConfig(config)
            this.db!.run(
              'UPDATE media_sources SET connection_config = ? WHERE source_id = ?',
              [JSON.stringify(encryptedConfig), sourceId]
            )
            sourcesEncrypted++
          }
        } catch (error) {
          console.error(`[DatabaseService] Failed to migrate source ${sourceId}:`, error)
        }
      }
    }

    // Migrate sensitive settings (read raw from DB)
    const sensitiveSettingsKeys = ['plex_token', 'tmdb_api_key', 'musicbrainz_api_token', 'gemini_api_key']
    for (const key of sensitiveSettingsKeys) {
      const result = this.db!.exec('SELECT value FROM settings WHERE key = ?', [key])
      if (result.length > 0) {
        const value = result[0].values[0]?.[0] as string
        if (value && !encryption.isEncrypted(value)) {
          const encryptedValue = encryption.encrypt(value)
          this.db!.run(
            'UPDATE settings SET value = ? WHERE key = ?',
            [encryptedValue, key]
          )
          settingsEncrypted++
        }
      }
    }

    // Mark migration as complete
    this.db!.run(
      `INSERT INTO settings (key, value) VALUES ('credentials_encrypted', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`
    )

    if (sourcesEncrypted > 0 || settingsEncrypted > 0) {
      await this.forceSave()
      console.log(`[DatabaseService] Credential migration complete: ${sourcesEncrypted} sources, ${settingsEncrypted} settings encrypted`)
    } else {
      console.log('[DatabaseService] No credentials needed migration')
    }
  }

  /**
   * Convert SQL.js result rows to objects
   */
  private rowsToObjects<T>(result: { columns: string[]; values: unknown[][] }): T[] {
    const { columns, values } = result
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col, index) => {
        obj[col] = row[index]
      })
      return obj as T
    })
  }

  // ============================================================================
  // MUSIC OPERATIONS (Delegated to MusicRepository)
  // ============================================================================

  /** Insert or update a music artist */
  async upsertMusicArtist(artist: MusicArtist): Promise<number> {
    return this.musicRepo.upsertArtist(artist)
  }

  /** Insert or update a music album */
  async upsertMusicAlbum(album: MusicAlbum): Promise<number> {
    return this.musicRepo.upsertAlbum(album)
  }

  /** Update artwork URLs for a music album */
  async updateMusicAlbumArtwork(
    sourceIdOrAlbumId: string | number,
    providerIdOrThumbUrl?: string,
    artwork?: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    return this.musicRepo.updateAlbumArtwork(sourceIdOrAlbumId, providerIdOrThumbUrl, artwork)
  }

  /** Update artwork URL for a music artist */
  async updateMusicArtistArtwork(
    sourceId: string,
    providerId: string,
    artwork: { thumbUrl?: string; artUrl?: string }
  ): Promise<void> {
    return this.musicRepo.updateArtistArtwork(sourceId, providerId, artwork)
  }

  /** Insert or update a music track */
  async upsertMusicTrack(track: MusicTrack): Promise<number> {
    return this.musicRepo.upsertTrack(track)
  }

  /** Update artist album and track counts */
  async updateMusicArtistCounts(artistId: number, albumCount: number, trackCount: number): Promise<void> {
    return this.musicRepo.updateArtistCounts(artistId, albumCount, trackCount)
  }

  /** Update artist MusicBrainz ID */
  async updateMusicArtistMbid(artistId: number, musicbrainzId: string): Promise<void> {
    return this.musicRepo.updateArtistMbid(artistId, musicbrainzId)
  }

  /** Update album MusicBrainz ID */
  async updateMusicAlbumMbid(albumId: number, musicbrainzId: string): Promise<void> {
    return this.musicRepo.updateAlbumMbid(albumId, musicbrainzId)
  }

  /** Get all music artists */
  getMusicArtists(filters?: MusicFilters): MusicArtist[] {
    return this.musicRepo.getArtists(filters)
  }

  /** Get a music artist by ID */
  getMusicArtistById(id: number): MusicArtist | null {
    return this.musicRepo.getArtistById(id)
  }

  /** Get a music artist by name and source */
  getMusicArtistByName(name: string, sourceId: string): MusicArtist | null {
    return this.musicRepo.getArtistByName(name, sourceId)
  }

  /** Get all music albums */
  getMusicAlbums(filters?: MusicFilters): MusicAlbum[] {
    return this.musicRepo.getAlbums(filters)
  }

  /** Get a music album by title and artist ID */
  getMusicAlbumByName(title: string, artistId: number): MusicAlbum | null {
    return this.musicRepo.getAlbumByName(title, artistId)
  }

  /** Get music albums by artist name */
  getMusicAlbumsByArtistName(artistName: string): MusicAlbum[] {
    return this.musicRepo.getAlbumsByArtistName(artistName)
  }

  /** Get a music album by ID */
  getMusicAlbumById(id: number): MusicAlbum | null {
    return this.musicRepo.getAlbumById(id)
  }

  /** Get all music tracks */
  getMusicTracks(filters?: MusicFilters): MusicTrack[] {
    return this.musicRepo.getTracks(filters)
  }

  /** Count music artists matching filters */
  countMusicArtists(filters?: MusicFilters): number {
    return this.musicRepo.countArtists(filters)
  }

  /** Count music albums matching filters */
  countMusicAlbums(filters?: MusicFilters): number {
    return this.musicRepo.countAlbums(filters)
  }

  /** Count music tracks matching filters */
  countMusicTracks(filters?: MusicFilters): number {
    return this.musicRepo.countTracks(filters)
  }

  /** Get a music track by ID */
  getMusicTrackById(id: number): MusicTrack | null {
    return this.musicRepo.getTrackById(id)
  }

  /** Get a music track by file path */
  getMusicTrackByPath(filePath: string): MusicTrack | null {
    return this.musicRepo.getTrackByPath(filePath)
  }

  /** Delete a music track by ID */
  async deleteMusicTrack(id: number): Promise<void> {
    return this.musicRepo.deleteTrack(id)
  }

  /** Get music library stats */
  getMusicStats(sourceId?: string): {
    totalArtists: number
    totalAlbums: number
    totalTracks: number
    losslessAlbums: number
    hiResAlbums: number
    avgBitrate: number
  } {
    return this.musicRepo.getStats(sourceId)
  }

  /** Insert or update music quality score for an album */
  async upsertMusicQualityScore(score: MusicQualityScore): Promise<void> {
    return this.musicRepo.upsertQualityScore(score)
  }

  /** Get music quality score for an album */
  getMusicQualityScore(albumId: number): MusicQualityScore | null {
    return this.musicRepo.getQualityScore(albumId)
  }

  /** Get albums that need quality upgrades */
  getAlbumsNeedingUpgrade(limit?: number, sourceId?: string) {
    return this.musicRepo.getAlbumsNeedingUpgrade(limit, sourceId)
  }

  /** Insert or update artist completeness data */
  async upsertArtistCompleteness(data: ArtistCompleteness): Promise<void> {
    return this.musicRepo.upsertArtistCompleteness(data)
  }

  /** Get artist completeness by name */
  getArtistCompleteness(artistName: string): ArtistCompleteness | null {
    return this.musicRepo.getArtistCompleteness(artistName)
  }

  /** Get all artist completeness records */
  getAllArtistCompleteness(sourceId?: string): ArtistCompleteness[] {
    return this.musicRepo.getAllArtistCompleteness(sourceId)
  }

  /** Upsert album completeness data */
  async upsertAlbumCompleteness(data: AlbumCompleteness): Promise<void> {
    return this.musicRepo.upsertAlbumCompleteness(data)
  }

  /** Get album completeness by album ID */
  getAlbumCompleteness(albumId: number): AlbumCompleteness | null {
    return this.musicRepo.getAlbumCompleteness(albumId)
  }

  /** Get all album completeness records */
  getAllAlbumCompleteness(): AlbumCompleteness[] {
    return this.musicRepo.getAllAlbumCompleteness()
  }

  /** Get album completeness records for a specific artist */
  getAlbumCompletenessByArtist(artistName: string): AlbumCompleteness[] {
    return this.musicRepo.getAlbumCompletenessByArtist(artistName)
  }

  /** Get incomplete albums (albums with missing tracks) */
  getIncompleteAlbums(): AlbumCompleteness[] {
    return this.musicRepo.getIncompleteAlbums()
  }

  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  async addWishlistItem(item: Partial<WishlistItem>): Promise<number> {
    return this.wishlistRepo.addWishlistItem(item)
  }

  async updateWishlistItem(id: number, updates: Partial<WishlistItem>): Promise<void> {
    return this.wishlistRepo.updateWishlistItem(id, updates)
  }

  async removeWishlistItem(id: number): Promise<void> {
    return this.wishlistRepo.removeWishlistItem(id)
  }

  getWishlistItems(filters?: WishlistFilters): WishlistItem[] {
    return this.wishlistRepo.getWishlistItems(filters)
  }

  getWishlistItemById(id: number): WishlistItem | null {
    return this.wishlistRepo.getWishlistItemById(id)
  }

  getWishlistCount(): number {
    return this.wishlistRepo.getWishlistCount()
  }

  wishlistItemExists(tmdbId?: string, musicbrainzId?: string, mediaItemId?: number): boolean {
    return this.wishlistRepo.wishlistItemExists(tmdbId, musicbrainzId, mediaItemId)
  }

  getWishlistCountsByReason(): { missing: number; upgrade: number; active: number; completed: number; total: number } {
    return this.wishlistRepo.getWishlistCountsByReason()
  }

  async addWishlistItemsBulk(items: Partial<WishlistItem>[]): Promise<number> {
    return this.wishlistRepo.addWishlistItemsBulk(items)
  }

  async executeRaw(sql: string, params: (string | number | null)[] = []): Promise<unknown[][]> {
    if (!this.db) throw new Error('Database not initialized')

    const result = this.db.exec(sql, params)
    await this.save()

    return result.length ? result[0].values : []
  }

  // =====================================================================
  // NOTIFICATION METHODS
  // =====================================================================

  async createNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): Promise<number> {
    return this.notificationRepo.createNotification(notification)
  }

  async createNotifications(notifications: Array<Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>>): Promise<number[]> {
    return this.notificationRepo.createNotifications(notifications)
  }

  getNotifications(options: GetNotificationsOptions = {}): Notification[] {
    return this.notificationRepo.getNotifications(options)
  }

  getUnreadNotifications(): Notification[] {
    return this.notificationRepo.getUnreadNotifications()
  }

  getNotificationCount(): NotificationCountResult {
    return this.notificationRepo.getNotificationCount()
  }

  async markNotificationsRead(ids: number[]): Promise<void> {
    return this.notificationRepo.markNotificationsRead(ids)
  }

  async markAllNotificationsRead(): Promise<void> {
    return this.notificationRepo.markAllNotificationsRead()
  }

  async deleteNotifications(ids: number[]): Promise<void> {
    return this.notificationRepo.deleteNotifications(ids)
  }

  async clearAllNotifications(): Promise<void> {
    return this.notificationRepo.clearAllNotifications()
  }

  async pruneNotifications(maxCount: number): Promise<number> {
    return this.notificationRepo.pruneNotifications(maxCount)
  }

  globalSearch(query: string, maxResults = 5): {
    movies: Array<{ id: number; title: string; year?: number; poster_url?: string }>
    tvShows: Array<{ id: number; title: string; poster_url?: string }>
    episodes: Array<{ id: number; title: string; series_title: string; season_number: number; episode_number: number; poster_url?: string }>
    artists: Array<{ id: number; name: string; thumb_url?: string }>
    albums: Array<{ id: number; title: string; artist_name: string; year?: number; thumb_url?: string }>
    tracks: Array<{ id: number; title: string; album_id?: number; album_title?: string; artist_name?: string; album_thumb_url?: string }>
  } {
    return this.mediaRepo.globalSearch(query, maxResults)
  }

  // ============================================================================
  // EXCLUSIONS
  // ============================================================================

  /** Add an exclusion to hide an item from dashboard recommendations */
  addExclusion(exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string, title?: string): number {
    if (!this.db) throw new Error('Database not initialized')

    this.db.run(
      `INSERT INTO exclusions (exclusion_type, reference_id, reference_key, parent_key, title) VALUES (?, ?, ?, ?, ?)`,
      [exclusionType, referenceId ?? null, referenceKey ?? null, parentKey ?? null, title ?? null]
    )
    this.save()

    const result = this.db.exec('SELECT last_insert_rowid()')
    return result[0]?.values[0]?.[0] as number || 0
  }

  /** Remove an exclusion by ID */
  removeExclusion(id: number): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run('DELETE FROM exclusions WHERE id = ?', [id])
    this.save()
  }

  /** Get exclusions, optionally filtered by type and/or parent key */
  getExclusions(exclusionType?: string, parentKey?: string): Array<{
    id: number
    exclusion_type: string
    reference_id: number | null
    reference_key: string | null
    parent_key: string | null
    title: string | null
    created_at: string
  }> {
    if (!this.db) throw new Error('Database not initialized')

    let sql = 'SELECT * FROM exclusions WHERE 1=1'
    const params: (string | number)[] = []

    if (exclusionType) {
      sql += ' AND exclusion_type = ?'
      params.push(exclusionType)
    }
    if (parentKey) {
      sql += ' AND parent_key = ?'
      params.push(parentKey)
    }

    sql += ' ORDER BY created_at DESC'
    const result = this.db.exec(sql, params)
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  /** Check if a specific item is excluded */
  isExcluded(exclusionType: string, referenceId?: number, referenceKey?: string, parentKey?: string): boolean {
    if (!this.db) throw new Error('Database not initialized')

    if (referenceId) {
      const result = this.db.exec(
        'SELECT 1 FROM exclusions WHERE exclusion_type = ? AND reference_id = ? LIMIT 1',
        [exclusionType, referenceId]
      )
      return result.length > 0 && result[0].values.length > 0
    }

    if (referenceKey) {
      let sql = 'SELECT 1 FROM exclusions WHERE exclusion_type = ? AND reference_key = ?'
      const params: (string | number)[] = [exclusionType, referenceKey]
      if (parentKey) {
        sql += ' AND parent_key = ?'
        params.push(parentKey)
      }
      sql += ' LIMIT 1'
      const result = this.db.exec(sql, params)
      return result.length > 0 && result[0].values.length > 0
    }

    return false
  }

  // ============================================================================
  // TASK QUEUE HISTORY
  // ============================================================================

  saveTaskHistory(task: {
    taskId: string
    type: string
    label: string
    sourceId?: string
    libraryId?: string
    status: string
    error?: string
    result?: Record<string, unknown>
    createdAt: string
    startedAt?: string
    completedAt?: string
  }): void {
    if (!this.db) throw new Error('Database not initialized')

    const durationMs = task.startedAt && task.completedAt
      ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
      : null

    this.db.run(
      `INSERT INTO task_history (task_id, type, label, source_id, library_id, status, error, result, created_at, started_at, completed_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [task.taskId, task.type, task.label,
       task.sourceId || null, task.libraryId || null,
       task.status, task.error || null,
       task.result ? JSON.stringify(task.result) : null,
       task.createdAt, task.startedAt || null,
       task.completedAt || null, durationMs]
    )

    this.db.run(`
      DELETE FROM task_history WHERE id NOT IN (
        SELECT id FROM task_history ORDER BY recorded_at DESC LIMIT 200
      )
    `)
    this.save()
  }

  getTaskHistory(limit = 50, offset = 0): Array<{
    taskId: string; type: string; label: string; sourceId: string | null
    libraryId: string | null; status: string; error: string | null
    result: string | null; createdAt: string; startedAt: string | null
    completedAt: string | null; durationMs: number | null
  }> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.exec(
      'SELECT task_id, type, label, source_id, library_id, status, error, result, created_at, started_at, completed_at, duration_ms FROM task_history ORDER BY recorded_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    )
    if (!result.length) return []
    return result[0].values.map((r: unknown[]) => ({
      taskId: r[0] as string, type: r[1] as string, label: r[2] as string,
      sourceId: r[3] as string | null, libraryId: r[4] as string | null,
      status: r[5] as string, error: r[6] as string | null, result: r[7] as string | null,
      createdAt: r[8] as string, startedAt: r[9] as string | null,
      completedAt: r[10] as string | null, durationMs: r[11] as number | null,
    }))
  }

  saveActivityLogEntry(entry: {
    entryType: string
    message: string
    taskId?: string
    taskType?: string
  }): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run(
      'INSERT INTO activity_log (entry_type, message, task_id, task_type) VALUES (?, ?, ?, ?)',
      [entry.entryType, entry.message, entry.taskId || null, entry.taskType || null]
    )
    this.db.run(`
      DELETE FROM activity_log WHERE id NOT IN (
        SELECT id FROM activity_log ORDER BY created_at DESC LIMIT 500
      )
    `)
    this.save()
  }

  getActivityLog(entryType?: string, limit = 100, offset = 0): Array<{
    id: number; entryType: string; message: string
    taskId: string | null; taskType: string | null; createdAt: string
  }> {
    if (!this.db) throw new Error('Database not initialized')
    let sql = 'SELECT id, entry_type, message, task_id, task_type, created_at FROM activity_log'
    const params: (string | number | null)[] = []
    if (entryType) {
      sql += ' WHERE entry_type LIKE ?'
      params.push(entryType + '%')
    }
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    const result = this.db.exec(sql, params)
    if (!result.length) return []
    return result[0].values.map((r: unknown[]) => ({
      id: r[0] as number, entryType: r[1] as string, message: r[2] as string,
      taskId: r[3] as string | null, taskType: r[4] as string | null,
      createdAt: r[5] as string,
    }))
  }

  clearTaskHistory(): void {
    if (!this.db) throw new Error('Database not initialized')
    this.db.run('DELETE FROM task_history')
    this.db.run("DELETE FROM activity_log WHERE entry_type LIKE 'task-%'")
    this.save()
  }

  clearActivityLog(entryType?: string): void {
    if (!this.db) throw new Error('Database not initialized')
    if (entryType) {
      this.db.run('DELETE FROM activity_log WHERE entry_type LIKE ?', [entryType + '%'])
    } else {
      this.db.run('DELETE FROM activity_log')
    }
    this.save()
  }
}

// Export singleton instance
let dbInstance: DatabaseService | null = null

export function getDatabaseService(): DatabaseService {
  if (!dbInstance) {
    dbInstance = new DatabaseService()
  }
  return dbInstance
}
