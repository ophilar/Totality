import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DuplicateRepository, MediaDuplicate } from '@main/database/repositories/DuplicateRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('DuplicateRepository (Real DB)', () => {
  let repo: DuplicateRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.duplicates
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should upsert and retrieve pending duplicates', async () => {
    const dup: MediaDuplicate = {
      source_id: 'src-1',
      external_id: 'tmdb-123',
      external_type: 'tmdb_movie',
      media_item_ids: JSON.stringify(['1', '2']),
      status: 'pending'
    }

    await repo.upsertDuplicate(dup)
    
    const pending = await repo.getPendingDuplicates('src-1')
    expect(pending).toHaveLength(1)
    expect(pending[0].external_id).toBe('tmdb-123')
    expect(JSON.parse(pending[0].media_item_ids)).toContain('1')
  })

  it('should resolve a duplicate', async () => {
    const dup: MediaDuplicate = {
      source_id: 'src-1',
      external_id: 'tmdb-456',
      external_type: 'tmdb_movie',
      media_item_ids: JSON.stringify(['3', '4']),
      status: 'pending'
    }

    await repo.upsertDuplicate(dup)
    const pendingBefore = await repo.getPendingDuplicates()
    const id = pendingBefore.find(d => d.external_id === 'tmdb-456')?.id
    
    expect(id).toBeDefined()
    await repo.resolveDuplicate(id!, 'keep_highest_quality')
    
    const pendingAfter = await repo.getPendingDuplicates()
    expect(pendingAfter.some(d => d.external_id === 'tmdb-456')).toBe(false)
    
    // Verify it's still in the DB but resolved
    const all = await db.db.execute('SELECT * FROM media_item_duplicates WHERE id = ?', [id])
    expect(all.rows[0].status).toBe('resolved')
    expect(all.rows[0].resolution_strategy).toBe('keep_highest_quality')
  })

  it('should reset status to pending on upsert if already resolved', async () => {
    const dup: MediaDuplicate = {
      source_id: 'src-1',
      external_id: 'tmdb-789',
      external_type: 'tmdb_movie',
      media_item_ids: JSON.stringify(['5', '6']),
      status: 'pending'
    }

    await repo.upsertDuplicate(dup)
    const pending = await repo.getPendingDuplicates()
    const id = pending.find(d => d.external_id === 'tmdb-789')?.id
    
    await repo.resolveDuplicate(id!, 'manual')
    
    // Re-upsert same duplicate
    await repo.upsertDuplicate({ ...dup, media_item_ids: JSON.stringify(['5', '6', '7']) })
    
    const pendingAgain = await repo.getPendingDuplicates()
    expect(pendingAgain.some(d => d.external_id === 'tmdb-789')).toBe(true)
  })
})
