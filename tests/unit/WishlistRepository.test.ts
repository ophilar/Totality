import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { WishlistRepository } from '../../src/main/database/repositories/WishlistRepository'
import { runMigrations } from '../../src/main/database/DatabaseMigration'

describe('WishlistRepository', () => {
  let db: Database.Database
  let repo: WishlistRepository

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    repo = new WishlistRepository(db)
  })

  it('should add and retrieve wishlist items', () => {
    repo.add({
      title: 'The Matrix',
      media_type: 'movie',
      status: 'active',
      reason: 'missing',
      tmdb_id: '603'
    })

    const items = repo.getWishlistItems()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('The Matrix')
  })

  it('should filter items by media type', () => {
    repo.add({ title: 'Movie', media_type: 'movie' })
    repo.add({ title: 'Episode', media_type: 'episode' })

    const movies = repo.getWishlistItems({ mediaType: 'movie' })
    expect(movies).toHaveLength(1)
    expect(movies[0].media_type).toBe('movie')
  })

  it('should find item by TMDB ID', () => {
    repo.add({ title: 'Matrix', media_type: 'movie', tmdb_id: '603' })
    const item = repo.getWishlistItemByTmdbId('603')
    expect(item).not.toBeNull()
    expect(item!.title).toBe('Matrix')
  })
})
