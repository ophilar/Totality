/**
 * BetterSQLiteService Class-Method Tests
 *
 * Tests the actual BetterSQLiteService class methods (not raw SQL) by mocking
 * better-sqlite3 with a sql.js-backed adapter. This verifies business logic:
 * transactions, JSON manipulation, cascading deletes, credential handling.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../helpers/testDatabase'
import type { QualityScore } from '@main/types/database'

// Unmock sql.js — we need the real implementation
vi.unmock('sql.js')

// Shared test database — recreated per test
let testDb: TestDatabase

// Mock better-sqlite3 to return our sql.js adapter
vi.mock('better-sqlite3', () => {
  return {
    default: function() {
      return testDb
    },
  }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test') },
}))

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => true) },
  existsSync: vi.fn(() => true),
}))

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('node:path')
  return { ...actual }
})

vi.mock('../../src/main/services/CredentialEncryptionService', () => ({
  getCredentialEncryptionService: vi.fn(() => ({
    encryptSetting: vi.fn((_key: string, value: string) => value),
    decryptSetting: vi.fn((_key: string, value: string) => value),
    encryptConnectionConfig: vi.fn((config: any) => config),
    decryptConnectionConfig: vi.fn((config: any) => config),
  })),
}))

vi.mock('../../src/main/services/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: any) => e?.message || String(e)),
}))

import { BetterSQLiteService } from '@main/database/BetterSQLiteService'

// Helper to create and initialize a fresh service
async function createService(): Promise<BetterSQLiteService> {
  testDb = await createTestDatabase()
  const service = new BetterSQLiteService()
  service.initialize()
  return service
}

// Helper to insert a media source
function insertSource(service: BetterSQLiteService, sourceId = 'src-1', sourceType = 'plex') {
  ;(service as any).db.prepare(`
    INSERT INTO media_sources (source_id, source_type, display_name, connection_config, is_enabled)
    VALUES (?, ?, ?, '{}', 1)
  `).run(sourceId, sourceType, `Test ${sourceType}`)
}

// Helper to create a minimal media item
function makeMediaItem(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    plex_id: 'plex-1',
    title: 'Test Movie',
    type: 'movie',
    file_path: '/movies/test.mkv',
    file_size_bytes: 1000000,
    duration_ms: 7200,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'HEVC',
    video_bitrate_kbps: 5000,
    audio_codec: 'AAC',
    audio_channels: 2,
    audio_bitrate_kbps: 128,
    ...overrides,
  }
}

function makeQualityScore(mediaItemId: number, estimatedSavingsBytes: number | null): Omit<QualityScore, 'created_at' | 'updated_at'> {
  return {
    media_item_id: mediaItemId,
    quality_tier: '1080p',
    tier_quality: 'LOW',
    tier_score: 0,
    bitrate_tier_score: 0,
    audio_tier_score: 0,
    overall_score: 0,
    resolution_score: 0,
    bitrate_score: 0,
    audio_score: 0,
    is_low_quality: true,
    needs_upgrade: true,
    issues: '[]',
    estimated_savings_bytes: estimatedSavingsBytes,
    savings_coverage: 'complete',
  }
}

// Helper to create a minimal music artist
function makeMusicArtist(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    provider_id: 'artist-1',
    name: 'Test Artist',
    album_count: 1,
    track_count: 5,
    ...overrides,
  }
}

// Helper to create a minimal music album
function makeMusicAlbum(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    provider_id: 'album-1',
    title: 'Test Album',
    artist_name: 'Test Artist',
    track_count: 5,
    ...overrides,
  }
}

// Helper to create a minimal music track
function makeMusicTrack(overrides: Record<string, any> = {}) {
  return {
    source_id: 'src-1',
    source_type: 'plex',
    provider_id: 'track-1',
    title: 'Test Track',
    artist_name: 'Test Artist',
    audio_codec: 'FLAC',
    ...overrides,
  }
}

describe('BetterSQLiteService — upgrading older savings schemas', () => {
  it('adds the savings column when upgrading a 0.4.2 database that has neither column', async () => {
    testDb = await createTestDatabase()
    testDb.exec('ALTER TABLE quality_scores DROP COLUMN video_savings_bytes')

    new BetterSQLiteService().initialize()

    const columns = testDb.prepare('PRAGMA table_info(quality_scores)').all() as Array<{ name: string }>
    expect(columns.some(column => column.name === 'video_savings_bytes')).toBe(true)
    expect(columns.some(column => column.name === 'storage_debt_bytes')).toBe(false)
  })

  it('renames the legacy savings column rather than creating a duplicate', async () => {
    testDb = await createTestDatabase()
    testDb.exec('ALTER TABLE quality_scores RENAME COLUMN video_savings_bytes TO storage_debt_bytes')

    new BetterSQLiteService().initialize()

    const columns = testDb.prepare('PRAGMA table_info(quality_scores)').all() as Array<{ name: string }>
    expect(columns.filter(column => column.name === 'video_savings_bytes')).toHaveLength(1)
    expect(columns.some(column => column.name === 'storage_debt_bytes')).toBe(false)
  })
})

// ============================================================================
// SETTINGS
// ============================================================================
describe('BetterSQLiteService — Settings', () => {
  let service: BetterSQLiteService

  beforeAll(async () => {
    service = await createService()
    insertSource(service)
  })

  it('setSetting and getSetting round-trip', () => {
    service.setSetting('test_key', 'test_value')
    expect(service.getSetting('test_key')).toBe('test_value')
  })

  it('setSetting overwrites existing', () => {
    service.setSetting('key1', 'value1')
    service.setSetting('key1', 'value2')
    expect(service.getSetting('key1')).toBe('value2')
  })

  it('getSetting returns null for missing key', () => {
    expect(service.getSetting('nonexistent')).toBeNull()
  })

  it('deleteSetting removes entry', () => {
    service.setSetting('to_delete', 'val')
    service.deleteSetting('to_delete')
    expect(service.getSetting('to_delete')).toBeNull()
  })

  it('getAllSettings returns all entries', () => {
    service.setSetting('s1', 'v1')
    service.setSetting('s2', 'v2')
    const all = service.getAllSettings()
    expect(all['s1']).toBe('v1')
    expect(all['s2']).toBe('v2')
  })
})

// ============================================================================
// MEDIA ITEMS
// ============================================================================
describe('BetterSQLiteService — Media Items', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('projects movie cards without loading deep analysis or changing filters', () => {
    service.upsertMediaItem(makeMediaItem({ plex_id: 'card-a', title: 'Alpha' }))
    service.upsertMediaItem(makeMediaItem({ plex_id: 'card-b', title: 'Beta' }))
    const cards = service.getMediaItems({ type: 'movie', sortBy: 'title', sortOrder: 'asc' }, 'card')
    expect(cards.map(movie => movie.title)).toEqual(['Alpha', 'Beta'])
    expect(cards[0]).toMatchObject({ resolution: '1080p', video_bitrate_kbps: 5000, file_path: '/movies/test.mkv' })
    expect(cards[0]).not.toHaveProperty('deep_analysis')
    expect(cards[0]).not.toHaveProperty('subtitle_tracks')
  })

  it('scopes recent quality upgrades to the scanned source', () => {
    insertSource(service, 'src-2')
    const primary = service.upsertMediaItem(makeMediaItem({ plex_id: 'quality-a', source_id: 'src-1', file_path: '/movies/a.mkv' }))
    const secondary = service.upsertMediaItem(makeMediaItem({ plex_id: 'quality-b', source_id: 'src-2', file_path: '/movies/b.mkv' }))
    for (const id of [primary, secondary]) {
      service.upsertQualityScore(makeQualityScore(id, 0))
      ;(service as any).db.prepare("UPDATE quality_scores SET previous_quality_tier = '720p', upgraded_at = datetime('now') WHERE media_item_id = ?").run(id)
    }
    expect(service.getRecentlyUpgraded(1, 'src-1').map(item => item.id)).toEqual([primary])
    expect(service.getRecentlyUpgraded(1, 'src-2').map(item => item.id)).toEqual([secondary])
  })

  it('upsertMediaItem inserts and returns ID', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    expect(id).toBeGreaterThan(0)
  })

  it('upsertMediaItem updates existing (same source_id + plex_id)', () => {
    const id1 = service.upsertMediaItem(makeMediaItem({ title: 'Original' }))
    const id2 = service.upsertMediaItem(makeMediaItem({ title: 'Updated' }))
    expect(id2).toBe(id1)

    const item = service.getMediaItem(id1)
    expect(item?.title).toBe('Updated')
  })

  it('preserves matched original language across provider rescans', () => {
    const id = service.upsertMediaItem(makeMediaItem({ tmdb_id: '123' }))
    service.updateMovieMatch(id, '123', undefined, undefined, undefined, 'en')

    service.upsertMediaItem(makeMediaItem({ title: 'Rescanned title', tmdb_id: '123' }))

    expect(service.getMediaItem(id)?.original_language).toBe('en')
  })

  it('ranks alternate versions by resolution and preserves a tied existing selection', () => {
    const mediaItemId = service.upsertMediaItem(makeMediaItem())
    const createVersion = (filePath: string, resolution: string, height: number, isBest: boolean) => ({
      media_item_id: mediaItemId,
      version_source: 'local_file',
      file_path: filePath,
      file_size_bytes: 1_000_000,
      duration_ms: 7_200,
      resolution,
      width: 1920,
      height,
      video_codec: 'h264',
      video_bitrate_kbps: 2_000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate_kbps: 128,
      quality_tier: '1080p',
      tier_quality: 'UNKNOWN' as const,
      tier_score: null,
      is_best: isBest,
    })
    service.upsertMediaItemVersion(createVersion('/versions/a.mkv', '1080p', 1080, true))
    service.upsertMediaItemVersion(createVersion('/versions/b.mkv', '1080p', 1080, false))

    service.syncMediaItemVersions(mediaItemId, [
      createVersion('/versions/a.mkv', '1080p', 1080, false),
      createVersion('/versions/b.mkv', '1080p', 1080, false),
    ])

    const versions = service.getMediaItemVersions(mediaItemId)
    expect(versions.filter(version => version.is_best).map(version => version.file_path)).toEqual(['/versions/a.mkv'])
    expect(versions.every(version => version.tier_score === null)).toBe(true)
  })

  it('merges a changed movie edition without deleting unchanged sibling versions', () => {
    const id = service.upsertMediaItem(makeMediaItem({ source_type: 'local', plex_id: 'canonical-movie' }))
    const version = (filePath: string, resolution: string, height: number) => ({
      media_item_id: id, version_source: 'local_file', file_path: filePath,
      file_size_bytes: 1234, duration_ms: 7_200, resolution, width: 1920, height,
      video_codec: 'h264', video_bitrate_kbps: 2000, audio_codec: 'aac',
      audio_channels: 2, audio_bitrate_kbps: 128, quality_tier: resolution,
      tier_quality: 'UNKNOWN' as const, tier_score: null, is_best: false,
    })
    service.syncMediaItemVersions(id, [
      version('/versions/theatrical.mkv', '1080p', 1080),
      version('/versions/extended.mkv', '4K', 2160),
    ])
    expect(service.getMediaItemByPath('/versions/extended.mkv')?.id).toBe(id)

    // A watcher or incremental scan sees only one file. Its update is not
    // permission to remove the other version, or to create a second parent.
    service.syncMediaItemVersions(id, [
      version('/versions/theatrical.mkv', '1080p', 1080),
    ], 'merge')
    expect(service.getMediaItemVersions(id).map(row => row.file_path).sort()).toEqual([
      '/versions/extended.mkv', '/versions/theatrical.mkv',
    ])
    expect(service.getMediaItemByPath('/versions/theatrical.mkv')?.id).toBe(id)

    // If a complete scan currently sees only the theatrical edition, it can
    // select that version without losing any historical version record.
    service.updateBestVersion(id, new Set(['/versions/theatrical.mkv']))
    expect(service.getMediaItem(id)?.file_path).toBe('/versions/theatrical.mkv')
    expect(service.getMediaItemVersions(id)).toHaveLength(2)
  })

  it('maps SQLite integer flags to booleans when loading versions in batches', () => {
    const mediaItemId = service.upsertMediaItem(makeMediaItem())
    const versionId = service.upsertMediaItemVersion({
      media_item_id: mediaItemId,
      version_source: 'local_file',
      file_path: '/versions/no-object-audio.mkv',
      file_size_bytes: 1_000_000,
      duration_ms: 7_200,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate_kbps: 2_000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate_kbps: 192,
      has_object_audio: false,
      quality_tier: '1080p',
      tier_quality: 'UNKNOWN',
      tier_score: null,
      is_best: false,
    })

    const version = service.getItemVersionsForMediaIds([mediaItemId]).get(mediaItemId)?.[0]

    expect(version?.id).toBe(versionId)
    expect(version?.has_object_audio).toBe(false)
    expect(version?.is_best).toBe(false)
  })

  it('leaves equal-resolution versions unselected when no existing selection breaks the tie', () => {
    const mediaItemId = service.upsertMediaItem(makeMediaItem({ file_path: '/movies/primary.mkv' }))
    const createVersion = (filePath: string) => ({
      media_item_id: mediaItemId,
      version_source: 'local_file',
      file_path: filePath,
      file_size_bytes: 1_000_000,
      duration_ms: 7_200,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      video_bitrate_kbps: 2_000,
      audio_codec: 'aac',
      audio_channels: 2,
      audio_bitrate_kbps: 128,
      quality_tier: '1080p',
      tier_quality: 'UNKNOWN' as const,
      tier_score: null,
      is_best: false,
    })
    service.upsertMediaItemVersion(createVersion('/versions/a.mkv'))
    service.upsertMediaItemVersion(createVersion('/versions/b.mkv'))

    service.updateBestVersion(mediaItemId)

    expect(service.getMediaItemVersions(mediaItemId).some(version => version.is_best)).toBe(false)
    expect(service.getMediaItem(mediaItemId)?.file_path).toBe('/movies/primary.mkv')
  })

  it('preserves quality ratings when savings semantics change', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    service.upsertQualityScore({ ...makeQualityScore(id, 300), video_savings_bytes: 125 })
    const versionId = service.upsertMediaItemVersion({
      media_item_id: id,
      version_source: 'local_file',
      file_path: '/movies/version.mkv',
      file_size_bytes: 1_000_000,
      duration_ms: 7_200,
      resolution: '1080p',
      width: 1920,
      height: 1080,
      video_codec: 'HEVC',
      video_bitrate_kbps: 5_000,
      audio_codec: 'AAC',
      audio_channels: 2,
      audio_bitrate_kbps: 128,
      quality_tier: '1080p',
      tier_quality: 'UNKNOWN',
      tier_score: null,
    })
    testDb.prepare("UPDATE settings SET value = '1' WHERE key = 'optimization.savings_semantics_version'").run()

    const migratedService = new BetterSQLiteService()
    migratedService.initialize()
    expect(migratedService.getQualityScore(id)?.estimated_savings_bytes).toBeNull()
    expect(migratedService.getQualityScore(id)?.video_savings_bytes).toBeNull()
    expect(migratedService.getQualityScore(id)?.tier_quality).toBe('LOW')
    expect(migratedService.getQualityScore(id)?.tier_score).toBe(0)
    expect(migratedService.getQualityScore(id)?.overall_score).toBe(0)
    expect(migratedService.getQualityScore(id)?.quality_tier).toBe('1080p')
    expect(migratedService.getMediaItemVersions(id).find(version => version.id === versionId)?.tier_score).toBeNull()
    expect(migratedService.getSetting('optimization.savings_reanalysis_pending')).toBe('true')

    migratedService.upsertQualityScore({ ...makeQualityScore(id, 450), video_savings_bytes: 125 })
    new BetterSQLiteService().initialize()
    expect(migratedService.getQualityScore(id)?.estimated_savings_bytes).toBe(450)
  })

  it('invalidates version 5 savings without clearing existing quality ratings', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    const score = { ...makeQualityScore(id, 300), tier_quality: 'HIGH', tier_score: 87, video_savings_bytes: 125 }
    service.upsertQualityScore(score)
    testDb.prepare("UPDATE settings SET value = '5' WHERE key = 'optimization.savings_semantics_version'").run()

    const migratedService = new BetterSQLiteService()
    migratedService.initialize()
    expect(migratedService.getQualityScore(id)?.estimated_savings_bytes).toBeNull()
    expect(migratedService.getQualityScore(id)?.video_savings_bytes).toBeNull()
    expect(migratedService.getQualityScore(id)?.tier_quality).toBe('HIGH')
    expect(migratedService.getQualityScore(id)?.tier_score).toBe(87)
    expect(migratedService.getSetting('optimization.savings_reanalysis_pending')).toBe('true')
  })

  it('updates savings without changing saved quality ratings', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    service.upsertQualityScore({ ...makeQualityScore(id, 300), tier_quality: 'HIGH', tier_score: 87, video_savings_bytes: 125 })

    service.media.updateQualitySavings({
      media_item_id: id,
      video_savings_bytes: 250,
      estimated_savings_bytes: 450,
      savings_coverage: 'complete',
      evidence_status: 'estimated',
      confidence: 'medium',
      savings_basis: 'video_bitrate_estimate',
    })

    expect(service.getQualityScore(id)).toMatchObject({
      tier_quality: 'HIGH',
      tier_score: 87,
      needs_upgrade: 1,
      video_savings_bytes: 250,
      estimated_savings_bytes: 450,
    })
  })

  it('queues quality recovery for scores cleared by the previous 0.5 migration', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    service.upsertQualityScore(makeQualityScore(id, null))
    testDb.prepare(`UPDATE quality_scores SET tier_quality = 'UNKNOWN', tier_score = NULL,
      bitrate_tier_score = NULL, audio_tier_score = NULL, overall_score = NULL,
      resolution_score = NULL, bitrate_score = NULL, audio_score = NULL,
      is_low_quality = 0, needs_upgrade = 0 WHERE media_item_id = ?`).run(id)
    testDb.prepare("DELETE FROM settings WHERE key = 'optimization.quality_recovery_version'").run()

    const migratedService = new BetterSQLiteService()
    migratedService.initialize()

    expect(migratedService.getSetting('optimization.quality_reanalysis_pending')).toBe('true')
  })

  it('preserves media quality values when migrating legacy column names', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    service.upsertQualityScore({ ...makeQualityScore(id, 300), video_savings_bytes: 200 })

    testDb.exec(`
      ALTER TABLE media_items RENAME COLUMN file_size_bytes TO file_size;
      ALTER TABLE media_items RENAME COLUMN duration_ms TO duration;
      ALTER TABLE media_items RENAME COLUMN video_bitrate_kbps TO video_bitrate;
      ALTER TABLE media_items RENAME COLUMN audio_bitrate_kbps TO audio_bitrate;
      ALTER TABLE media_item_versions RENAME COLUMN file_size_bytes TO file_size;
      ALTER TABLE media_item_versions RENAME COLUMN duration_ms TO duration;
      ALTER TABLE media_item_versions RENAME COLUMN video_bitrate_kbps TO video_bitrate;
      ALTER TABLE media_item_versions RENAME COLUMN audio_bitrate_kbps TO audio_bitrate;
      ALTER TABLE quality_scores RENAME COLUMN video_savings_bytes TO storage_debt_bytes;
    `)

    const migratedService = new BetterSQLiteService()
    migratedService.initialize()

    const item = migratedService.getMediaItem(id)
    const score = migratedService.getQualityScore(id)
    expect(item?.file_size_bytes).toBe(1_000_000)
    expect(item?.duration_ms).toBe(7_200)
    expect(item?.video_bitrate_kbps).toBe(5_000)
    expect(item?.audio_bitrate_kbps).toBe(128)
    expect(score?.video_savings_bytes).toBe(200)
    expect(score?.estimated_savings_bytes).toBe(300)
  })

  it('getMediaItem returns correct shape', () => {
    const id = service.upsertMediaItem(makeMediaItem({ year: 2020 }))
    const item = service.getMediaItem(id)
    expect(item).toBeDefined()
    expect(item?.title).toBe('Test Movie')
    expect(item?.year).toBe(2020)
    expect(item?.type).toBe('movie')
  })

  it('hydrates persisted media flags as booleans for single and joined queries', () => {
    const id = service.upsertMediaItem(makeMediaItem({
      has_object_audio: true,
      user_fixed_match: true,
    }))
    service.upsertQualityScores([makeQualityScore(id, 0)])

    const item = service.getMediaItem(id)
    const listedItem = service.getMediaItems()[0]

    expect(item?.has_object_audio).toBe(true)
    expect(item?.user_fixed_match).toBe(true)
    expect(listedItem.has_object_audio).toBe(true)
    expect(listedItem.needs_upgrade).toBe(true)
    expect(listedItem.user_fixed_match).toBe(true)
    expect(typeof listedItem.has_object_audio).toBe('boolean')
  })

  it('persists overall quality and flags through bulk quality ratings', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    const score = makeQualityScore(id, null)

    service.upsertQualityRatings([score as QualityScore])

    const persisted = service.getQualityScore(id)
    expect(persisted?.overall_score).toBe(0)
    expect(Boolean(persisted?.is_low_quality)).toBe(true)
    expect(Boolean(persisted?.needs_upgrade)).toBe(true)
  })

  it('getMediaItem returns null for non-existent', () => {
    expect(service.getMediaItem(99999)).toBeNull()
  })

  it('getMediaItems filters by type', () => {
    service.upsertMediaItem(makeMediaItem({ plex_id: 'm1', type: 'movie' }))
    service.upsertMediaItem(makeMediaItem({ plex_id: 'e1', type: 'episode', series_title: 'Show' }))
    const movies = service.getMediaItems({ type: 'movie' })
    expect(movies.every((m: any) => m.type === 'movie')).toBe(true)
  })

  it('sorts movies by numeric estimated savings with missing estimates last', () => {
    const lowerSavingsId = service.upsertMediaItem(makeMediaItem({ plex_id: 'lower-savings', title: 'Lower' }))
    const higherSavingsId = service.upsertMediaItem(makeMediaItem({ plex_id: 'higher-savings', title: 'Higher' }))
    const unknownSavingsId = service.upsertMediaItem(makeMediaItem({ plex_id: 'unknown-savings', title: 'Unknown' }))
    service.upsertQualityScores([
      makeQualityScore(lowerSavingsId, 900_000_000),
      makeQualityScore(higherSavingsId, 2_400_000_000),
      makeQualityScore(unknownSavingsId, null),
    ])

    const movies = service.getMediaItems({ type: 'movie', sortBy: 'estimated_savings_bytes', sortOrder: 'desc' })

    expect(movies.map(movie => movie.title)).toEqual(['Higher', 'Lower', 'Unknown'])
    expect(movies.map(movie => movie.estimated_savings_bytes)).toEqual([2_400_000_000, 900_000_000, null])
  })

  it('aggregates estimated savings using the same media filters as the movie list', () => {
    const matchingId = service.upsertMediaItem(makeMediaItem({ plex_id: 'matching', source_id: 'src-1', title: 'Search Match' }))
    const otherSourceId = service.upsertMediaItem(makeMediaItem({ plex_id: 'other-source', source_id: 'src-2', title: 'Search Match' }))
    service.upsertQualityScores([
      makeQualityScore(matchingId, 640_000_000),
      makeQualityScore(otherSourceId, 2_000_000_000),
    ])

    const filters = { type: 'movie' as const, sourceId: 'src-1', searchQuery: 'Search Match' }

    expect(service.getOptimizationMetrics(filters)).toEqual({ estimatedSavingsBytes: 640_000_000, coverage: 'complete' })
    expect(service.getOptimizationMetrics({ ...filters, sourceId: 'missing-source' })).toEqual({ estimatedSavingsBytes: null, coverage: 'insufficient' })
  })

  it('sorts shows by their aggregate numeric estimated savings', () => {
    const episodeOneId = service.upsertMediaItem(makeMediaItem({
      plex_id: 'show-a-1', title: 'Episode 1', type: 'episode', series_title: 'Show A', series_tmdb_id: 1001,
    }))
    const episodeTwoId = service.upsertMediaItem(makeMediaItem({
      plex_id: 'show-a-2', title: 'Episode 2', type: 'episode', series_title: 'Show A', series_tmdb_id: 1001,
    }))
    const episodeThreeId = service.upsertMediaItem(makeMediaItem({
      plex_id: 'show-b-1', title: 'Episode 1', type: 'episode', series_title: 'Show B', series_tmdb_id: 1002,
    }))
    service.upsertQualityScores([
      makeQualityScore(episodeOneId, 700_000_000),
      makeQualityScore(episodeTwoId, 600_000_000),
      makeQualityScore(episodeThreeId, 1_000_000_000),
    ])

    const shows = service.getTVShows({ sortBy: 'estimated_savings_bytes', sortOrder: 'desc' })

    expect(shows.map(show => show.series_title)).toEqual(['Show A', 'Show B'])
    expect(shows.map(show => show.estimated_savings_bytes)).toEqual([1_300_000_000, 1_000_000_000])
  })

  it('does not sort shows by the removed video profile score', () => {
    const highProfileId = service.upsertMediaItem(makeMediaItem({
      plex_id: 'show-high', type: 'episode', series_title: 'High Profile', series_tmdb_id: 2001,
    }))
    const lowProfileId = service.upsertMediaItem(makeMediaItem({
      plex_id: 'show-low', type: 'episode', series_title: 'Low Profile', series_tmdb_id: 2002,
    }))
    const unknownProfileId = service.upsertMediaItem(makeMediaItem({
      plex_id: 'show-unknown', type: 'episode', series_title: 'Unknown Profile', series_tmdb_id: 2003,
    }))
    service.upsertQualityScores([
      { ...makeQualityScore(highProfileId, null), tier_score: 84 },
      { ...makeQualityScore(lowProfileId, null), tier_score: 62 },
      { ...makeQualityScore(unknownProfileId, null), tier_score: null },
    ])

    const shows = service.getTVShows({ sortBy: 'title', sortOrder: 'asc' })
    expect(shows.map(show => show.series_title)).toEqual(['High Profile', 'Low Profile', 'Unknown Profile'])
  })

  it('countMediaItems counts by source', () => {
    service.upsertMediaItem(makeMediaItem({ plex_id: 'a1' }))
    service.upsertMediaItem(makeMediaItem({ plex_id: 'a2' }))
    const count = service.countMediaItems({ sourceId: 'src-1' })
    expect(count).toBe(2)
  })

  it('deleteMediaItem removes item and cascades', () => {
    const id = service.upsertMediaItem(makeMediaItem())
    service.deleteMediaItem(id)
    expect(service.getMediaItem(id)).toBeNull()
  })

  it('upsertMediaItem automatically derives canonical series_identity_key for episodes when omitted', () => {
    const id = service.upsertMediaItem(
      makeMediaItem({
        plex_id: 'ep-auto-1',
        type: 'episode',
        series_title: 'Severance',
        series_tmdb_id: 111110,
        season_number: 1,
        episode_number: 1,
      })
    )
    const item = service.getMediaItem(id)
    expect(item?.series_identity_key).toBe('tmdb:111110')
  })

  it('getEpisodes retrieves episodes by canonical series_identity_key with source and library scopes', () => {
    service.upsertMediaItem(
      makeMediaItem({
        plex_id: 'ep-single-1',
        type: 'episode',
        series_title: 'Chernobyl',
        series_tmdb_id: 87108,
        library_id: 'lib-1',
        season_number: 1,
        episode_number: 1,
      })
    )
    const eps = service.getEpisodes('Chernobyl', 'src-1', 'tmdb:87108', 'lib-1')
    expect(eps.length).toBe(1)
    expect(eps[0].series_identity_key).toBe('tmdb:87108')
  })

  it('fails at SQLite boundary when inserting an episode with missing or empty series_identity_key', () => {
    expect(() => {
      ;(service as any).db.prepare(`
        INSERT INTO media_items (
          source_id, source_type, library_id, plex_id, title, type,
          file_path, file_size_bytes, duration_ms, resolution, width, height,
          video_codec, video_bitrate_kbps, audio_codec, audio_channels, audio_bitrate_kbps,
          series_title, series_identity_key
        ) VALUES (
          'src-1', 'plex', 'lib-1', 'bad-ep-1', 'Bad Episode', 'episode',
          '/path/to/bad.mkv', 1000, 100, '1080p', 1920, 1080,
          'h264', 5000, 'aac', 2, 192,
          'Bad Show', ''
        )
      `).run()
    }).toThrow(/series_identity_key must be a canonical key/)
  })

  it('fails at SQLite boundary when inserting an episode with non-canonical raw title key', () => {
    expect(() => {
      ;(service as any).db.prepare(`
        INSERT INTO media_items (
          source_id, source_type, library_id, plex_id, title, type,
          file_path, file_size_bytes, duration_ms, resolution, width, height,
          video_codec, video_bitrate_kbps, audio_codec, audio_channels, audio_bitrate_kbps,
          series_title, series_identity_key
        ) VALUES (
          'src-1', 'plex', 'lib-1', 'bad-ep-2', 'Bad Episode', 'episode',
          '/path/to/bad2.mkv', 1000, 100, '1080p', 1920, 1080,
          'h264', 5000, 'aac', 2, 192,
          'Raw Show Title', 'Raw Show Title'
        )
      `).run()
    }).toThrow(/series_identity_key must be a canonical key/)
  })

  it('upsertMediaItem derives canonical key when caller supplies non-canonical raw title as series_identity_key', () => {
    const id = service.upsertMediaItem(
      makeMediaItem({
        plex_id: 'ep-noncanonical-raw',
        type: 'episode',
        series_title: 'Unfixed Show',
        series_identity_key: 'Unfixed Show', // non-canonical raw string
        series_tmdb_id: 12345,
        library_id: 'lib-1',
        season_number: 1,
        episode_number: 1,
      })
    )
    const item = service.getMediaItem(id)
    expect(item?.series_identity_key).toBe('tmdb:12345')
  })

  it('updateSeriesMatch updates episodes and completeness by canonical identity and library scope', () => {
    // Show 1: The Office (UK)
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'uk-match-1', type: 'episode', series_title: 'The Office', series_tmdb_id: 2996,
      season_number: 1, episode_number: 1, library_id: 'lib-uk',
    }))
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES ('tmdb:2996', 'The Office', 'src-1', 'lib-uk', '2996', 1, 12, 1, 1, '[]', '[]', 8)
    `).run()

    // Show 2: The Office (US) in different library
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'us-match-1', type: 'episode', series_title: 'The Office', series_tmdb_id: 2353,
      season_number: 1, episode_number: 1, library_id: 'lib-us',
    }))
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES ('tmdb:2353', 'The Office', 'src-1', 'lib-us', '2353', 9, 201, 1, 1, '[]', '[]', 1)
    `).run()

    // Fix match of UK show to a new TMDB ID (e.g. rematched ID 99999)
    const updated = service.updateSeriesMatch(
      'tmdb:2996',
      'src-1',
      'lib-uk',
      '99999',
      'https://image.tmdb.org/poster.jpg',
      'The Office (UK Rematched)'
    )
    expect(updated).toBe(1)

    // Verify UK show was updated to new identity key and title
    const ukEp = service.getMediaItemByProviderId('uk-match-1', 'src-1')
    expect(ukEp?.series_identity_key).toBe('tmdb:99999')
    expect(ukEp?.series_title).toBe('The Office (UK Rematched)')

    // Verify US show was NOT touched (collision immunity across library & key scopes)
    const usEp = service.getMediaItemByProviderId('us-match-1', 'src-1')
    expect(usEp?.series_identity_key).toBe('tmdb:2353')
    expect(usEp?.series_title).toBe('The Office')
  })

  it('handles collision gracefully when series_completeness already contains target tmdb key in scope', () => {
    // Show 1: Unresolved show
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'collide-ep-1', type: 'episode', series_title: 'Mystery Show',
      series_identity_key: 'unresolved:src-1:lib-1:mystery-show',
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES ('unresolved:src-1:lib-1:mystery-show', 'Mystery Show', 'src-1', 'lib-1', '', 1, 1, 1, 1, '[]', '[]', 100)
    `).run()

    // Existing target row for tmdb:1396 already exists in lib-1
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES ('tmdb:1396', 'Breaking Bad', 'src-1', 'lib-1', '1396', 5, 62, 0, 0, '[]', '[]', 0)
    `).run()

    // Rematching mystery show to tmdb:1396 should merge without UNIQUE constraint failure
    expect(() => {
      service.updateSeriesMatch(
        'unresolved:src-1:lib-1:mystery-show',
        'src-1',
        'lib-1',
        '1396',
        'https://image.tmdb.org/poster.jpg',
        'Breaking Bad'
      )
    }).not.toThrow()

    // Episode key updated
    const ep = service.getMediaItemByProviderId('collide-ep-1', 'src-1')
    expect(ep?.series_identity_key).toBe('tmdb:1396')
    expect(ep?.series_title).toBe('Breaking Bad')

    // Single surviving completeness row exists
    const rows = (service as any).db.prepare(
      'SELECT id, series_identity_key, tmdb_id, series_title FROM series_completeness WHERE source_id = ? AND library_id = ?'
    ).all('src-1', 'lib-1') as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].series_identity_key).toBe('tmdb:1396')
    expect(rows[0].tmdb_id).toBe('1396')
  })

  it('updates unscoped series match when libraryId is undefined or empty without leaking into scoped libraries', () => {
    // Episode without libraryId (null)
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'unscoped-ep-1', type: 'episode', series_title: 'Unscoped Show',
      series_identity_key: 'unresolved:src-1::unscoped-show',
      season_number: 1, episode_number: 1, library_id: null as any,
    }))
    // Episode in specific library (lib-1)
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'scoped-ep-1', type: 'episode', series_title: 'Unscoped Show',
      series_identity_key: 'unresolved:src-1::unscoped-show',
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))

    const updated = service.updateSeriesMatch(
      'unresolved:src-1::unscoped-show',
      'src-1',
      undefined,
      '1396',
      'https://image.tmdb.org/poster.jpg',
      'Breaking Bad'
    )

    expect(updated).toBe(1)

    // Unscoped episode was updated
    const unscopedEp = service.getMediaItemByProviderId('unscoped-ep-1', 'src-1')
    expect(unscopedEp?.series_identity_key).toBe('tmdb:1396')
    expect(unscopedEp?.series_title).toBe('Breaking Bad')

    // Scoped episode was NOT touched
    const scopedEp = service.getMediaItemByProviderId('scoped-ep-1', 'src-1')
    expect(scopedEp?.series_identity_key).toBe('unresolved:src-1::unscoped-show')
    expect(scopedEp?.series_title).toBe('Unscoped Show')
  })
})

// ============================================================================
// DELETE MEDIA ITEM — EPISODE PATH (series completeness updates)
// ============================================================================
describe('BetterSQLiteService — deleteMediaItem episode cascade', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('invalidates series completeness when episode deleted', () => {
    // Insert two episodes of the same series
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'ep1', type: 'episode', series_title: 'Show A',
      season_number: 1, episode_number: 1, title: 'Pilot', library_id: 'lib-1',
    }))
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'ep2', type: 'episode', series_title: 'Show A',
      season_number: 1, episode_number: 2, title: 'Second', library_id: 'lib-1',
    }))

    // Insert series completeness record
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES (?, ?, ?, ?, '', 1, 5, 1, 2, '[]', '[]', 40)
    `).run('unresolved:src-1:lib-1:show-a', 'Show A', 'src-1', 'lib-1')

    // Delete one episode
    const ep1 = service.getMediaItemByProviderId('ep1', 'src-1')
    service.deleteMediaItem(ep1!.id!)

    // Completion is derived from the aired catalogue and remains unknown until reanalysis.
    const sc = (service as any).db.prepare(
      'SELECT * FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
    ).get('unresolved:src-1:lib-1:show-a', 'src-1', 'lib-1') as any
    expect(sc).toBeUndefined()
  })

  it('removes series completeness when last episode deleted', () => {
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'ep-only', type: 'episode', series_title: 'Solo Show',
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))

    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES (?, ?, ?, ?, '', 1, 3, 1, 1, '[]', '[]', 33)
    `).run('unresolved:src-1:lib-1:solo-show', 'Solo Show', 'src-1', 'lib-1')

    const ep = service.getMediaItemByProviderId('ep-only', 'src-1')
    service.deleteMediaItem(ep!.id!)

    const sc = (service as any).db.prepare(
      'SELECT * FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
    ).get('unresolved:src-1:lib-1:solo-show', 'src-1', 'lib-1')
    expect(sc).toBeUndefined()
  })

  it('isolates series completeness updates by series_identity_key when deleting episodes of same-titled shows', () => {
    // UK Show (The Office, tmdb:2996)
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'uk-ep1', type: 'episode', series_title: 'The Office', series_tmdb_id: 2996,
      season_number: 1, episode_number: 1, library_id: 'lib-uk',
    }))
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'uk-ep2', type: 'episode', series_title: 'The Office', series_tmdb_id: 2996,
      season_number: 1, episode_number: 2, library_id: 'lib-uk',
    }))
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES (?, ?, ?, ?, '2996', 1, 12, 1, 2, '[]', '[]', 17)
    `).run('tmdb:2996', 'The Office', 'src-1', 'lib-uk')

    // US Show (The Office, tmdb:2353)
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'us-ep1', type: 'episode', series_title: 'The Office', series_tmdb_id: 2353,
      season_number: 1, episode_number: 1, library_id: 'lib-us',
    }))
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES (?, ?, ?, ?, '2353', 9, 201, 1, 1, '[]', '[]', 1)
    `).run('tmdb:2353', 'The Office', 'src-1', 'lib-us')

    // Delete episode 1 of UK show
    const ukEp1 = service.getMediaItemByProviderId('uk-ep1', 'src-1')
    service.deleteMediaItem(ukEp1!.id!)

    // UK cache must be removed so it cannot display a stale completion value.
    const scUk = (service as any).db.prepare(
      'SELECT * FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
    ).get('tmdb:2996', 'src-1', 'lib-uk')
    expect(scUk).toBeUndefined()

    // US show completeness must remain completely untouched (still 1 owned episode)
    const scUs = (service as any).db.prepare(
      'SELECT owned_episodes FROM series_completeness WHERE series_identity_key = ? AND source_id = ? AND library_id = ?'
    ).get('tmdb:2353', 'src-1', 'lib-us') as any
    expect(scUs).toBeDefined()
    expect(scUs.owned_episodes).toBe(1)
  })

  it('invalidates only the deleted series cache within its source and library scope', () => {
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'scoped-ep', type: 'episode', series_title: 'Scoped Show', series_tmdb_id: 700,
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))

    const insertCompleteness = (sourceId: string, libraryId: string) => (service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES ('tmdb:700', 'Scoped Show', ?, ?, '700', 1, 2, 1, 1, '[]', '[]', 50)
    `).run(sourceId, libraryId)
    insertCompleteness('src-1', 'lib-1')
    insertCompleteness('src-1', 'lib-2')
    insertCompleteness('src-1', '')
    insertCompleteness('', 'lib-1')
    insertCompleteness('', '')
    insertCompleteness('src-2', 'lib-1')

    const recoveryScopes: Array<[string, string]> = []
    service.setSeriesCompletenessInvalidationHandler((sourceId, libraryId) => {
      recoveryScopes.push([sourceId, libraryId])
    })
    const episode = service.getMediaItemByProviderId('scoped-ep', 'src-1')
    service.deleteMediaItem(episode!.id!)

    expect(recoveryScopes.sort()).toEqual([
      ['', ''],
      ['', 'lib-1'],
      ['src-1', ''],
      ['src-1', 'lib-1'],
    ])

    const remaining = (service as any).db.prepare(
      'SELECT source_id, library_id FROM series_completeness WHERE series_identity_key = ? ORDER BY source_id, library_id'
    ).all('tmdb:700') as Array<{ source_id: string; library_id: string }>
    expect(remaining).toEqual([
      { source_id: 'src-1', library_id: 'lib-2' },
      { source_id: 'src-2', library_id: 'lib-1' },
    ])
  })

  it('cleanup removes only completion caches that violate the catalogue and missing-count invariant', () => {
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'valid-cache-ep', type: 'episode', series_title: 'Valid Cache', series_tmdb_id: 701,
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'stale-cache-ep', type: 'episode', series_title: 'Stale Cache', series_tmdb_id: 702,
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'malformed-cache-ep', type: 'episode', series_title: 'Malformed Cache', series_tmdb_id: 703,
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))
    const insertCompleteness = (identity: string, title: string, tmdbId: string, total: number, owned: number, missing: string) =>
      (service as any).db.prepare(`
        INSERT INTO series_completeness (
          series_identity_key, series_title, source_id, library_id, tmdb_id,
          total_seasons, total_episodes, owned_seasons, owned_episodes,
          missing_seasons, missing_episodes, completeness_percentage
        ) VALUES (?, ?, 'src-1', 'lib-1', ?, 1, ?, 1, ?, '[]', ?, 50)
      `).run(identity, title, tmdbId, total, owned, missing)
    insertCompleteness('tmdb:701', 'Valid Cache', '701', 2, 1, '[{"season_number":1,"episode_number":2}]')
    insertCompleteness('tmdb:702', 'Stale Cache', '702', 3, 2, '[]')
    insertCompleteness('tmdb:703', 'Malformed Cache', '703', 3, 2, 'invalid-json')

    service.cleanupOrphanedMediaData()

    const remaining = (service as any).db.prepare(
      'SELECT series_identity_key FROM series_completeness ORDER BY series_identity_key'
    ).all() as Array<{ series_identity_key: string }>
    expect(remaining).toEqual([{ series_identity_key: 'tmdb:701' }])
  })

  it('queues stale cache recovery after cleanup commits', () => {
    service.upsertMediaItem(makeMediaItem({
      plex_id: 'runtime-stale-ep', type: 'episode', series_title: 'Runtime Stale', series_tmdb_id: 704,
      season_number: 1, episode_number: 1, library_id: 'lib-1',
    }))
    ;(service as any).db.prepare(`
      INSERT INTO series_completeness (
        series_identity_key, series_title, source_id, library_id, tmdb_id,
        total_seasons, total_episodes, owned_seasons, owned_episodes,
        missing_seasons, missing_episodes, completeness_percentage
      ) VALUES ('tmdb:704', 'Runtime Stale', 'src-1', 'lib-1', '704', 1, 3, 1, 2, '[]', '[]', 50)
    `).run()
    const invalidation = vi.fn(() => expect((service as any).db.inTransaction).toBe(false))
    service.setSeriesCompletenessInvalidationHandler(invalidation)

    service.cleanupOrphanedMediaData()

    expect(invalidation).toHaveBeenCalledExactlyOnceWith('src-1', 'lib-1')
  })
})

// ============================================================================
// MUSIC UPSERTS & FK CORRECTNESS
// ============================================================================
describe('BetterSQLiteService — Music', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('upsertMusicArtist returns ID via key lookup (not lastInsertRowid)', () => {
    const id1 = service.upsertMusicArtist(makeMusicArtist())
    expect(id1).toBeGreaterThan(0)
    // Update same artist — should return same ID
    const id2 = service.upsertMusicArtist(makeMusicArtist({ name: 'Updated Artist' }))
    expect(id2).toBe(id1)
  })

  it('upsertMusicAlbum links to artist via FK', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    expect(albumId).toBeGreaterThan(0)
  })

  it('upsertMusicTrack links to album and artist', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const trackId = service.upsertMusicTrack(makeMusicTrack({
      artist_id: artistId,
      album_id: albumId,
    }))
    expect(trackId).toBeGreaterThan(0)
  })

  it('finds wishlist tracks in one batched MusicBrainz lookup', () => {
    service.upsertMusicTrack(makeMusicTrack({ provider_id: 'track-1', musicbrainz_id: 'mb-1' }))
    service.upsertMusicTrack(makeMusicTrack({ provider_id: 'track-2', musicbrainz_id: 'mb-2' }))
    const matches = service.getMusicTracksByMusicbrainzIds(['mb-2', 'missing', 'mb-1'])
    expect([...matches.keys()].sort()).toEqual(['mb-1', 'mb-2'])
    expect(matches.get('mb-1')?.title).toBe('Test Track')
  })

  it('getMusicAlbums supports artistId + artistName OR logic', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId, provider_id: 'alb-1' }))
    // Insert album with different artist_id but same artist_name
    service.upsertMusicAlbum(makeMusicAlbum({
      artist_id: null, provider_id: 'alb-2', title: 'Collab Album',
    }))

    const albums = service.getMusicAlbums({ artistId, artistName: 'Test Artist' })
    expect(albums.length).toBeGreaterThanOrEqual(2)
  })

  it('getMusicStats returns correct counts', () => {
    service.upsertMusicArtist(makeMusicArtist())
    service.upsertMusicAlbum(makeMusicAlbum())
    service.upsertMusicTrack(makeMusicTrack())

    const stats = service.getMusicStats()
    expect(stats.totalArtists).toBe(1)
    expect(stats.totalAlbums).toBe(1)
    expect(stats.totalTracks).toBe(1)
  })
})

// ============================================================================
// DELETE MUSIC TRACK — CASCADE LOGIC
// ============================================================================
describe('BetterSQLiteService — deleteMusicTrack cascade', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('decrements album track_count on delete', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const t1 = service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId, provider_id: 't1' }))
    service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId, provider_id: 't2', title: 'Track 2' }))

    service.deleteMusicTrack(t1)

    const album = (service as any).db.prepare('SELECT track_count FROM music_albums WHERE id = ?').get(albumId)
    expect(album.track_count).toBe(1)
  })

  it('removes orphaned album when last track deleted', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const trackId = service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId }))

    service.deleteMusicTrack(trackId)

    const album = (service as any).db.prepare('SELECT * FROM music_albums WHERE id = ?').get(albumId)
    expect(album).toBeUndefined()
  })

  it('removes orphaned artist when last track deleted', () => {
    const artistId = service.upsertMusicArtist(makeMusicArtist())
    const albumId = service.upsertMusicAlbum(makeMusicAlbum({ artist_id: artistId }))
    const trackId = service.upsertMusicTrack(makeMusicTrack({ artist_id: artistId, album_id: albumId }))

    service.deleteMusicTrack(trackId)

    const artist = (service as any).db.prepare('SELECT * FROM music_artists WHERE id = ?').get(artistId)
    expect(artist).toBeUndefined()
  })
})

// ============================================================================
// WISHLIST
// ============================================================================
describe('BetterSQLiteService — Wishlist', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('addWishlistItem returns ID with active status', () => {
    const id = service.addWishlistItem({
      title: 'Wanted Movie',
      media_type: 'movie',
    } as any)
    expect(id).toBeGreaterThan(0)
    const items = service.getWishlistItems({})
    expect(items.some((i: any) => i.title === 'Wanted Movie' && i.status === 'active')).toBe(true)
  })

  it('getWishlistItems filters by status', () => {
    service.addWishlistItem({ title: 'Active', media_type: 'movie' } as any)
    const items = service.getWishlistItems({ status: 'active' })
    expect(items.length).toBeGreaterThanOrEqual(1)
    expect(items.every((i: any) => i.status === 'active')).toBe(true)
  })
})

// ============================================================================
// NOTIFICATIONS
// ============================================================================
describe('BetterSQLiteService — Notifications', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
  })

  it('createNotification and getNotifications round-trip', () => {
    service.createNotification({
      type: 'info',
      title: 'Test Alert',
      message: 'Something happened',
    })
    const notifications = service.getNotifications({})
    expect(notifications.some((n: any) => n.title === 'Test Alert')).toBe(true)
  })

  it('markNotificationsRead updates is_read', () => {
    service.createNotification({
      type: 'info',
      title: 'Unread',
      message: 'msg',
    })
    const all = service.getNotifications({})
    const ids = all.map((n: any) => n.id)
    service.markNotificationsRead(ids)

    const unread = service.getUnreadNotifications()
    expect(unread.filter((n: any) => n.title === 'Unread')).toHaveLength(0)
  })
})

// ============================================================================
// EXCLUSIONS
// ============================================================================
describe('BetterSQLiteService — Exclusions', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
  })

  it('addExclusion and isExcluded round-trip', () => {
    service.addExclusion('media_upgrade', '123', 'ref-key', 'parent', 'Title')
    const excluded = service.isExcluded('media_upgrade', '123', 'ref-key', 'parent')
    expect(excluded).toBe(true)
  })

  it('removeExclusion makes isExcluded return false', () => {
    service.addExclusion('collection_movie', '456', 'ref', 'parent', 'Movie')
    const exclusions = service.getExclusions('collection_movie', 'parent')
    expect(exclusions.length).toBeGreaterThan(0)

    service.removeExclusion(exclusions[0].id)
    expect(service.isExcluded('collection_movie', '456', 'ref', 'parent')).toBe(false)
  })

  it('getExclusions filters by type and parentKey', () => {
    service.addExclusion('media_upgrade', '1', 'a', 'parent1', 'T1')
    service.addExclusion('media_upgrade', '2', 'b', 'parent2', 'T2')
    service.addExclusion('collection_movie', '3', 'c', 'parent1', 'T3')

    const result = service.getExclusions('media_upgrade', 'parent1')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('T1')
  })
})

// ============================================================================
// BATCH MODE
// ============================================================================
describe('BetterSQLiteService — Batch Mode', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
  })

  it('startBatch/endBatch are reentrant', async () => {
    service.startBatch()
    service.startBatch()
    await service.endBatch()
    // Still in batch (depth = 1)
    await service.endBatch()
    // Now fully ended (depth = 0)
  })

  it('endBatch below zero does not crash', async () => {
    await service.endBatch()
    await service.endBatch()
    // Should not throw
  })
})

// ============================================================================
// RESET LIBRARY DATA
// ============================================================================
describe('BetterSQLiteService — resetLibraryData', () => {
  let service: BetterSQLiteService

  beforeEach(async () => {
    service = await createService()
    insertSource(service)
  })

  it('clears media data but preserves settings, sources, exclusions', () => {
    // Add data across categories
    service.setSetting('keep_me', 'yes')
    service.upsertMediaItem(makeMediaItem())
    service.addExclusion('media_upgrade', '1', 'ref', 'parent', 'Title')

    service.resetLibraryData()

    // Settings preserved
    expect(service.getSetting('keep_me')).toBe('yes')
    // Source preserved
    const sources = service.getMediaSources()
    expect(sources.length).toBe(1)
    // Exclusions preserved
    expect(service.isExcluded('media_upgrade', '1', 'ref', 'parent')).toBe(true)
    // Media items cleared
    expect(service.countMediaItems({})).toBe(0)
  })
})
