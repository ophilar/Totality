import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { SourceRepository } from '../../src/main/database/repositories/SourceRepository'
import { runMigrations } from '../../src/main/database/DatabaseMigration'

describe('SourceRepository', () => {
  let db: Database.Database
  let repo: SourceRepository

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
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

  describe('Library Scans', () => {
    const sourceId = 'src-1'
    const libraries = [
      { id: 'lib-1', name: 'Movies', type: 'movie', enabled: true },
      { id: 'lib-2', name: 'TV', type: 'show', enabled: false },
    ]

    beforeEach(() => {
      repo.upsertMediaSource({
        source_id: sourceId,
        source_type: 'plex',
        display_name: 'Test Source',
        is_enabled: true,
      })
    })

    it('should set and retrieve library configurations', () => {
      repo.setLibrariesEnabled(sourceId, libraries)

      const sourceLibs = repo.getSourceLibraries(sourceId)
      expect(sourceLibs).toHaveLength(2)
      
      const lib1 = sourceLibs.find(l => l.libraryId === 'lib-1')
      expect(lib1.libraryName).toBe('Movies')
      expect(lib1.isEnabled).toBe(1)

      const lib2 = sourceLibs.find(l => l.libraryId === 'lib-2')
      expect(lib2.isEnabled).toBe(0)
    })

    it('should update library scan time without constraint errors', () => {
      repo.setLibrariesEnabled(sourceId, libraries)
      
      // This should NOT throw "NOT NULL constraint failed: library_scans.library_name"
      repo.updateLibraryScanTime(sourceId, 'lib-1', 150)

      const scanTime = repo.getLibraryScanTime(sourceId, 'lib-1')
      expect(scanTime).not.toBeNull()
      
      const times = repo.getLibraryScanTimes(sourceId)
      expect(times.get('lib-1').items_scanned).toBe(150)
    })

    it('should toggle library status', () => {
      repo.setLibrariesEnabled(sourceId, libraries)
      
      repo.toggleLibrary(sourceId, 'lib-1', false)
      expect(repo.isLibraryEnabled(sourceId, 'lib-1')).toBe(false)

      repo.toggleLibrary(sourceId, 'lib-1', true)
      expect(repo.isLibraryEnabled(sourceId, 'lib-1')).toBe(true)
    })

    it('should update source scan time when library is scanned', () => {
      repo.setLibrariesEnabled(sourceId, libraries)
      
      const before = repo.getSourceById(sourceId)!.last_scan_at
      
      repo.updateLibraryScanTime(sourceId, 'lib-1', 10)
      
      const after = repo.getSourceById(sourceId)!.last_scan_at
      expect(after).not.toBe(before)
    })
  })
})
