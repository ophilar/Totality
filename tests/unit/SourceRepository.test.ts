import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SourceRepository } from '@main/database/repositories/SourceRepository'
import { LibraryType } from '@main/types/database'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('SourceRepository (Real DB)', () => {
  let repo: SourceRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.sources
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should upsert and retrieve a source', async () => {
    const sourceId = 'src-1'
    await repo.upsertSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'Test Plex',
      connection_config: '{}',
      is_enabled: 1,
    })

    const retrieved = await repo.getSourceById(sourceId)
    expect(retrieved).toBeDefined()
    expect(retrieved?.display_name).toBe('Test Plex')
  })

  it('should update existing source on conflict', async () => {
    const sourceId = 'src-1'
    await repo.upsertSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'Old Name',
      connection_config: '{}',
      is_enabled: 1,
    })

    await repo.upsertSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'New Name',
      connection_config: '{}',
      is_enabled: 0,
    })

    const retrieved = await repo.getSourceById(sourceId)
    expect(retrieved?.display_name).toBe('New Name')
    expect(retrieved?.is_enabled).toBe(0)
  })

  it('should delete a source', async () => {
    const sourceId = 'src-1'
    await repo.upsertSource({ 
      source_id: sourceId, 
      source_type: 'local',
      display_name: 'To Delete', 
      connection_config: '{}',
      is_enabled: 1 
    })
    
    await repo.deleteSource(sourceId)
    
    expect(await repo.getSourceById(sourceId)).toBeNull()
  })

  it('should list all sources', async () => {
    await repo.upsertSource({ 
      source_id: 's1', 
      source_type: 'local',
      display_name: 'A', 
      connection_config: '{}',
      is_enabled: 1 
    })
    await repo.upsertSource({ 
      source_id: 's2', 
      source_type: 'local',
      display_name: 'B', 
      connection_config: '{}',
      is_enabled: 1 
    })

    const sources = await repo.getSources()
    expect(sources).toHaveLength(2)
  })

  describe('Library Scans', () => {
    const sourceId = 'src-lib-test'
    
    beforeEach(async () => {
      await repo.upsertSource({
        source_id: sourceId,
        source_type: 'plex',
        display_name: 'Library Test',
        connection_config: '{}',
        is_enabled: 1,
      })
    })

    it('should set and retrieve library configurations', async () => {
      const libs = [
        { id: 'l1', name: 'Movies', type: LibraryType.Movie, enabled: true },
        { id: 'l2', name: 'TV', type: LibraryType.Show, enabled: false }
      ]
      
      await repo.setLibrariesEnabled(sourceId, libs)
      
      const saved = await repo.getSourceLibraries(sourceId)
      expect(saved).toHaveLength(2)
      expect(saved.find(l => l.libraryId === 'l1')?.isEnabled).toBe(1)
      expect(saved.find(l => l.libraryId === 'l2')?.isEnabled).toBe(0)
    })

    it('should toggle library status', async () => {
      await repo.setLibrariesEnabled(sourceId, [{ id: 'l1', name: 'Movies', type: LibraryType.Movie, enabled: true }])
      await repo.toggleLibrary(sourceId, 'l1', false)
      
      expect(await repo.isLibraryEnabled(sourceId, 'l1')).toBe(false)
    })
  })
})



