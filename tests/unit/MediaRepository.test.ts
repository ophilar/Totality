import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MediaRepository } from '../../src/main/database/repositories/MediaRepository'
import { SourceRepository } from '../../src/main/database/repositories/SourceRepository'
import { setupTestDb, cleanupTestDb } from '../TestUtils'
import { MediaItem } from '../../src/main/types/database'

describe('MediaRepository (Real DB)', () => {
  let repo: MediaRepository
  let sourceRepo: SourceRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.media
    sourceRepo = db.sources

    // Setup a source
    sourceRepo.upsertSource({
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

  it('should upsert and retrieve a media item', () => {
    const item = mockItem()
    const id = repo.upsertItem(item)
    expect(id).toBeGreaterThan(0)

    const retrieved = repo.getItem(id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.title).toBe(item.title)
  })

  it('should filter items by type', () => {
    repo.upsertItem(mockItem('Movie 1'))
    const ep = mockItem('Episode 1')
    ep.type = 'episode'
    repo.upsertItem(ep)

    const movies = repo.getItems({ type: 'movie' })
    expect(movies).toHaveLength(1)
    expect(movies[0].type).toBe('movie')
  })

  it('should search items by title', () => {
    repo.upsertItem(mockItem('The Matrix'))
    repo.upsertItem(mockItem('Inception'))

    const results = repo.getItems({ searchQuery: 'Matrix' })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('The Matrix')
  })

  it('should delete a media item and its cascade data', () => {
    const id = repo.upsertItem(mockItem())
    repo.deleteItem(id)
    expect(repo.getItem(id)).toBeNull()
  })
})
