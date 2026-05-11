/**
 * Repository Deep Dive (No Mocks)
 * 
 * Verifies the generic logic in BaseRepository using real Drizzle tables
 * and a real in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { ProviderType, MediaItemType } from '@main/types/database'
import * as schema from '@main/database/drizzleSchema'
import { eq, and } from 'drizzle-orm'

describe('BaseRepository Generic Logic', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  describe('countInternal', () => {
    it('should count items with filters correctly', async () => {
      // Setup: Add 3 items, 2 of which are movies
      await db.media.upsertItem({ source_id: 's1', plex_id: '1', title: 'Movie 1', type: MediaItemType.Movie, file_path: 'f1.mkv' } as any)
      await db.media.upsertItem({ source_id: 's1', plex_id: '2', title: 'Movie 2', type: MediaItemType.Movie, file_path: 'f2.mkv' } as any)
      await db.media.upsertItem({ source_id: 's1', plex_id: '3', title: 'Episode 1', type: MediaItemType.Episode, file_path: 'f3.mkv' } as any)

      // Using the media repo which now uses BaseRepository.countInternal
      const total = await db.media.count()
      expect(total).toBe(3)

      const moviesOnly = await db.media.count({ type: MediaItemType.Movie })
      expect(moviesOnly).toBe(2)
    })
  })

  describe('listInternal', () => {
    it('should support pagination and sorting', async () => {
      // Add items out of order
      await db.media.upsertItem({ source_id: 's1', plex_id: 'a', title: 'B Movie', type: MediaItemType.Movie, file_path: 'b.mkv' } as any)
      await db.media.upsertItem({ source_id: 's1', plex_id: 'b', title: 'A Movie', type: MediaItemType.Movie, file_path: 'a.mkv' } as any)
      await db.media.upsertItem({ source_id: 's1', plex_id: 'c', title: 'C Movie', type: MediaItemType.Movie, file_path: 'c.mkv' } as any)

      const results = await db.media.getItems({ sortBy: 'title', sortOrder: 'asc', limit: 2 })
      expect(results).toHaveLength(2)
      expect(results[0].title).toBe('A Movie')
      expect(results[1].title).toBe('B Movie')
    })
  })

  describe('reconcileStaleItems', () => {
    it('should remove items not present in the valid IDs set', async () => {
      const sourceId = 'reconcile-test'
      await db.media.upsertItem({ source_id: sourceId, plex_id: 'id1', title: 'Keep', type: MediaItemType.Movie, file_path: '1.mkv' } as any)
      await db.media.upsertItem({ source_id: sourceId, plex_id: 'id2', title: 'Remove', type: MediaItemType.Movie, file_path: '2.mkv' } as any)

      // Reconcile: only 'id1' is valid
      const removed = await db.media.removeStaleProviderItems(sourceId, '', 'movie', new Set(['id1']))
      expect(removed).toBe(1)

      const remaining = await db.media.getItems({ sourceId })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].plex_id).toBe('id1')
    })
  })

  describe('Alphabet Filtering', () => {
    it('should filter items by starting letter', async () => {
      await db.media.upsertItem({ source_id: 's1', plex_id: '1', title: 'Apple', type: MediaItemType.Movie, file_path: '1.mkv' } as any)
      await db.media.upsertItem({ source_id: 's1', plex_id: '2', title: 'Banana', type: MediaItemType.Movie, file_path: '2.mkv' } as any)

      const aItems = await db.media.getItems({ alphabetFilter: 'A' })
      expect(aItems).toHaveLength(1)
      expect(aItems[0].title).toBe('Apple')
    })

    it('should handle non-alphabetic characters via # filter', async () => {
      await db.media.upsertItem({ source_id: 's1', plex_id: '1', title: '123 Movie', type: MediaItemType.Movie, file_path: '1.mkv' } as any)
      await db.media.upsertItem({ source_id: 's1', plex_id: '2', title: 'Zebra', type: MediaItemType.Movie, file_path: '2.mkv' } as any)

      const numItems = await db.media.getItems({ alphabetFilter: '#' })
      expect(numItems).toHaveLength(1)
      expect(numItems[0].title).toBe('123 Movie')
    })
  })
})
