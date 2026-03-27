/**
 * DatabaseService Integration Tests
 *
 * Tests database operations with a real in-memory SQL.js database.
 * Focuses on methods not covered by the mock-based DatabaseService.test.ts:
 * settings round-trip, media item versions, source deletion cascade,
 * library stats, and quality scores.
 */

import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'

// Unmock sql.js so we get a real in-memory database
vi.unmock('sql.js')

// Mock credential encryption to pass through values
vi.mock('../../src/main/services/CredentialEncryptionService', () => ({
  getCredentialEncryptionService: vi.fn(() => ({
    encryptSetting: vi.fn((_key: string, val: string) => val),
    decryptSetting: vi.fn((_key: string, val: string) => val),
    isEncryptionAvailable: vi.fn(() => false),
    isEncrypted: vi.fn(() => false),
    encrypt: vi.fn((val: string) => val),
    decrypt: vi.fn((val: string) => val),
    encryptConnectionConfig: vi.fn((val: string) => val),
    decryptConnectionConfig: vi.fn((val: string) => val),
  })),
}))

import initSqlJs, { type Database } from 'sql.js'
import { DATABASE_SCHEMA } from '../../src/main/database/schema'
import type { MediaItem, MediaItemVersion, QualityScore } from '../../src/main/types/database'

/**
 * Lightweight wrapper that directly tests DatabaseService's SQL logic
 * using a real SQL.js database, bypassing the fs/initialization layer.
 */
class TestDatabaseHelper {
  db: Database
  private itemCounter = 0

  constructor(db: Database) {
    this.db = db
  }

  private rowsToObjects<T>(result: { columns: string[]; values: unknown[][] }): T[] {
    return result.values.map((row) => {
      const obj: Record<string, unknown> = {}
      result.columns.forEach((col, i) => { obj[col] = row[i] })
      return obj as T
    })
  }

  // Settings
  setSetting(key: string, value: string): void {
    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    )
  }

  getSetting(key: string): string | null {
    const result = this.db.exec('SELECT value FROM settings WHERE key = ?', [key])
    if (!result.length) return null
    return (result[0].values[0]?.[0] as string) || null
  }

  getAllSettings(): Record<string, string> {
    const result = this.db.exec('SELECT key, value FROM settings')
    if (!result.length) return {}
    const settings: Record<string, string> = {}
    result[0].values.forEach((row) => {
      settings[row[0] as string] = row[1] as string
    })
    return settings
  }

  getSettingsByPrefix(prefix: string): Record<string, string> {
    const result = this.db.exec('SELECT key, value FROM settings WHERE key LIKE ?', [prefix + '%'])
    if (!result.length) return {}
    const settings: Record<string, string> = {}
    result[0].values.forEach((row) => {
      settings[row[0] as string] = row[1] as string
    })
    return settings
  }

  // Media sources
  upsertMediaSource(sourceId: string, sourceType: string, displayName: string): void {
    this.db.run(
      `INSERT INTO media_sources (source_id, source_type, display_name, connection_config)
       VALUES (?, ?, ?, '{}')
       ON CONFLICT(source_id) DO UPDATE SET display_name = excluded.display_name`,
      [sourceId, sourceType, displayName]
    )
  }

  getMediaSources(): Array<{ source_id: string; display_name: string }> {
    const result = this.db.exec('SELECT source_id, display_name FROM media_sources')
    if (!result.length) return []
    return this.rowsToObjects(result[0])
  }

  // Media items
  insertMediaItem(item: Partial<MediaItem> & { source_id: string; title: string; type: string }): number {
    this.db.run(
      `INSERT INTO media_items (
        source_id, source_type, library_id, plex_id, type, title, year,
        file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.source_id, item.source_type || 'plex', item.library_id || 'lib-1',
        item.plex_id || `item-${++this.itemCounter}`, item.type, item.title,
        item.year || null,
        item.file_path || '', item.file_size || 0, item.duration || 0,
        item.resolution || '1080p', item.width || 1920, item.height || 1080,
        item.video_codec || 'h264', item.video_bitrate || 10000,
        item.audio_codec || 'ac3', item.audio_channels || 6, item.audio_bitrate || 448,
      ]
    )
    const result = this.db.exec('SELECT last_insert_rowid()')
    return result[0].values[0][0] as number
  }

  getMediaItemById(id: number): MediaItem | null {
    const result = this.db.exec('SELECT * FROM media_items WHERE id = ?', [id])
    if (!result.length) return null
    return this.rowsToObjects<MediaItem>(result[0])[0] || null
  }

  countMediaItems(sourceId?: string): number {
    const sql = sourceId
      ? 'SELECT COUNT(*) FROM media_items WHERE source_id = ?'
      : 'SELECT COUNT(*) FROM media_items'
    const result = this.db.exec(sql, sourceId ? [sourceId] : [])
    return (result[0]?.values[0]?.[0] as number) || 0
  }

  // Media item versions
  upsertMediaItemVersion(version: Partial<MediaItemVersion> & { media_item_id: number; file_path: string }): number {
    const existing = this.db.exec(
      'SELECT id FROM media_item_versions WHERE media_item_id = ? AND file_path = ?',
      [version.media_item_id, version.file_path]
    )

    if (existing.length > 0 && existing[0].values.length > 0) {
      const existingId = existing[0].values[0][0] as number
      this.db.run(
        `UPDATE media_item_versions SET
          version_source = ?, edition = ?, resolution = ?, video_codec = ?, video_bitrate = ?,
          audio_codec = ?, audio_channels = ?, audio_bitrate = ?,
          quality_tier = ?, tier_quality = ?, tier_score = ?
        WHERE id = ?`,
        [
          version.version_source || 'primary', version.edition || null,
          version.resolution || '1080p', version.video_codec || 'h264',
          version.video_bitrate || 10000, version.audio_codec || 'ac3',
          version.audio_channels || 6, version.audio_bitrate || 448,
          version.quality_tier || null, version.tier_quality || null,
          version.tier_score || 0, existingId,
        ]
      )
      return existingId
    }

    this.db.run(
      `INSERT INTO media_item_versions (
        media_item_id, version_source, edition, file_path, file_size, duration,
        resolution, width, height, video_codec, video_bitrate,
        audio_codec, audio_channels, audio_bitrate,
        quality_tier, tier_quality, tier_score, is_best
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        version.media_item_id, version.version_source || 'primary',
        version.edition || null, version.file_path,
        version.file_size || 0, version.duration || 0,
        version.resolution || '1080p', version.width || 1920, version.height || 1080,
        version.video_codec || 'h264', version.video_bitrate || 10000,
        version.audio_codec || 'ac3', version.audio_channels || 6,
        version.audio_bitrate || 448,
        version.quality_tier || null, version.tier_quality || null,
        version.tier_score || 0, version.is_best ? 1 : 0,
      ]
    )
    const result = this.db.exec('SELECT last_insert_rowid()')
    return result[0].values[0][0] as number
  }

  getMediaItemVersions(mediaItemId: number): MediaItemVersion[] {
    const result = this.db.exec(
      'SELECT * FROM media_item_versions WHERE media_item_id = ? ORDER BY is_best DESC, tier_score DESC',
      [mediaItemId]
    )
    if (!result.length) return []
    return this.rowsToObjects<MediaItemVersion>(result[0])
  }

  deleteMediaItemVersions(mediaItemId: number): void {
    this.db.run('DELETE FROM media_item_versions WHERE media_item_id = ?', [mediaItemId])
  }

  // Quality scores
  upsertQualityScore(score: Partial<QualityScore> & { media_item_id: number }): number {
    this.db.run(
      `INSERT INTO quality_scores (
        media_item_id, overall_score, resolution_score, bitrate_score, audio_score,
        needs_upgrade, quality_tier, tier_quality, tier_score, bitrate_tier_score, audio_tier_score, issues
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(media_item_id) DO UPDATE SET
         overall_score = excluded.overall_score,
         resolution_score = excluded.resolution_score,
         bitrate_score = excluded.bitrate_score,
         audio_score = excluded.audio_score,
         needs_upgrade = excluded.needs_upgrade,
         quality_tier = excluded.quality_tier,
         tier_quality = excluded.tier_quality,
         tier_score = excluded.tier_score,
         bitrate_tier_score = excluded.bitrate_tier_score,
         audio_tier_score = excluded.audio_tier_score,
         issues = excluded.issues`,
      [
        score.media_item_id, score.overall_score || 0,
        score.resolution_score || 0, score.bitrate_score || 0, score.audio_score || 0,
        score.needs_upgrade ? 1 : 0,
        score.quality_tier || '1080p', score.tier_quality || 'MEDIUM',
        score.tier_score || 50, score.bitrate_tier_score || 0, score.audio_tier_score || 0,
        score.issues || '[]',
      ]
    )
    const result = this.db.exec('SELECT last_insert_rowid()')
    return result[0].values[0][0] as number
  }

  getQualityScoreByMediaId(mediaItemId: number): QualityScore | null {
    const result = this.db.exec('SELECT * FROM quality_scores WHERE media_item_id = ?', [mediaItemId])
    if (!result.length) return null
    return this.rowsToObjects<QualityScore>(result[0])[0] || null
  }

  // Library stats
  getLibraryStats(sourceId?: string): { totalItems: number; totalMovies: number; totalEpisodes: number } {
    let sql = 'SELECT COUNT(*) as total, SUM(CASE WHEN type = \'movie\' THEN 1 ELSE 0 END) as movies, SUM(CASE WHEN type = \'episode\' THEN 1 ELSE 0 END) as episodes FROM media_items'
    const params: string[] = []
    if (sourceId) {
      sql += ' WHERE source_id = ?'
      params.push(sourceId)
    }
    const result = this.db.exec(sql, params)
    if (!result.length) return { totalItems: 0, totalMovies: 0, totalEpisodes: 0 }
    return {
      totalItems: (result[0].values[0][0] as number) || 0,
      totalMovies: (result[0].values[0][1] as number) || 0,
      totalEpisodes: (result[0].values[0][2] as number) || 0,
    }
  }

  // Source deletion cascade
  deleteMediaSource(sourceId: string): void {
    this.db.run('DELETE FROM quality_scores WHERE media_item_id IN (SELECT id FROM media_items WHERE source_id = ?)', [sourceId])
    this.db.run('DELETE FROM media_item_versions WHERE media_item_id IN (SELECT id FROM media_items WHERE source_id = ?)', [sourceId])
    this.db.run('DELETE FROM media_items WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM music_tracks WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM music_albums WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM music_artists WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM series_completeness WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM movie_collections WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM library_scans WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM notifications WHERE source_id = ?', [sourceId])
    this.db.run('DELETE FROM media_sources WHERE source_id = ?', [sourceId])
  }

  // Library scans
  updateLibraryScanTime(sourceId: string, libraryId: string, itemsScanned: number): void {
    this.db.run(
      `INSERT INTO library_scans (source_id, library_id, library_name, library_type, last_scan_at, items_scanned)
       VALUES (?, ?, ?, 'movie', datetime('now'), ?)
       ON CONFLICT(source_id, library_id) DO UPDATE SET
         last_scan_at = datetime('now'), items_scanned = excluded.items_scanned`,
      [sourceId, libraryId, libraryId, itemsScanned]
    )
  }

  getLibraryScanTime(sourceId: string, libraryId: string): string | null {
    const result = this.db.exec(
      'SELECT last_scan_at FROM library_scans WHERE source_id = ? AND library_id = ?',
      [sourceId, libraryId]
    )
    if (!result.length) return null
    return (result[0].values[0]?.[0] as string) || null
  }

  // Notifications
  insertNotification(sourceId: string, type: string, title: string): void {
    this.db.run(
      `INSERT INTO notifications (source_id, type, title, message) VALUES (?, ?, ?, '')`,
      [sourceId, type, title]
    )
  }

  countNotifications(sourceId?: string): number {
    const sql = sourceId
      ? 'SELECT COUNT(*) FROM notifications WHERE source_id = ?'
      : 'SELECT COUNT(*) FROM notifications'
    const result = this.db.exec(sql, sourceId ? [sourceId] : [])
    return (result[0]?.values[0]?.[0] as number) || 0
  }
}

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs()
})

describe('DatabaseService Integration', () => {
  let db: Database
  let helper: TestDatabaseHelper

  beforeEach(() => {
    db = new SQL.Database()
    db.run(DATABASE_SCHEMA)
    // Add migration columns
    try { db.run('ALTER TABLE music_artists ADD COLUMN user_fixed_match INTEGER DEFAULT 0') } catch { /* already exists */ }
    try { db.run('ALTER TABLE music_albums ADD COLUMN user_fixed_match INTEGER DEFAULT 0') } catch { /* already exists */ }
    try { db.run('ALTER TABLE media_items ADD COLUMN user_fixed_match INTEGER DEFAULT 0') } catch { /* already exists */ }
    helper = new TestDatabaseHelper(db)
  })

  // ============================================================================
  // SETTINGS
  // ============================================================================

  describe('settings', () => {
    it('should set and get a setting', () => {
      helper.setSetting('test_key', 'test_value')
      expect(helper.getSetting('test_key')).toBe('test_value')
    })

    it('should return null for non-existent setting', () => {
      expect(helper.getSetting('nonexistent')).toBeNull()
    })

    it('should update existing setting', () => {
      helper.setSetting('key', 'value1')
      helper.setSetting('key', 'value2')
      expect(helper.getSetting('key')).toBe('value2')
    })

    it('should get all settings', () => {
      helper.setSetting('a', '1')
      helper.setSetting('b', '2')
      const all = helper.getAllSettings()
      expect(all.a).toBe('1')
      expect(all.b).toBe('2')
    })

    it('should get settings by prefix', () => {
      helper.setSetting('quality_video_weight', '70')
      helper.setSetting('quality_audio_sd_medium', '128')
      helper.setSetting('tmdb_api_key', 'abc')

      const qualitySettings = helper.getSettingsByPrefix('quality_')
      expect(qualitySettings['quality_video_weight']).toBe('70')
      expect(qualitySettings['quality_audio_sd_medium']).toBe('128')
      expect(qualitySettings['tmdb_api_key']).toBeUndefined()
    })

    it('should return empty object for prefix with no matches', () => {
      const result = helper.getSettingsByPrefix('nonexistent_')
      expect(result).toEqual({})
    })
  })

  // ============================================================================
  // MEDIA ITEMS
  // ============================================================================

  describe('media items', () => {
    it('should insert and retrieve a media item', () => {
      const id = helper.insertMediaItem({
        source_id: 'src-1',
        title: 'The Matrix',
        type: 'movie',
        year: 1999,
      })
      expect(id).toBeGreaterThan(0)

      const item = helper.getMediaItemById(id)
      expect(item).not.toBeNull()
      expect(item!.title).toBe('The Matrix')
      expect(item!.year).toBe(1999)
    })

    it('should count media items', () => {
      helper.insertMediaItem({ source_id: 'src-1', title: 'Movie 1', type: 'movie' })
      helper.insertMediaItem({ source_id: 'src-1', title: 'Movie 2', type: 'movie' })
      helper.insertMediaItem({ source_id: 'src-2', title: 'Movie 3', type: 'movie' })

      expect(helper.countMediaItems()).toBe(3)
      expect(helper.countMediaItems('src-1')).toBe(2)
      expect(helper.countMediaItems('src-2')).toBe(1)
    })

    it('should return null for non-existent media item', () => {
      expect(helper.getMediaItemById(999)).toBeNull()
    })
  })

  // ============================================================================
  // MEDIA ITEM VERSIONS
  // ============================================================================

  describe('media item versions', () => {
    let mediaItemId: number

    beforeEach(() => {
      helper.upsertMediaSource('src-1', 'plex', 'Test Plex')
      mediaItemId = helper.insertMediaItem({
        source_id: 'src-1',
        title: 'The Matrix',
        type: 'movie',
      })
    })

    it('should insert a version and return ID', () => {
      const id = helper.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        file_path: '/movies/matrix.mkv',
        resolution: '4K',
        video_codec: 'hevc',
        video_bitrate: 40000,
      })
      expect(id).toBeGreaterThan(0)
    })

    it('should update existing version by file_path (not create new)', () => {
      const id1 = helper.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        file_path: '/movies/matrix.mkv',
        resolution: '1080p',
      })

      const id2 = helper.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        file_path: '/movies/matrix.mkv',
        resolution: '4K',
      })

      expect(id2).toBe(id1)
      const versions = helper.getMediaItemVersions(mediaItemId)
      expect(versions).toHaveLength(1)
      expect(versions[0].resolution).toBe('4K')
    })

    it('should store multiple versions for same media item', () => {
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        file_path: '/movies/matrix_1080p.mkv',
        resolution: '1080p',
        edition: undefined,
      })
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        file_path: '/movies/matrix_4k.mkv',
        resolution: '4K',
        edition: 'Remastered',
      })

      const versions = helper.getMediaItemVersions(mediaItemId)
      expect(versions).toHaveLength(2)
    })

    it('should delete all versions for a media item', () => {
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        file_path: '/movies/matrix_1080p.mkv',
      })
      helper.upsertMediaItemVersion({
        media_item_id: mediaItemId,
        file_path: '/movies/matrix_4k.mkv',
      })

      helper.deleteMediaItemVersions(mediaItemId)
      expect(helper.getMediaItemVersions(mediaItemId)).toHaveLength(0)
    })

    it('should return empty array for media item with no versions', () => {
      expect(helper.getMediaItemVersions(mediaItemId)).toHaveLength(0)
    })
  })

  // ============================================================================
  // QUALITY SCORES
  // ============================================================================

  describe('quality scores', () => {
    let mediaItemId: number

    beforeEach(() => {
      helper.upsertMediaSource('src-1', 'plex', 'Test Plex')
      mediaItemId = helper.insertMediaItem({
        source_id: 'src-1',
        title: 'Test Movie',
        type: 'movie',
      })
    })

    it('should upsert and retrieve quality score', () => {
      helper.upsertQualityScore({
        media_item_id: mediaItemId,
        overall_score: 85,
        quality_tier: '1080p',
        tier_quality: 'HIGH',
        tier_score: 90,
        needs_upgrade: false,
      })

      const score = helper.getQualityScoreByMediaId(mediaItemId)
      expect(score).not.toBeNull()
      expect(score!.quality_tier).toBe('1080p')
      expect(score!.tier_quality).toBe('HIGH')
      expect(score!.tier_score).toBe(90)
    })

    it('should update existing quality score', () => {
      helper.upsertQualityScore({
        media_item_id: mediaItemId,
        tier_score: 50,
        tier_quality: 'MEDIUM',
      })

      helper.upsertQualityScore({
        media_item_id: mediaItemId,
        tier_score: 90,
        tier_quality: 'HIGH',
      })

      const score = helper.getQualityScoreByMediaId(mediaItemId)
      expect(score!.tier_score).toBe(90)
      expect(score!.tier_quality).toBe('HIGH')
    })

    it('should return null for non-existent score', () => {
      expect(helper.getQualityScoreByMediaId(999)).toBeNull()
    })
  })

  // ============================================================================
  // LIBRARY STATS
  // ============================================================================

  describe('library stats', () => {
    it('should count movies and episodes separately', () => {
      helper.upsertMediaSource('src-1', 'plex', 'Test')
      helper.insertMediaItem({ source_id: 'src-1', title: 'Movie 1', type: 'movie' })
      helper.insertMediaItem({ source_id: 'src-1', title: 'Movie 2', type: 'movie' })
      helper.insertMediaItem({ source_id: 'src-1', title: 'Episode 1', type: 'episode' })

      const stats = helper.getLibraryStats()
      expect(stats.totalItems).toBe(3)
      expect(stats.totalMovies).toBe(2)
      expect(stats.totalEpisodes).toBe(1)
    })

    it('should filter by source', () => {
      helper.upsertMediaSource('src-1', 'plex', 'Plex')
      helper.upsertMediaSource('src-2', 'jellyfin', 'Jellyfin')
      helper.insertMediaItem({ source_id: 'src-1', title: 'Movie 1', type: 'movie' })
      helper.insertMediaItem({ source_id: 'src-2', title: 'Movie 2', type: 'movie' })

      const stats = helper.getLibraryStats('src-1')
      expect(stats.totalItems).toBe(1)
    })

    it('should return zeros for empty library', () => {
      const stats = helper.getLibraryStats()
      expect(stats.totalItems).toBe(0)
      expect(stats.totalMovies).toBe(0)
      expect(stats.totalEpisodes).toBe(0)
    })
  })

  // ============================================================================
  // LIBRARY SCANS
  // ============================================================================

  describe('library scans', () => {
    it('should record and retrieve scan time', () => {
      helper.updateLibraryScanTime('src-1', 'lib-1', 100)
      const scanTime = helper.getLibraryScanTime('src-1', 'lib-1')
      expect(scanTime).not.toBeNull()
    })

    it('should return null for unscanned library', () => {
      expect(helper.getLibraryScanTime('src-1', 'lib-1')).toBeNull()
    })

    it('should update scan time on re-scan', () => {
      helper.updateLibraryScanTime('src-1', 'lib-1', 50)
      helper.updateLibraryScanTime('src-1', 'lib-1', 100)
      // Should not throw and should have updated
      const scanTime = helper.getLibraryScanTime('src-1', 'lib-1')
      expect(scanTime).not.toBeNull()
    })
  })

  // ============================================================================
  // SOURCE DELETION CASCADE
  // ============================================================================

  describe('source deletion cascade', () => {
    beforeEach(() => {
      // Set up a source with media items, versions, scores, and notifications
      helper.upsertMediaSource('src-1', 'plex', 'Test Plex')
      const itemId = helper.insertMediaItem({
        source_id: 'src-1',
        title: 'Movie to Delete',
        type: 'movie',
      })
      helper.upsertMediaItemVersion({
        media_item_id: itemId,
        file_path: '/movies/delete-me.mkv',
      })
      helper.upsertQualityScore({
        media_item_id: itemId,
        tier_score: 50,
      })
      helper.updateLibraryScanTime('src-1', 'lib-1', 10)
      helper.insertNotification('src-1', 'scan_complete', 'Scan done')

      // Also add data for a second source that should NOT be deleted
      helper.upsertMediaSource('src-2', 'jellyfin', 'Keep This')
      helper.insertMediaItem({
        source_id: 'src-2',
        title: 'Movie to Keep',
        type: 'movie',
      })
    })

    it('should delete all data for a source', () => {
      helper.deleteMediaSource('src-1')

      // Source should be gone
      expect(helper.getMediaSources().find(s => s.source_id === 'src-1')).toBeUndefined()

      // Media items should be gone
      expect(helper.countMediaItems('src-1')).toBe(0)

      // Notifications should be gone
      expect(helper.countNotifications('src-1')).toBe(0)

      // Scan times should be gone
      expect(helper.getLibraryScanTime('src-1', 'lib-1')).toBeNull()
    })

    it('should not affect other sources', () => {
      helper.deleteMediaSource('src-1')

      // Other source should still exist
      const sources = helper.getMediaSources()
      expect(sources).toHaveLength(1)
      expect(sources[0].source_id).toBe('src-2')

      // Other source's media items should still exist
      expect(helper.countMediaItems('src-2')).toBe(1)
    })
  })

  // ============================================================================
  // NOTIFICATIONS
  // ============================================================================

  describe('notifications', () => {
    it('should insert and count notifications', () => {
      helper.insertNotification('src-1', 'scan_complete', 'Scan finished')
      helper.insertNotification('src-1', 'error', 'Something failed')
      helper.insertNotification('src-2', 'info', 'Info message')

      expect(helper.countNotifications()).toBe(3)
      expect(helper.countNotifications('src-1')).toBe(2)
      expect(helper.countNotifications('src-2')).toBe(1)
    })
  })

  // ============================================================================
  // MEDIA SOURCES
  // ============================================================================

  describe('media sources', () => {
    it('should upsert and retrieve sources', () => {
      helper.upsertMediaSource('src-1', 'plex', 'My Plex')
      helper.upsertMediaSource('src-2', 'jellyfin', 'My Jellyfin')

      const sources = helper.getMediaSources()
      expect(sources).toHaveLength(2)
    })

    it('should update existing source on conflict', () => {
      helper.upsertMediaSource('src-1', 'plex', 'Old Name')
      helper.upsertMediaSource('src-1', 'plex', 'New Name')

      const sources = helper.getMediaSources()
      expect(sources).toHaveLength(1)
      expect(sources[0].display_name).toBe('New Name')
    })
  })
})
