import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeduplicationService } from '../../src/main/services/DeduplicationService'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('DeduplicationService (Real DB)', () => {
  let service: DeduplicationService
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    service = new DeduplicationService()
    
    // Setup sources and data
    db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should detect duplicates by TMDB ID', async () => {
    const id1 = db.media.upsertItem({ source_id: 's1', plex_id: 'p1', tmdb_id: '100', title: 'Movie A', type: 'movie', file_path: '/p1', resolution: '1080p' } as any)
    const id2 = db.media.upsertItem({ source_id: 's1', plex_id: 'p2', tmdb_id: '100', title: 'Movie A', type: 'movie', file_path: '/p2', resolution: '4K' } as any)

    await service.scanForDuplicates('s1')

    const duplicates = db.duplicates.getPendingDuplicates('s1')
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].external_id).toBe('100')
  })

  it('should resolve duplicates by merging versions', async () => {
    const id1 = db.media.upsertItem({ source_id: 's1', plex_id: 'p1', tmdb_id: '200', title: 'Movie B', type: 'movie', file_path: '/p1', resolution: '1080p' } as any)
    const id2 = db.media.upsertItem({ source_id: 's1', plex_id: 'p2', tmdb_id: '200', title: 'Movie B', type: 'movie', file_path: '/p2', resolution: '4K' } as any)

    await service.scanForDuplicates('s1')
    const duplicates = db.duplicates.getPendingDuplicates('s1')
    const dupId = duplicates[0].id!

    // Resolve: keep id2 (4K) as primary
    await service.resolveDuplicate(dupId, id2, false)

    const resolved = db.duplicates.getById(dupId)
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolution_strategy).toBe('kept_canonical')
    
    // Check if item2 exists
    const item2 = db.media.getItem(id2)
    expect(item2).toBeDefined()
  })
})
