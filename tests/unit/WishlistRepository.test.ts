import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WishlistRepository } from '@main/database/repositories/WishlistRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('WishlistRepository (Real DB)', () => {
  let repo: WishlistRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.wishlist
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should add and retrieve a wishlist item', async () => {
    const item = {
      media_type: 'movie',
      title: 'Wish Movie',
      reason: 'missing',
      priority: 5,
    } as any

    const id = await repo.add(item)
    expect(id).toBeGreaterThan(0)

    const all = await repo.getItems()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Wish Movie')
  })

  it('should delete a wishlist item', async () => {
    const id = await repo.add({ media_type: 'movie', title: 'To Delete' } as any)
    await repo.delete(id)
    expect(await repo.getItems()).toHaveLength(0)
  })

  it('should get count', async () => {
    await repo.add({ media_type: 'movie', title: 'A' } as any)
    await repo.add({ media_type: 'movie', title: 'B' } as any)
    expect(await repo.getCount()).toBe(2)
  })
})



