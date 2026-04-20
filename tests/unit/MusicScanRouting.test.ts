import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SourceManager } from '../../src/main/services/SourceManager'
import { LocalFolderProvider } from '../../src/main/providers/local/LocalFolderProvider'
import { setupTestDb, cleanupTestDb } from '../TestUtils'

describe('Music Scan Routing', () => {
  let manager: SourceManager
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    
    manager = new SourceManager({
      db,
      logging: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), verbose: vi.fn() }
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should call scanLibrary on provider when scanLibrary is called on manager', async () => {
    // Add a local source
    const source = await manager.addSource({
      sourceType: 'local',
      displayName: 'Local Music',
      connectionConfig: { path: '/tmp/music' }
    })
    
    // Enable a music library
    db.sources.setLibrariesEnabled(source.source_id, [{ id: 'music', name: 'Music', type: 'music', enabled: true }])

    // Mock the provider's scanLibrary method
    const provider = (manager as any).providers.get(source.source_id)
    const scanSpy = vi.spyOn(provider, 'scanLibrary').mockResolvedValue({
      success: true,
      itemsScanned: 10,
      itemsAdded: 5,
      itemsUpdated: 5,
      itemsRemoved: 0,
      errors: [],
      durationMs: 100
    })

    await manager.scanLibrary(source.source_id, 'music')

    expect(scanSpy).toHaveBeenCalledWith('music', expect.anything())
  })
})
