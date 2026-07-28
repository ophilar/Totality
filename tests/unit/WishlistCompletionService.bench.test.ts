import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getWishlistCompletionService, WishlistCompletionService } from '@main/services/WishlistCompletionService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { WishlistStatus, WishlistMediaType, WishlistReason } from '@main/types/database'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('') },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  BrowserWindow: vi.fn(),
  safeStorage: { isEncryptionAvailable: vi.fn().mockReturnValue(false) }
}))

describe('WishlistCompletionService Performance Benchmark', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  it('benchmark season and episode items', async () => {
    const insertWishlist = []

    // Seed 2500 season wishlist items
    for (let i = 0; i < 2500; i++) {
      insertWishlist.push(
        db.wishlist.add({
          title: `Season ${i}`,
          media_type: WishlistMediaType.Season,
          status: WishlistStatus.Active,
          reason: WishlistReason.Missing,
          series_title: `Series ${i}`,
          season_number: 1
        })
      )
    }

    // Seed 2500 episode wishlist items
    for (let i = 0; i < 2500; i++) {
      insertWishlist.push(
        db.wishlist.add({
          title: `Episode ${i}`,
          media_type: WishlistMediaType.Episode,
          status: WishlistStatus.Active,
          reason: WishlistReason.Missing,
          series_title: `Series ${i}`,
          season_number: 1,
          episode_number: 1
        })
      )
    }

    await Promise.all(insertWishlist)

    const service = new WishlistCompletionService()

    const start = Date.now()
    await service.checkAndComplete()
    const end = Date.now()

    console.log(`Benchmark took: ${end - start}ms`)
  })
})
