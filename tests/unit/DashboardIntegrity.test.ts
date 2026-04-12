
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import { StatsRepository } from '../../src/main/database/repositories/StatsRepository'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Dashboard Integrity & Migration Integration Tests
 * 
 * This suite verifies the entire dashboard data lifecycle without mocks.
 * It covers:
 * 1. Fresh installations.
 * 2. Upgrades from 0.4.0 (ensuring the 'efficiency_score' crash is fixed).
 * 3. Data isolation (enabled/disabled sources).
 * 4. Exclusion logic.
 */
describe('Dashboard Integrity (No Mocks)', () => {
  let db: DatabaseSync
  const dbPath = path.join(__dirname, 'dashboard-integrity.db')

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    db = new DatabaseSync(dbPath)
  })

  afterEach(() => {
    db.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  // Helper to insert a minimal valid media item
  const insertMediaItem = (id: number, title: string, sourceId: string, type: 'movie' | 'episode' = 'movie') => {
    db.prepare(`
      INSERT INTO media_items (
        id, title, type, source_id, plex_id, file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate, source_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, type, sourceId, 'p' + id, '/path/' + id, 1000, 3600, '1080p', 1920, 1080, 'h264', 5000, 'aac', 2, 192, 'local')
  }

  describe('Migration Path Integrity', () => {
    it('should be stable on a fresh install', () => {
      runMigrations(db as any)
      const statsRepo = new StatsRepository(db)
      
      const summary = statsRepo.getDashboardSummary()
      expect(summary).toBeDefined()
      expect(summary.movieUpgrades).toEqual([])
    })

    it('should heal a 0.4.0 schema and prevent efficiency_score crashes', () => {
      // 1. Create a 0.4.0 schema missing Phase 5 columns
      db.exec(`
        CREATE TABLE media_sources (source_id TEXT PRIMARY KEY, is_enabled INTEGER, display_name TEXT, source_type TEXT, connection_config TEXT);
        CREATE TABLE media_items (
          id INTEGER PRIMARY KEY, plex_id TEXT UNIQUE, title TEXT, type TEXT, source_id TEXT, library_id TEXT, 
          file_path TEXT NOT NULL, file_size INTEGER NOT NULL, duration INTEGER NOT NULL,
          resolution TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
          video_codec TEXT NOT NULL, video_bitrate INTEGER NOT NULL,
          audio_codec TEXT NOT NULL, audio_channels INTEGER NOT NULL, audio_bitrate INTEGER NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'local'
        );
        CREATE TABLE quality_scores (id INTEGER PRIMARY KEY, media_item_id INTEGER UNIQUE, needs_upgrade INTEGER, overall_score INTEGER, resolution_score INTEGER, bitrate_score INTEGER, audio_score INTEGER);
        CREATE TABLE music_albums (id INTEGER PRIMARY KEY, source_id TEXT, title TEXT, artist_name TEXT, library_id TEXT);
        CREATE TABLE music_quality_scores (id INTEGER PRIMARY KEY, album_id INTEGER UNIQUE, needs_upgrade INTEGER, tier_score INTEGER, codec_score INTEGER, bitrate_score INTEGER);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE movie_collections (id INTEGER PRIMARY KEY, tmdb_collection_id TEXT, collection_name TEXT, total_movies INTEGER NOT NULL DEFAULT 0, owned_movies INTEGER NOT NULL DEFAULT 0, missing_movies TEXT, completeness_percentage REAL, source_id TEXT, library_id TEXT);
        CREATE TABLE series_completeness (id INTEGER PRIMARY KEY, series_title TEXT, completeness_percentage REAL, missing_episodes TEXT, source_id TEXT, library_id TEXT);
        CREATE TABLE artist_completeness (id INTEGER PRIMARY KEY, artist_name TEXT, completeness_percentage REAL, missing_albums TEXT, missing_eps TEXT, missing_singles TEXT, library_id TEXT);
        CREATE TABLE music_artists (id INTEGER PRIMARY KEY, name TEXT, source_id TEXT, library_id TEXT);
        CREATE TABLE exclusions (id INTEGER PRIMARY KEY, exclusion_type TEXT, reference_id INTEGER, reference_key TEXT, parent_key TEXT);
        CREATE TABLE media_item_versions (id INTEGER PRIMARY KEY, media_item_id INTEGER);
        CREATE TABLE library_scans (source_id TEXT, library_id TEXT, is_enabled INTEGER);
      `)

      // 2. Insert sample 0.4.0 data
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type, connection_config) VALUES (?, ?, ?, ?, ?)").run('src1', 1, 'Source 1', 'local', '{}')
      insertMediaItem(1, 'Old Movie', 'src1')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?)").run(1, 1, 50, 50, 50, 50)

      // 3. Run migrations - this MUST add efficiency_score to both quality tables
      runMigrations(db as any)

      // 4. Verify columns exist via PRAGMA
      const qInfo = db.prepare("PRAGMA table_info(quality_scores)").all() as any[]
      expect(qInfo.some(c => c.name === 'efficiency_score')).toBe(true)
      
      const mqInfo = db.prepare("PRAGMA table_info(music_quality_scores)").all() as any[]
      expect(mqInfo.some(c => c.name === 'efficiency_score')).toBe(true)

      // 5. Verify the dashboard query succeeds on the migrated DB
      const statsRepo = new StatsRepository(db)
      let summary
      expect(() => { summary = statsRepo.getDashboardSummary() }).not.toThrow()
      expect(summary.movieUpgrades.length).toBe(1)
      expect(summary.movieUpgrades[0].title).toBe('Old Movie')
    })
  })

  describe('Data Filtering Logic', () => {
    beforeEach(() => {
      runMigrations(db as any)
    })

    it('should exclude data from disabled sources', () => {
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type) VALUES (?, ?, ?, ?)").run('src_on', 1, 'Enabled', 'local')
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type) VALUES (?, ?, ?, ?)").run('src_off', 0, 'Disabled', 'local')

      insertMediaItem(10, 'Good Item', 'src_on')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?)").run(10, 1, 50, 50, 50, 50)

      insertMediaItem(11, 'Hidden Item', 'src_off')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?)").run(11, 1, 50, 50, 50, 50)

      const statsRepo = new StatsRepository(db)
      const summary = statsRepo.getDashboardSummary()

      expect(summary.movieUpgrades.length).toBe(1)
      expect(summary.movieUpgrades[0].title).toBe('Good Item')
    })

    it('should respect media exclusions', () => {
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type) VALUES (?, ?, ?, ?)").run('s1', 1, 'S1', 'local')
      
      insertMediaItem(20, 'To Upgrade', 's1')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?)").run(20, 1, 50, 50, 50, 50)

      db.prepare("INSERT INTO exclusions (exclusion_type, reference_id) VALUES (?, ?)").run('media_upgrade', 20)

      const statsRepo = new StatsRepository(db)
      const summary = statsRepo.getDashboardSummary()

      expect(summary.movieUpgrades).toEqual([])
    })

    it('should filter incomplete collections based on JSON exclusions', () => {
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type) VALUES (?, ?, ?, ?)").run('s1', 1, 'S1', 'local')
      
      const missing = JSON.stringify([
        { tmdb_id: 101, title: 'Movie 1' },
        { tmdb_id: 102, title: 'Movie 2' }
      ])
      db.prepare(`
        INSERT INTO movie_collections (tmdb_collection_id, collection_name, total_movies, owned_movies, missing_movies, completeness_percentage, source_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('coll1', 'The Collection', 3, 1, missing, 33.3, 's1')

      db.prepare("INSERT INTO exclusions (exclusion_type, reference_key, parent_key) VALUES (?, ?, ?)").run('collection_movie', '102', 'coll1')

      const statsRepo = new StatsRepository(db)
      const summary = statsRepo.getDashboardSummary()

      expect(summary.incompleteCollections.length).toBe(1)
      const processed = JSON.parse(summary.incompleteCollections[0].missing_movies)
      expect(processed.length).toBe(1)
      expect(processed[0].tmdb_id).toBe(101)
      expect(summary.incompleteCollections[0].completeness_percentage).toBe(50)
    })
  })

  describe('Sorting & Configuration', () => {
    beforeEach(() => {
      runMigrations(db as any)
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type) VALUES (?, ?, ?, ?)").run('s1', 1, 'S1', 'local')
    })

    it('should sort upgrades by efficiency when configured', () => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('dashboard_upgrade_sort', 'efficiency')

      insertMediaItem(31, 'Low Eff', 's1')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, tier_score, efficiency_score, storage_debt_bytes, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(31, 1, 90, 20, 1000, 90, 90, 90, 90)

      insertMediaItem(32, 'High Eff', 's1')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, tier_score, efficiency_score, storage_debt_bytes, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(32, 1, 40, 80, 100, 40, 40, 40, 40)

      const statsRepo = new StatsRepository(db)
      const summary = statsRepo.getDashboardSummary()

      expect(summary.movieUpgrades[0].title).toBe('Low Eff')
    })

    it('should sort upgrades by title when configured', () => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('dashboard_upgrade_sort', 'title')
      
      insertMediaItem(41, 'Z-Movie', 's1')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, tier_score, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?, ?)").run(41, 1, 50, 50, 50, 50, 50)
      
      insertMediaItem(42, 'A-Movie', 's1')
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, tier_score, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?, ?)").run(42, 1, 50, 50, 50, 50, 50)

      const statsRepo = new StatsRepository(db)
      const summary = statsRepo.getDashboardSummary()
      expect(summary.movieUpgrades[0].title).toBe('A-Movie')
    })

    it('should sort upgrades by recent when configured', () => {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('dashboard_upgrade_sort', 'recent')
      
      insertMediaItem(51, 'Old', 's1')
      db.prepare("UPDATE media_items SET created_at = '2020-01-01' WHERE id = 51").run()
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, tier_score, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?, ?)").run(51, 1, 50, 50, 50, 50, 50)
      
      insertMediaItem(52, 'New', 's1')
      db.prepare("UPDATE media_items SET created_at = '2026-01-01' WHERE id = 52").run()
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, tier_score, overall_score, resolution_score, bitrate_score, audio_score) VALUES (?, ?, ?, ?, ?, ?, ?)").run(52, 1, 50, 50, 50, 50, 50)

      const statsRepo = new StatsRepository(db)
      const summary = statsRepo.getDashboardSummary()
      expect(summary.movieUpgrades[0].title).toBe('New')
    })
  })

  describe('Repository Stats Methods', () => {
    beforeEach(() => {
      runMigrations(db as any)
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type) VALUES (?, ?, ?, ?)").run('s1', 1, 'S1', 'local')
    })

    it('should calculate library stats correctly including TV shows', () => {
      insertMediaItem(100, 'Movie 1', 's1', 'movie')
      // Distinct TV Show episodes
      db.prepare(`
        INSERT INTO media_items (id, title, series_title, type, source_id, plex_id, file_path, file_size, duration, resolution, width, height, video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate, source_type)
        VALUES (101, 'E1', 'Show A', 'episode', 's1', 'p101', 'f1', 1, 1, '1', 1, 1, '1', 1, '1', 1, 1, 'local'),
               (102, 'E2', 'Show A', 'episode', 's1', 'p102', 'f2', 1, 1, '1', 1, 1, '1', 1, '1', 1, 1, 'local'),
               (103, 'E1', 'Show B', 'episode', 's1', 'p103', 'f3', 1, 1, '1', 1, 1, '1', 1, '1', 1, 1, 'local')
      `).run()
      
      db.prepare("INSERT INTO quality_scores (media_item_id, needs_upgrade, overall_score, resolution_score, bitrate_score, audio_score, is_low_quality) VALUES (?, ?, ?, ?, ?, ?, ?)").run(100, 1, 40, 40, 40, 40, 1)

      const statsRepo = new StatsRepository(db)
      const stats = statsRepo.getLibraryStats()

      expect(stats.totalItems).toBe(4)
      expect(stats.totalMovies).toBe(1)
      expect(stats.totalEpisodes).toBe(3)
      expect(stats.totalShows).toBe(2)
      expect(stats.needsUpgradeCount).toBe(1)
    })

    it('should aggregate source stats correctly', () => {
      db.prepare("INSERT INTO media_sources (source_id, is_enabled, display_name, source_type) VALUES (?, ?, ?, ?)").run('s2', 0, 'S2', 'local')
      
      insertMediaItem(200, 'M1', 's1')
      insertMediaItem(201, 'M2', 's1')

      const statsRepo = new StatsRepository(db)
      const agg = statsRepo.getAggregatedSourceStats()

      expect(agg.totalSources).toBe(2)
      expect(agg.enabledSources).toBe(1)
      expect(agg.totalItems).toBe(2)
      expect(agg.bySource.find(s => s.sourceId === 's1')?.itemCount).toBe(2)
    })

    it('should handle getMediaItemsCountBySource', () => {
      insertMediaItem(300, 'M1', 's1')
      const statsRepo = new StatsRepository(db)
      expect(statsRepo.getMediaItemsCountBySource('s1')).toBe(1)
      expect(statsRepo.getMediaItemsCountBySource('non-existent')).toBe(0)
    })
  })
})
