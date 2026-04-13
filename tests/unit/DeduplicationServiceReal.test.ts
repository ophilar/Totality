import { describe, it, expect, beforeEach } from 'vitest'
import { getDeduplicationService, DeduplicationService } from '../../src/main/services/DeduplicationService'
import { getBetterSQLiteService, resetBetterSQLiteServiceForTesting } from '../../src/main/database/BetterSQLiteService'

describe('DeduplicationService (No Mocks)', () => {
  let db: any
  let service: DeduplicationService

  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    
    // Ensure we use in-memory DB for tests
    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'
    
    db = getBetterSQLiteService()
    db.initialize()
    
    service = getDeduplicationService()
  })

  // Helper to create a valid MediaItem with all mandatory fields
  const createValidItem = (overrides: any) => ({
    source_id: 'src1',
    source_type: 'local',
    plex_id: 'default-plex-id',
    title: 'Default Title',
    type: 'movie',
    file_path: '/default/path.mkv',
    file_size: 1000000,
    duration: 120,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    video_bitrate: 5000,
    audio_codec: 'ac3',
    audio_channels: 6,
    audio_bitrate: 640,
    ...overrides
  })

  it('should scan and detect movie duplicates by TMDB ID', async () => {
    db.sources.upsertSource({ source_id: 'src1', source_type: 'local', display_name: 'S1', is_enabled: 1 })
    
    const id1 = db.media.upsertItem(createValidItem({
      plex_id: 'p1',
      title: 'Fight Club',
      tmdb_id: '550',
      file_path: '/path/fight_club_1080p.mkv',
      resolution: '1080p',
      video_bitrate: 5000
    }))
    
    const id2 = db.media.upsertItem(createValidItem({
      plex_id: 'p2',
      title: 'Fight Club (4K)',
      tmdb_id: '550',
      file_path: '/path/fight_club_4k.mkv',
      resolution: '4K',
      video_bitrate: 25000,
      width: 3840,
      height: 2160
    }))

    db.media.upsertItem(createValidItem({
      plex_id: 'p3',
      title: 'The Matrix',
      tmdb_id: '603'
    }))

    const count = await service.scanForDuplicates('src1')
    expect(count).toBe(1)
    
    const duplicates = db.duplicates.getPendingDuplicates('src1')
    expect(duplicates).toHaveLength(1)
    expect(JSON.parse(duplicates[0].media_item_ids)).toContain(id1)
    expect(JSON.parse(duplicates[0].media_item_ids)).toContain(id2)
  })

  it('should scan and detect episode duplicates', async () => {
    db.sources.upsertSource({ source_id: 'src1', source_type: 'local', display_name: 'S1', is_enabled: 1 })
    
    const id1 = db.media.upsertItem(createValidItem({
      plex_id: 'e1',
      title: 'Breaking Bad - S01E01',
      type: 'episode',
      series_tmdb_id: '1396',
      season_number: 1,
      episode_number: 1
    }))
    
    const id2 = db.media.upsertItem(createValidItem({
      plex_id: 'e2',
      title: 'Pilot',
      type: 'episode',
      series_tmdb_id: '1396',
      season_number: 1,
      episode_number: 1
    }))

    await service.scanForDuplicates('src1')
    const duplicates = db.duplicates.getPendingDuplicates('src1')
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].external_id).toBe('1396:S1E1')
  })

  it('should recommend retention based on scoring policy', () => {
    const id1 = db.media.upsertItem(createValidItem({
      plex_id: 'q1',
      resolution: 'SD',
      video_bitrate: 1500,
      original_language: 'en',
      audio_language: 'en'
    }))
    
    const id2 = db.media.upsertItem(createValidItem({
      plex_id: 'q2',
      resolution: '1080p',
      video_bitrate: 8000,
      original_language: 'en',
      audio_language: 'fr'
    }))

    const id3 = db.media.upsertItem(createValidItem({
      plex_id: 'q3',
      resolution: '4K',
      video_bitrate: 20000,
      original_language: 'en',
      audio_language: 'en'
    }))

    db.setSetting('dup_policy_highest_res', 'true')
    db.setSetting('dup_policy_orig_lang', 'false')
    
    let rec = service.recommendRetention([id1, id2, id3])
    expect(rec.keep).toBe(id3)

    db.setSetting('dup_policy_orig_lang', 'true')
    rec = service.recommendRetention([id1, id2])
    expect(rec.keep).toBe(id2) // 30 (1080p) vs 25 (SD+OrigLang)
  })

  it('should resolve duplicates and mark as resolved in DB', async () => {
    db.sources.upsertSource({ source_id: 'src1', source_type: 'local', display_name: 'S1', is_enabled: 1 })
    const id1 = db.media.upsertItem(createValidItem({ plex_id: 'r1', tmdb_id: '1' }))
    const id2 = db.media.upsertItem(createValidItem({ plex_id: 'r2', tmdb_id: '1' }))
    
    await service.scanForDuplicates('src1')
    const duplicates = db.duplicates.getPendingDuplicates('src1')
    const dupId = duplicates[0].id!

    await service.resolveDuplicate(dupId, id2, false)

    const resolved = (db.duplicates as any).getById(dupId)
    expect(resolved.status).toBe('resolved')
    expect(db.media.getItem(id1)).toBeDefined()
  })
})
