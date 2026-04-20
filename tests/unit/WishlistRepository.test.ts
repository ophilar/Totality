import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WishlistRepository } from '../../src/main/database/repositories/WishlistRepository'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

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

  it('should add and retrieve a wishlist item', () => {
    const item = {
      media_type: 'movie',
      title: 'Wish Movie',
      reason: 'missing',
      priority: 5,
    } as any

    const id = repo.add(item)
    expect(id).toBeGreaterThan(0)

    const all = repo.getItems()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Wish Movie')
  })

  it('should delete a wishlist item', () => {
    const id = repo.add({ media_type: 'movie', title: 'To Delete' } as any)
    repo.delete(id)
    expect(repo.getItems()).toHaveLength(0)
  })

  it('should get count', () => {
    repo.add({ media_type: 'movie', title: 'A' } as any)
    repo.add({ media_type: 'movie', title: 'B' } as any)
    expect(repo.getCount()).toBe(2)
  })
})
