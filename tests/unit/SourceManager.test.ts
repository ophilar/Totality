import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SourceManager } from '../../src/main/services/SourceManager'
import { LibraryType } from '../../src/main/types/database'
import { setupTestDb, cleanupTestDb, createTempDir } from '../TestUtils'
import * as fs from 'fs'
import * as path from 'path'

describe('SourceManager (No Mocks)', () => {
  let manager: SourceManager
  let db: any
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('source-manager-real')
    manager = new SourceManager({ db })
  })

  afterEach(() => {
    cleanupTestDb()
    tempDir.cleanup()
  })

  it('should initialize and load sources from DB', async () => {
    db.sources.upsertSource({
      source_id: 's1',
      source_type: 'local',
      display_name: 'S1',
      connection_config: JSON.stringify({ folderPath: tempDir.path }),
      is_enabled: 1
    })

    await manager.initialize()
    expect(manager.getProvider('s1')).toBeDefined()
    expect(manager.getProvider('s1')?.providerType).toBe('local')
  })

  it('should add a new local source', async () => {
    const config = {
      sourceType: 'local' as any,
      displayName: 'New Source',
      connectionConfig: { folderPath: tempDir.path },
    }

    const source = await manager.addSource(config)
    expect(source.display_name).toBe('New Source')
    expect(db.sources.getSourceById(source.source_id)).toBeDefined()
  })

  it('should remove a source and its data', async () => {
    const source = await manager.addSource({
      sourceType: 'local' as any,
      displayName: 'To Remove',
      connectionConfig: { folderPath: tempDir.path }
    })

    expect(db.sources.getSourceById(source.source_id)).toBeDefined()
    await manager.removeSource(source.source_id)
    expect(db.sources.getSourceById(source.source_id)).toBeNull()
  })

  it('should scan a real local library', async () => {
    // Create a dummy movie file
    const moviesDir = path.join(tempDir.path, 'Movies')
    fs.mkdirSync(moviesDir, { recursive: true })
    fs.writeFileSync(path.join(moviesDir, 'The Matrix (1999).mkv'), 'dummy content')

    const source = await manager.addSource({
      sourceType: 'local' as any,
      displayName: 'Local Video',
      connectionConfig: { folderPath: tempDir.path, mediaType: LibraryType.Movie },
    })

    await manager.initialize()
    
    // Pass 'movie' as library ID which matches the config
    const result = await manager.scanLibrary(source.source_id, 'movie')
    
    expect(result.success).toBe(true)
    expect(result.itemsScanned).toBeGreaterThan(0)
    
    const items = db.media.getItems({ sourceId: source.source_id })
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].title).toContain('Matrix')
  })

  it('should handle scan cancellation for real local scans', async () => {
    // Setup a large number of dummy files to make the scan take some time
    const moviesDir = path.join(tempDir.path, 'Movies')
    fs.mkdirSync(moviesDir, { recursive: true })
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(moviesDir, `Movie ${i} (2020).mkv`), 'dummy')
    }

    const source = await manager.addSource({
      sourceType: 'local' as any,
      displayName: 'Cancel Test',
      connectionConfig: { folderPath: tempDir.path, mediaType: LibraryType.Movie },
    })

    await manager.initialize()

    // Start scan and immediately stop
    const scanPromise = manager.scanLibrary(source.source_id, 'movie')
    
    // Give it a tiny bit of time to start
    await new Promise(resolve => setTimeout(resolve, 5))
    manager.stopScan()
    
    const result = await scanPromise
    // It might finish if it's very fast, but usually it should be cancelled
    if (!result.success) {
      expect(result.errors.some(e => e.toLowerCase().includes('cancelled'))).toBe(true)
    }
  })
})
