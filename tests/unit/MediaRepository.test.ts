import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { MediaRepository } from '../../src/main/database/repositories/MediaRepository'
import { SourceRepository } from '../../src/main/database/repositories/SourceRepository'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import type { MediaItem } from '../../src/main/types/database'

describe('MediaRepository', () => {
  let db: Database.Database
  let repo: MediaRepository
  let sourceRepo: SourceRepository

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    repo = new MediaRepository(db)
    sourceRepo = new SourceRepository(db)
    
    // Setup a source
    sourceRepo.upsertMediaSource({
      source_id: 'src-1',
      source_type: 'plex',
      display_name: 'Test Plex',
      connection_config: '{}',
      is_enabled: true,
    })
  })

  const mockItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
    source_id: 'src-1',
    source_type: 'plex',
    library_id: 'lib-1',
    plex_id: '123',
    title: 'Test Movie',
    type: 'movie',
    file_path: '/path/to/movie.mkv',
    file_size: 1000,
    duration: 3600,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    video_bitrate: 5000,
    audio_codec: 'aac',
    audio_channels: 2,
    audio_bitrate: 192,
    ...overrides
  } as MediaItem)

  it('should upsert and retrieve a media item', () => {
    const id = repo.upsertItem(mockItem())
    expect(id).toBeGreaterThan(0)

    const item = repo.getItem(id)
    expect(item).not.toBeNull()
    expect(item!.title).toBe('Test Movie')
  })

  it('should filter items by type', () => {
    repo.upsertItem(mockItem({ plex_id: '1', title: 'Movie', type: 'movie' }))
    repo.upsertItem(mockItem({ plex_id: '2', title: 'Episode', type: 'episode' }))

    const movies = repo.getMediaItems({ type: 'movie' })
    expect(movies).toHaveLength(1)
    expect(movies[0].type).toBe('movie')
  })

  it('should search items by title', () => {
    repo.upsertItem(mockItem({ plex_id: '1', title: 'The Matrix' }))
    repo.upsertItem(mockItem({ plex_id: '2', title: 'Inception' }))

    const results = repo.getMediaItems({ searchQuery: 'Matrix' })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('The Matrix')
  })

  it('should delete a media item and its cascade data', () => {
    const id = repo.upsertItem(mockItem())
    repo.deleteMediaItem(id)
    expect(repo.getItem(id)).toBeNull()
  })
})
