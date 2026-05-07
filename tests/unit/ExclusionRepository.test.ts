import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ExclusionRepository } from '@main/database/repositories/ExclusionRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('ExclusionRepository (Real DB)', () => {
  let repo: ExclusionRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.exclusions
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should add and check an exclusion', async () => {
    await repo.addExclusion({
      exclusion_type: 'media_upgrade',
      reference_id: 123,
      reference_key: 'key-1',
      parent_key: 'parent-1',
      title: 'Test Item'
    })
    
    const isExcluded = await repo.isExcluded('media_upgrade', 123)
    expect(isExcluded).toBe(true)
  })

  it('should get exclusions by type', async () => {
    await repo.addExclusion({ exclusion_type: 'media_upgrade', reference_id: 1, reference_key: 'k1', parent_key: 'p1', title: 'T1' })
    await repo.addExclusion({ exclusion_type: 'media_upgrade', reference_id: 2, reference_key: 'k2', parent_key: 'p1', title: 'T2' })
    await repo.addExclusion({ exclusion_type: 'series_episode', reference_id: 3, reference_key: 'k3', parent_key: 'p2', title: 'T3' })

    const upgrades = await repo.getExclusions('media_upgrade', 'p1')
    expect(upgrades).toHaveLength(2)
    expect(upgrades[0].title).toBe('T1')
  })

  it('should remove an exclusion', async () => {
    await repo.addExclusion({ exclusion_type: 'media_upgrade', reference_id: 555 })
    expect(await repo.isExcluded('media_upgrade', 555)).toBe(true)
    
    await repo.removeExclusion('media_upgrade', 555)
    expect(await repo.isExcluded('media_upgrade', 555)).toBe(false)
  })
})
