import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TVShowFiltersSchema, MediaItemFiltersSchema, validateInput } from '@main/validation/schemas'

describe('Found Issues Verifications (No Mocks)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('verifies getDashboardSummary maps all keys to snake_case format', async () => {
    // Setup enabled source and scan
    await db.db.execute("INSERT INTO media_sources (source_id, source_type, display_name, connection_config, is_enabled, created_at, updated_at) VALUES ('s1', 'plex', 'Source 1', '{}', 1, datetime('now'), datetime('now'))")
    await db.db.execute("INSERT INTO library_scans (source_id, library_id, library_name, library_type, is_enabled, is_protected, created_at, updated_at) VALUES ('s1', 'l1', 'Movies', 'movie', 1, 0, datetime('now'), datetime('now'))")
    
    const mediaId = await db.media.upsertItem({
      source_id: 's1',
      library_id: 'l1',
      type: 'movie',
      title: 'Movie 1',
      plex_id: 'p1',
      file_path: '/path/1.mkv',
      file_size: 1000,
      duration: 120,
      poster_url: 'https://image.tmdb.org/t/p/w500/test.jpg'
    } as any)

    await db.media.upsertQualityScore({
      media_item_id: mediaId,
      quality_tier: 'SD',
      tier_quality: 'LOW',
      tier_score: 40,
      bitrate_tier_score: 40,
      audio_tier_score: 40,
      overall_score: 40,
      resolution_score: 40,
      bitrate_score: 40,
      audio_score: 40,
      efficiency_score: 50,
      storage_debt_bytes: 1000,
      needs_upgrade: true,
      is_low_quality: true,
      issues: '[]'
    })

    const summary = await db.stats.getDashboardSummary()
    expect(summary.movieUpgrades).toHaveLength(1)
    
    const upgradeItem = summary.movieUpgrades[0]
    // Verify translation maps properly for the frontend
    expect(upgradeItem.poster_url).toBe('https://image.tmdb.org/t/p/w500/test.jpg')
    expect(upgradeItem.storage_debt_bytes).toBe(1000)
    expect(upgradeItem.needs_upgrade).toBe(true)
    expect(upgradeItem.is_low_quality).toBe(true)
  })

  it('verifies TVShowFiltersSchema supports storage_debt sorting', () => {
    const input = { sortBy: 'storage_debt', sortOrder: 'asc' }
    const validated = validateInput(TVShowFiltersSchema, input, 'tvshows')
    expect(validated.sortBy).toBe('storage_debt')
  })

  it('verifies validateInput pre-processes and maps UI filter parameters to backend schema parameters', () => {
    const uiInput = {
      tier: '1080p',
      quality: 'HIGH',
      alphabet: 'A',
      search: 'avengers',
      sortBy: 'waste',
      sortOrder: 'desc'
    }
    const validated = validateInput(MediaItemFiltersSchema, uiInput, 'media')
    
    expect(validated).toHaveProperty('qualityTier', '1080p')
    expect(validated).toHaveProperty('tierQuality', 'HIGH')
    expect(validated).toHaveProperty('alphabetFilter', 'A')
    expect(validated).toHaveProperty('searchQuery', 'avengers')
    expect(validated).toHaveProperty('sortBy', 'storage_debt')
    
    expect(validated).not.toHaveProperty('tier')
    expect(validated).not.toHaveProperty('quality')
    expect(validated).not.toHaveProperty('alphabet')
    expect(validated).not.toHaveProperty('search')
  })
})
