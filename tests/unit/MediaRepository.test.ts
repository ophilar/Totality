import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { SourceRepository } from '@main/database/repositories/SourceRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { MediaItem } from '@main/types/database'

describe('MediaRepository (Real DB)', () => {
  let repo: MediaRepository
  let sourceRepo: SourceRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.media
    sourceRepo = db.sources

    // Setup a source
    await sourceRepo.upsertSource({
      source_id: 'src-1',
      source_type: 'plex',
      display_name: 'Test Source',
      connection_config: '{}',
      is_enabled: 1,
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const mockItem = (title = 'Test Movie'): MediaItem => ({
    source_id: 'src-1',
    source_type: 'plex',
    plex_id: `p-${Math.random()}`,
    title,
    type: 'movie',
    file_path: `/path/to/${title}.mkv`,
    resolution: '1080p',
  } as any)

  it('should upsert and retrieve a media item', async () => {
    const item = mockItem()
    const id = await repo.upsertItem(item)
    expect(id).toBeGreaterThan(0)

    const retrieved = await repo.getItem(id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe(item.title)
  })

  it('should filter items by type', async () => {
    await repo.upsertItem(mockItem('Movie 1'))
    const ep = mockItem('Episode 1')
    ep.type = 'episode'
    await repo.upsertItem(ep)

    const movies = await repo.getItems({ type: 'movie' })
    expect(movies).toHaveLength(1)
    expect(movies[0].type).toBe('movie')
  })

  it('should search items by title', async () => {
    await repo.upsertItem(mockItem('The Matrix'))
    await repo.upsertItem(mockItem('Inception'))

    const results = await repo.getItems({ searchQuery: 'Matrix' })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('The Matrix')
  })

  it('should delete a media item and its cascade data', async () => {
    const id = await repo.upsertItem(mockItem())
    await repo.deleteItem(id)
    expect(await repo.getItem(id)).toBeNull()
  })
})



