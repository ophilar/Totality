import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SourceManager } from '../../src/main/services/SourceManager'
import { setupTestDb, cleanupTestDb } from '../TestUtils'
import { createProvider } from '../../src/main/providers/ProviderFactory'

// Mock ProviderFactory
vi.mock('../../src/main/providers/ProviderFactory', () => ({
  createProvider: vi.fn(),
  getSupportedProviders: vi.fn().mockReturnValue(['local', 'plex']),
}))

describe('SourceManager', () => {
  let manager: SourceManager
  let db: any
  let mockProvider: any

  beforeEach(async () => {
    db = await setupTestDb()
    
    mockProvider = {
      providerType: 'local',
      testConnection: vi.fn().mockResolvedValue({ success: true }),
      getLibraries: vi.fn().mockResolvedValue([{ id: 'lib1', name: 'Lib 1', type: 'movie' }]),
      scanLibrary: vi.fn().mockResolvedValue({ success: true, itemsScanned: 10, itemsAdded: 5, itemsUpdated: 5, itemsRemoved: 0, errors: [], durationMs: 100 }),
      isAuthenticated: vi.fn().mockResolvedValue(true),
    }
    
    ;(createProvider as any).mockReturnValue(mockProvider)
    
    manager = new SourceManager({ db })
  })

  afterEach(() => {
    cleanupTestDb()
    vi.resetAllMocks()
  })

  it('should initialize and load sources from DB', async () => {
    db.sources.upsertSource({
      source_id: 's1',
      source_type: 'local',
      display_name: 'S1',
      connection_config: JSON.stringify({ folderPath: '/p1' }),
      is_enabled: 1
    })

    await manager.initialize()
    expect(createProvider).toHaveBeenCalled()
    expect(manager.getProvider('s1')).toBeDefined()
  })

  it('should add a new source', async () => {
    const config = {
      sourceType: 'local' as any,
      displayName: 'New Source',
      connectionConfig: { folderPath: '/new' },
    }

    const source = await manager.addSource(config)
    expect(source.display_name).toBe('New Source')
    expect(db.sources.getSourceById(source.source_id)).toBeDefined()
  })

  it('should remove a source and its data', async () => {
    // Mock dependencies that are usually lazy loaded
    const mockLiveMonitoring = { removeSource: vi.fn() }
    const mockTaskQueue = { removeTasksForSource: vi.fn() }
    
    manager = new SourceManager({ 
      db, 
      liveMonitoring: mockLiveMonitoring, 
      taskQueue: mockTaskQueue 
    })

    const source = await manager.addSource({
      sourceType: 'local' as any,
      displayName: 'To Remove',
      connectionConfig: { folderPath: '/tmp' }
    })

    await manager.removeSource(source.source_id)
    
    expect(db.sources.getSourceById(source.source_id)).toBeNull()
    expect(mockLiveMonitoring.removeSource).toHaveBeenCalledWith(source.source_id)
    expect(mockTaskQueue.removeTasksForSource).toHaveBeenCalledWith(source.source_id)
  })

  it('should scan a library', async () => {
    db.sources.upsertSource({
      source_id: 's1',
      source_type: 'local',
      display_name: 'S1',
      connection_config: JSON.stringify({ folderPath: '/p1' }),
      is_enabled: 1
    })
    await manager.initialize()

    const result = await manager.scanLibrary('s1', 'lib1')
    
    expect(result.success).toBe(true)
    expect(mockProvider.scanLibrary).toHaveBeenCalledWith('lib1', expect.anything())
    
    const scanTime = db.sources.getLibraryScanTime('s1', 'lib1')
    expect(scanTime).toBeDefined()
  })

  it('should handle scan cancellation', async () => {
    db.sources.upsertSource({
      source_id: 's1',
      source_type: 'local',
      display_name: 'S1',
      connection_config: JSON.stringify({ folderPath: '/p1' }),
      is_enabled: 1
    })
    await manager.initialize()

    // Simulate slow scan that calls progress
    mockProvider.scanLibrary.mockImplementation(async (_id: string, options?: { onProgress?: (p: any) => void }) => {
      // Small delay to allow stopScan to be called
      await new Promise(resolve => setTimeout(resolve, 50))
      // Trigger progress check
      if (options?.onProgress) {
        try {
          options.onProgress({ phase: 'fetching', current: 1, total: 10, percentage: 10 })
        } catch (err) {
          return { success: false, itemsScanned: 1, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [(err as Error).message], durationMs: 50 }
        }
      }
      return { success: true, itemsScanned: 10, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 100 }
    })

    const scanPromise = manager.scanLibrary('s1', 'lib1', () => {})
    
    // Give it a tiny bit of time to start the provider call
    await new Promise(resolve => setTimeout(resolve, 10))
    manager.stopScan()
    
    const result = await scanPromise
    expect(result.errors.some(e => e.includes('cancelled'))).toBe(true)
  })
})
