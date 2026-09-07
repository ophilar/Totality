import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { SourceRepository } from '@main/database/repositories/SourceRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { MediaItem } from '@main/types/database'

describe('MediaRepository (Real DB)', () => {
  let repo: MediaRepository
  let sourceRepo: SourceRepository
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.media
    sourceRepo = db.sources

    // Setup a source
    await sourceRepo.upsertSource({
      source_id: 'src-1',
      source_type: 'plex',
      display_name: 'Test Source',
      connection_config: '{}',
      is_enabled: 1,
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const mockItem = (title = 'Test Movie'): MediaItem => ({
    source_id: 'src-1',
    source_type: 'plex',
    plex_id: `p-${Math.random()}`,
    title,
    type: 'movie',
    file_path: `/path/to/${title}.mkv`,
    resolution: '1080p',
  })

  const mockVersion = (filePath: string) => ({
    version_source: filePath,
    file_path: filePath,
    file_size: 100,
    duration: 1000,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    video_bitrate: 100,
    audio_codec: 'aac',
    audio_channels: 2,
    audio_bitrate: 100,
  })

  it('should upsert and retrieve a media item', async () => {
    const item = mockItem()
    const id = await repo.upsertItem(item)
    expect(id).toBeGreaterThan(0)

    const retrieved = await repo.getItem(id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe(item.title)
  })

  it('should filter items by type', async () => {
    await repo.upsertItem(mockItem('Movie 1'))
    const ep = mockItem('Episode 1')
    ep.type = 'episode'
    await repo.upsertItem(ep)

    const movies = await repo.getItems({ type: 'movie' })
    expect(movies).toHaveLength(1)
    expect(movies[0].type).toBe('movie')
  })

  it('should search items by title', async () => {
    await repo.upsertItem(mockItem('The Matrix'))
    await repo.upsertItem(mockItem('Inception'))

    const results = await repo.getItems({ searchQuery: 'Matrix' })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('The Matrix')
  })

  it('uses media identity as the descending pagination tie-breaker', async () => {
    const ids: number[] = []
    for (let index = 1; index <= 4; index += 1) {
      ids.push(await repo.upsertItem({
        source_id: 'src-1',
        source_type: 'plex',
        plex_id: `same-title-${index}`,
        title: 'Same Title',
        type: 'movie',
        file_path: `/path/to/same-title-${index}.mkv`,
      }))
    }

    const firstPage = await repo.getItems({ type: 'movie', sortBy: 'title', sortOrder: 'desc', limit: 2, offset: 0 })
    const secondPage = await repo.getItems({ type: 'movie', sortBy: 'title', sortOrder: 'desc', limit: 2, offset: 2 })

    expect([...firstPage, ...secondPage].map(item => item.id)).toEqual([...ids].sort((a, b) => b - a))
  })

  it('includes calculated estimated recoverable debt in optimization summaries', async () => {
    const id = await repo.upsertItem({ ...mockItem('Recoverable Movie'), file_size: 4_000_000_000 })
    await repo.upsertQualityScore({
      media_item_id: id,
      quality_tier: '1080p',
      tier_quality: 'HIGH',
      tier_score: 80,
      bitrate_tier_score: 80,
      audio_tier_score: 80,
      overall_score: 80,
      resolution_score: 80,
      bitrate_score: 80,
      audio_score: 80,
      efficiency_score: 80,
      storage_debt_bytes: 750_000_000,
      evidence_status: 'estimated',
      confidence: 'medium',
      savings_basis: 'insufficient_data',
      is_low_quality: false,
      needs_upgrade: false,
      issues: '[]',
    })

    const summary = await repo.getOptimizationMetricsSummary({ type: 'movie' })

    expect(summary.recoverableWasteBytes).toBe(750_000_000)
    expect(summary.recoverableBytes).toBe(750_000_000)
    expect(summary.evidenceStatus).toBe('estimated')
  })

  it('should delete a media item and its cascade data', async () => {
    const id = await repo.upsertItem(mockItem())
    await repo.deleteItem(id)
    expect(await repo.getItem(id)).toBeNull()
  })

  it('should merge a movie version without removing sibling versions', async () => {
    const id = await repo.upsertItem(mockItem())
    await repo.syncItemVersions(id, [mockVersion('/movie-a.mkv')])
    await repo.mergeItemVersion(id, mockVersion('/movie-b.mkv'))

    expect((await repo.getItemVersions(id)).map(item => item.file_path)).toEqual([
      '/movie-a.mkv',
      '/movie-b.mkv',
    ])
  })

  it('should remove only movie versions absent from the valid path set', async () => {
    const id = await repo.upsertItem(mockItem())
    await repo.syncItemVersions(id, [mockVersion('/movie-a.mkv'), mockVersion('/movie-b.mkv')])
    expect(await repo.removeStaleItemVersions(id, new Set(['/movie-a.mkv']))).toBe(1)
    expect((await repo.getItemVersions(id)).map(item => item.file_path)).toEqual(['/movie-a.mkv'])
  })

  it('should persist deep analysis for every episode sharing a normalized file path', async () => {
    const first = mockItem('Episode 1')
    first.type = 'episode'
    first.file_path = 'C:\\Shows\\Season 1\\Episodes.mkv'
    const second = mockItem('Episode 2')
    second.type = 'episode'
    second.file_path = 'C:/Shows/Season 1/Episodes.mkv'

    await repo.upsertItem(first)
    await repo.upsertItem(second)
    await repo.updateDeepAnalysisByPath('C:/Shows/Season 1/Episodes.mkv', { streams: 3 }, '2026-09-02T00:00:00.000Z')

    const items = await repo.getItems({ type: 'episode' })
    expect(items).toHaveLength(2)
    expect(items.map(item => item.deep_analysis)).toEqual(['{"streams":3}', '{"streams":3}'])
    expect(items.map(item => item.deep_analysis_at)).toEqual([
      '2026-09-02T00:00:00.000Z',
      '2026-09-02T00:00:00.000Z',
    ])
  })
})
