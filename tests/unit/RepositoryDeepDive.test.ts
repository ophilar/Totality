/**
 * Repository Deep Dive (No Mocks)
 * 
 * Verifies the generic logic in BaseRepository using real Drizzle tables
 * and a real in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { _ProviderType, MediaItemType } from '@main/types/database'
import type { MediaItem } from '@main/types/database'
import * as _schema from '@main/database/drizzleSchema'
import { _eq, _and } from 'drizzle-orm'

describe('BaseRepository Generic Logic', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  const mediaFixture = (item: Pick<MediaItem, 'plex_id' | 'title' | 'type' | 'file_path'> & Partial<MediaItem>): MediaItem => ({
    plex_id: item.plex_id,
    title: item.title,
    type: item.type,
    file_path: item.file_path,
    file_size: null,
    duration: null,
    resolution: null,
    width: null,
    height: null,
    video_codec: null,
    video_bitrate: null,
    audio_codec: null,
    audio_channels: null,
    audio_bitrate: null,
    ...item,
  })

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  describe('countInternal', () => {
    it('should count items with filters correctly', async () => {
      // Setup: Add 3 items, 2 of which are movies
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: '1', title: 'Movie 1', type: MediaItemType.Movie, file_path: 'f1.mkv' }))
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: '2', title: 'Movie 2', type: MediaItemType.Movie, file_path: 'f2.mkv' }))
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: '3', title: 'Episode 1', type: MediaItemType.Episode, file_path: 'f3.mkv' }))

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
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: 'a', title: 'B Movie', type: MediaItemType.Movie, file_path: 'b.mkv' }))
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: 'b', title: 'A Movie', type: MediaItemType.Movie, file_path: 'a.mkv' }))
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: 'c', title: 'C Movie', type: MediaItemType.Movie, file_path: 'c.mkv' }))

      const results = await db.media.getItems({ sortBy: 'title', sortOrder: 'asc', limit: 2 })
      expect(results).toHaveLength(2)
      expect(results[0].title).toBe('A Movie')
      expect(results[1].title).toBe('B Movie')
    })
  })

  describe('reconcileStaleItems', () => {
    it('should remove items not present in the valid IDs set', async () => {
      const sourceId = 'reconcile-test'
      // Use null for libraryId to match default storage
      await db.media.upsertItem(mediaFixture({ source_id: sourceId, plex_id: 'id1', title: 'Keep', type: MediaItemType.Movie, file_path: '1.mkv', library_id: undefined }))
      await db.media.upsertItem(mediaFixture({ source_id: sourceId, plex_id: 'id2', title: 'Remove', type: MediaItemType.Movie, file_path: '2.mkv', library_id: undefined }))

      // Reconcile: only 'id1' is valid. Pass null for libraryId.
      const removed = await db.media.removeStaleProviderItems(sourceId, null, MediaItemType.Movie, new Set(['id1']))
      expect(removed).toBe(1)

      const remaining = await db.media.getItems({ sourceId, includeDisabledLibraries: true })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].plex_id).toBe('id1')
    })
  })

  describe('Alphabet Filtering', () => {
    it('should filter items by starting letter', async () => {
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: '1', title: 'Apple', type: MediaItemType.Movie, file_path: '1.mkv' }))
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: '2', title: 'Banana', type: MediaItemType.Movie, file_path: '2.mkv' }))

      const aItems = await db.media.getItems({ alphabetFilter: 'A' })
      expect(aItems).toHaveLength(1)
      expect(aItems[0].title).toBe('Apple')
    })

    it('should handle non-alphabetic characters via # filter', async () => {
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: '1', title: '123 Movie', type: MediaItemType.Movie, file_path: '1.mkv' }))
      await db.media.upsertItem(mediaFixture({ source_id: 's1', plex_id: '2', title: 'Zebra', type: MediaItemType.Movie, file_path: '2.mkv' }))

      const numItems = await db.media.getItems({ alphabetFilter: '#' })
      expect(numItems).toHaveLength(1)
      expect(numItems[0].title).toBe('123 Movie')
    })
  })
})
