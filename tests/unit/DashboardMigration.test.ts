
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import { StatsRepository } from '../../src/main/database/repositories/StatsRepository'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Migration & Dashboard Integration Test
 * 
 * Verifies that the dashboard summary query remains compatible with the database schema
 * even after incremental migrations from older versions.
 */
describe('Dashboard Migration Integration', () => {
  let db: DatabaseSync
  const dbPath = path.join(__dirname, 'test-dashboard-migration.db')

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    db = new DatabaseSync(dbPath)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('should run getDashboardSummary without errors on a fresh database', () => {
    runMigrations(db as any)
    const statsRepo = new StatsRepository(db)
    
    // Should not throw "no such column"
    expect(() => statsRepo.getDashboardSummary()).not.toThrow()
    
    const summary = statsRepo.getDashboardSummary()
    expect(summary).toBeDefined()
    expect(summary.movieUpgrades).toBeInstanceOf(Array)
  })

  it('should correctly migrate an old schema and maintain dashboard compatibility', () => {
    // 1. Create a simulated "Legacy" database missing modern columns
    db.exec(`
      CREATE TABLE media_items (id INTEGER PRIMARY KEY, plex_id TEXT UNIQUE, title TEXT, type TEXT, source_id TEXT, library_id TEXT);
      CREATE TABLE quality_scores (id INTEGER PRIMARY KEY, media_item_id INTEGER UNIQUE, tier_score INTEGER, needs_upgrade INTEGER, overall_score INTEGER, resolution_score INTEGER, bitrate_score INTEGER, audio_score INTEGER);
      CREATE TABLE music_albums (id INTEGER PRIMARY KEY, source_id TEXT, title TEXT, library_id TEXT);
      CREATE TABLE music_quality_scores (id INTEGER PRIMARY KEY, album_id INTEGER UNIQUE, tier_score INTEGER, needs_upgrade INTEGER, codec_score INTEGER, bitrate_score INTEGER);
      CREATE TABLE media_sources (source_id TEXT PRIMARY KEY, is_enabled INTEGER, display_name TEXT, connection_config TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE movie_collections (id INTEGER PRIMARY KEY, completeness_percentage REAL, missing_movies TEXT, owned_movies INTEGER, tmdb_collection_id TEXT, collection_name TEXT, source_id TEXT, library_id TEXT);
      CREATE TABLE series_completeness (id INTEGER PRIMARY KEY, completeness_percentage REAL, series_title TEXT, total_seasons INTEGER, total_episodes INTEGER, owned_seasons INTEGER, owned_episodes INTEGER, source_id TEXT, library_id TEXT);
      CREATE TABLE artist_completeness (id INTEGER PRIMARY KEY, completeness_percentage REAL, artist_name TEXT, total_albums INTEGER, owned_albums INTEGER, total_singles INTEGER, owned_singles INTEGER, total_eps INTEGER, owned_eps INTEGER, missing_albums TEXT, missing_singles TEXT, missing_eps TEXT, library_id TEXT);
      CREATE TABLE music_artists (id INTEGER PRIMARY KEY, name TEXT, source_id TEXT, library_id TEXT);
      CREATE TABLE exclusions (id INTEGER PRIMARY KEY, exclusion_type TEXT, reference_id INTEGER, reference_key TEXT, parent_key TEXT);
    `)

    // 2. Run migrations
    // Note: We expect some "table already exists" debug logs, but the ALTER statements must succeed
    runMigrations(db as any)

    // 3. Verify critical columns were added to the legacy tables
    const musicQualityInfo = db.prepare("PRAGMA table_info(music_quality_scores)").all() as any[]
    expect(musicQualityInfo.some(c => c.name === 'efficiency_score')).toBe(true)
    expect(musicQualityInfo.some(c => c.name === 'storage_debt_bytes')).toBe(true)

    const videoQualityInfo = db.prepare("PRAGMA table_info(quality_scores)").all() as any[]
    expect(videoQualityInfo.some(c => c.name === 'efficiency_score')).toBe(true)
    expect(videoQualityInfo.some(c => c.name === 'storage_debt_bytes')).toBe(true)

    // 4. Verify dashboard summary query now works on the migrated legacy database
    const statsRepo = new StatsRepository(db)
    expect(() => statsRepo.getDashboardSummary()).not.toThrow()
    
    const summary = statsRepo.getDashboardSummary()
    expect(summary).toBeDefined()
  })
})
