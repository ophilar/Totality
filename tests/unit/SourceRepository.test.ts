import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { SourceRepository } from '../../src/main/database/repositories/SourceRepository'
import { runMigrations } from '../../src/main/database/DatabaseMigration'

describe('SourceRepository', () => {
  let db: Database.Database
  let repo: SourceRepository

  beforeEach(() => {
    db = new Database(':memory:')
    runMigrations(db)
    repo = new SourceRepository(db)
  })

  it('should upsert and retrieve a source', () => {
    const sourceId = 'src-1'
    repo.upsertMediaSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'Test Plex',
      connection_config: '{}',
      is_enabled: true,
    })

    const source = repo.getMediaSourceById(sourceId)
    expect(source).not.toBeNull()
    expect(source!.display_name).toBe('Test Plex')
  })

  it('should update existing source on conflict', () => {
    const sourceId = 'src-1'
    repo.upsertMediaSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'Old Name',
      connection_config: '{}',
      is_enabled: true,
    })

    repo.upsertMediaSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'New Name',
      connection_config: '{}',
      is_enabled: true,
    })

    const source = repo.getMediaSourceById(sourceId)
    expect(source!.display_name).toBe('New Name')
  })

  it('should delete a source', () => {
    const sourceId = 'src-1'
    repo.upsertMediaSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'Test',
      connection_config: '{}',
      is_enabled: true,
    })

    repo.deleteMediaSource(sourceId)
    expect(repo.getMediaSourceById(sourceId)).toBeNull()
  })

  it('should list all sources', () => {
    repo.upsertMediaSource({
      source_id: 'src-1',
      source_type: 'plex',
      display_name: 'A',
      connection_config: '{}',
      is_enabled: true,
    })
    repo.upsertMediaSource({
      source_id: 'src-2',
      source_type: 'jellyfin',
      display_name: 'B',
      connection_config: '{}',
      is_enabled: true,
    })

    const sources = repo.getMediaSources()
    expect(sources).toHaveLength(2)
    expect(sources[0].display_name).toBe('A')
  })
})
