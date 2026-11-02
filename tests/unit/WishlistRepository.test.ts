import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WishlistRepository } from '@main/database/repositories/WishlistRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { WishlistMediaType, WishlistReason, WishlistStatus } from '@main/types/database'

describe('WishlistRepository (Real DB)', () => {
  let repo: WishlistRepository
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.wishlist
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should add and retrieve a wishlist item', async () => {
    const item = {
      media_type: WishlistMediaType.Movie,
      title: 'Wish Movie',
      reason: WishlistReason.Missing,
      priority: 5 as const,
      status: WishlistStatus.Active,
    }

    const id = await repo.add(item)
    expect(id).toBeGreaterThan(0)

    const all = await repo.getItems()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Wish Movie')
  })

  it('should delete a wishlist item', async () => {
    const id = await repo.add({ media_type: WishlistMediaType.Movie, title: 'To Delete', reason: WishlistReason.Missing, priority: 3, status: WishlistStatus.Active })
    await repo.delete(id)
    expect(await repo.getItems()).toHaveLength(0)
  })

  it('should get count', async () => {
    await repo.add({ media_type: WishlistMediaType.Movie, title: 'A', reason: WishlistReason.Missing, priority: 3, status: WishlistStatus.Active })
    await repo.add({ media_type: WishlistMediaType.Movie, title: 'B', reason: WishlistReason.Missing, priority: 3, status: WishlistStatus.Active })
    expect(await repo.getCount()).toBe(2)
  })
})
