import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, createTempDir, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerSourceHandlers } from '@main/ipc/sources'
import { ProviderType, LibraryType } from '@main/types/database'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('Source Handlers Deep Coverage (No Mocks)', () => {
  let db: any
  let handlers: Map<string, Function>
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    // Manually mock window before bridge setup
    (global as any).window = {}
    
    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    handlers = bridge.handlers
    
    registerSourceHandlers()
    tempDir = createTempDir('source-handlers-coverage')
  })

  afterEach(async () => {
    delete (global as any).window
    await cleanupTestDb()
    if (tempDir) tempDir.cleanup()
  })

  describe('local:detectSubfolders', () => {
    it('should detect and categorize subfolders correctly', async () => {
      const handler = handlers.get('local:detectSubfolders')!
      
      // Setup real directory structure
      const moviesDir = path.join(tempDir.path, 'My Movies')
      const showsDir = path.join(tempDir.path, 'TV Shows')
      const musicDir = path.join(tempDir.path, 'Audio')
      const otherDir = path.join(tempDir.path, 'Misc')
      
      fs.mkdirSync(moviesDir)
      fs.mkdirSync(showsDir)
      fs.mkdirSync(musicDir)
      fs.mkdirSync(otherDir)
      fs.writeFileSync(path.join(tempDir.path, 'file.txt'), 'content')

      const result = await handler({} as any, tempDir.path)
      
      expect(result.subfolders).toHaveLength(4)
      
      const movies = result.subfolders.find((f: any) => f.name === 'My Movies')
      expect(movies.suggestedType).toBe(LibraryType.Movie)
      
      const shows = result.subfolders.find((f: any) => f.name === 'TV Shows')
      expect(shows.suggestedType).toBe(LibraryType.Show)

      const music = result.subfolders.find((f: any) => f.name === 'Audio')
      expect(music.suggestedType).toBe(LibraryType.Music)
    })

    it('should skip hidden and system folders', async () => {
      const handler = handlers.get('local:detectSubfolders')!
      fs.mkdirSync(path.join(tempDir.path, '.hidden'))
      fs.mkdirSync(path.join(tempDir.path, '@eadir'))
      
      const result = await handler({} as any, tempDir.path)
      expect(result.subfolders).toHaveLength(0)
    })
  })

  describe('sources:getLibrariesWithStatus', () => {
    it('should return libraries with their enabled status from DB', async () => {
        const handler = handlers.get('sources:getLibrariesWithStatus')!
        const sourceId = 'test-s1'
        
        await db.sources.upsertSource({ 
            source_id: sourceId, source_type: ProviderType.Local, display_name: 'S1', connection_config: JSON.stringify({ folderPath: tempDir.path }), is_enabled: 1 
        })
        await db.sources.toggleLibrary(sourceId, 'movies-id', true)
        
        const manager = (await import('@main/services/SourceManager')).getSourceManager()
        vi.spyOn(manager, 'getLibraries').mockResolvedValue([
            { id: 'movies-id', name: 'Movies', type: LibraryType.Movie },
            { id: 'new-id', name: 'New Lib', type: LibraryType.Movie }
        ])

        const result = await handler({} as any, sourceId)
        expect(result).toHaveLength(2)
        
        const existing = result.find((l: any) => l.id === 'movies-id')
        expect(existing.isEnabled).toBe(true)

        const newLib = result.find((l: any) => l.id === 'new-id')
        expect(newLib.isEnabled).toBe(true)
    })
  })
})
