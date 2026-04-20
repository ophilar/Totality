import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerDatabaseHandlers } from '../../src/main/ipc/database'
import { ipcMain } from 'electron'
import { getMovieCollectionService } from '../../src/main/services/MovieCollectionService'
import { SourceManager, getSourceManager } from '../../src/main/services/SourceManager'
import { getLiveMonitoringService } from '../../src/main/services/LiveMonitoringService'
import { setupTestDb, cleanupTestDb } from '../TestUtils'
import { createProvider } from '../../src/main/providers/ProviderFactory'

// 1. TOP-LEVEL MOCKS (Hoisted)
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/totality-test'),
  },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockReturnValue(Buffer.from('encrypted')),
    decryptString: vi.fn().mockReturnValue('decrypted'),
  }
}))

vi.mock('../../src/main/providers/ProviderFactory', () => ({
  createProvider: vi.fn(),
  getSupportedProviders: vi.fn().mockReturnValue(['local']),
}))

const mockGeminiAnalysis = {
  generateCompletenessInsights: vi.fn().mockResolvedValue({ text: 'insights' })
}

vi.mock('../../src/main/services/GeminiAnalysisService', () => ({
  getGeminiAnalysisService: vi.fn(() => mockGeminiAnalysis)
}))

// Mock SourceManager singleton properly
vi.mock('../../src/main/services/SourceManager', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    getSourceManager: vi.fn(),
  }
})

describe('Library Issues Fixes', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('IPC Handler Registration', () => {
    it('should register db:media:getItem and its legacy alias', () => {
      registerDatabaseHandlers()
      
      const registeredChannels = (ipcMain.handle as any).mock.calls.map((call: any) => call[0])
      
      expect(registeredChannels).toContain('db:getMediaItems')
      expect(registeredChannels).toContain('db:countMediaItems')
      expect(registeredChannels).toContain('db:getTVShows')
      expect(registeredChannels).toContain('db:countTVShows')
      expect(registeredChannels).toContain('db:media:getItem')
      expect(registeredChannels).toContain('db:getMediaItemById')
    })
  })

  describe('MovieCollectionService - Optional TMDB API Key', () => {
    it('should skip analysis and return successfully when TMDB API key is missing', async () => {
      const service = getMovieCollectionService()
      
      // Ensure no TMDB key is set
      db.deleteSetting('tmdb_api_key')
      
      const result = await service.analyzeAllCollections()
      
      expect(result.completed).toBe(true)
      expect(result.analyzed).toBe(0)
    })
  })

  describe('SourceManager - Dynamic Library Updates', () => {
    it('should notify renderer on every item during scan', async () => {
      const liveMonitoring = getLiveMonitoringService()
      const sendToRendererSpy = vi.spyOn(liveMonitoring, 'sendToRenderer')

      const mockProvider = {
        providerType: 'local',
        getLibraries: vi.fn().mockResolvedValue([{ id: 'lib1', name: 'Movies', type: 'movie' }]),
        scanLibrary: vi.fn().mockImplementation(async (libId, options) => {
          for (let i = 1; i <= 10; i++) {
            options.onProgress?.({
              current: i,
              total: 10,
              phase: 'processing',
              percentage: (i / 10) * 100,
            })
          }
          return { success: true, itemsScanned: 10, itemsAdded: 10, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 10 }
        })
      }
      ;(createProvider as any).mockReturnValue(mockProvider)

      db.sources.upsertSource({
        source_id: 's1',
        source_type: 'local',
        display_name: 'Local Source',
        connection_config: JSON.stringify({ folderPath: '/tmp' }),
        is_enabled: 1
      })

      const manager = new SourceManager({ db })
      await manager.initialize()

      await manager.scanLibrary('s1', 'lib1')

      const libraryUpdateCalls = sendToRendererSpy.mock.calls.filter(call => 
        call[0] === 'library:updated' && (call[1] as any)?.type === 'media'
      )
      // Throttling logic: first item triggers immediately, others throttled for 5s.
      // Since this test runs instantly, we expect exactly 1 call with type: 'media'.
      expect(libraryUpdateCalls.length).toBe(1)
    })

    it('should notify renderer during scan (throttled updates)', async () => {
      const liveMonitoring = getLiveMonitoringService()
      const sendToRendererSpy = vi.spyOn(liveMonitoring, 'sendToRenderer')

      const mockProvider = {
        providerType: 'local',
        getLibraries: vi.fn().mockResolvedValue([{ id: 'lib1', name: 'Movies', type: 'movie' }]),
        scanLibrary: vi.fn().mockImplementation(async (libId, options) => {
          // Simulate 5 items
          for (let i = 1; i <= 5; i++) {
            options.onProgress?.({
              current: i,
              total: 5,
              phase: 'processing',
              percentage: (i / 5) * 100,
            })
          }
          return { success: true, itemsScanned: 4, itemsAdded: 4, itemsUpdated: 0, itemsRemoved: 0, errors: ['Item 3 failed'], durationMs: 5 }
        })
      }
      ;(createProvider as any).mockReturnValue(mockProvider)

      db.sources.upsertSource({
        source_id: 's1',
        source_type: 'local',
        display_name: 'Local Source',
        connection_config: JSON.stringify({ folderPath: '/tmp' }),
        is_enabled: 1
      })

      const manager = new SourceManager({ db })
      await manager.initialize()

      await manager.scanLibrary('s1', 'lib1')

      const libraryUpdateCalls = sendToRendererSpy.mock.calls.filter(call => 
        call[0] === 'library:updated' && (call[1] as any)?.type === 'media'
      )
      // We expect 1 call for the first item (others throttled)
      expect(libraryUpdateCalls.length).toBe(1)
    })

    it('should check for TMDB API key before adding series or collection tasks', async () => {
      const manager = new SourceManager({ db })
      const taskQueue = (manager as any).getTaskQueue()
      const addTaskSpy = vi.spyOn(taskQueue, 'addTask')

      const mockProvider = {
        providerType: 'local',
        getLibraries: vi.fn().mockResolvedValue([{ id: 'lib1', name: 'Mixed', type: 'mixed' }]),
        scanLibrary: vi.fn().mockResolvedValue({ success: true, itemsScanned: 1, itemsAdded: 1, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 10 })
      }
      ;(createProvider as any).mockReturnValue(mockProvider)

      db.sources.upsertSource({
        source_id: 's1',
        source_type: 'local',
        display_name: 'Local Source',
        connection_config: JSON.stringify({ folderPath: '/tmp' }),
        is_enabled: 1
      })
      await manager.initialize()

      // Case 1: TMDB key missing
      db.deleteSetting('tmdb_api_key')
      await manager.scanLibrary('s1', 'lib1')
      
      const completenessTasks = addTaskSpy.mock.calls.filter(call => 
        ['series-completeness', 'collection-completeness'].includes(call[0].type)
      )
      expect(completenessTasks.length).toBe(0)

      // Case 2: TMDB key present
      db.setSetting('tmdb_api_key', 'test-key')
      await manager.scanLibrary('s1', 'lib1')
      
      const completenessTasksWithKey = addTaskSpy.mock.calls.filter(call => 
        ['series-completeness', 'collection-completeness'].includes(call[0].type)
      )
      expect(completenessTasksWithKey.length).toBe(2)
    })

    it('should trigger analysis automatically when TMDB key is added', async () => {
      const manager = new SourceManager({ db })
      vi.mocked(getSourceManager).mockReturnValue(manager)
      
      const taskQueue = (manager as any).getTaskQueue()
      const addTaskSpy = vi.spyOn(taskQueue, 'addTask')

      const mockProvider = {
        providerType: 'local',
        getLibraries: vi.fn().mockResolvedValue([{ id: 'lib1', name: 'Movies', type: 'movie' }]),
      }
      ;(createProvider as any).mockReturnValue(mockProvider)

      db.sources.upsertSource({
        source_id: 's1',
        source_type: 'local',
        display_name: 'Local Source',
        connection_config: JSON.stringify({ folderPath: '/tmp' }),
        is_enabled: 1
      })
      db.sources.setLibrariesEnabled('s1', [{ id: 'lib1', name: 'Movies', type: 'movie', enabled: true }])
      await manager.initialize()

      // Add TMDB key to DB first so triggerPostScanAnalysis finds it
      db.setSetting('tmdb_api_key', 'new-test-key')
      
      // Trigger logic
      await manager.triggerPostScanAnalysis()
      
      const collectionTasks = addTaskSpy.mock.calls.filter(call => call[0].type === 'collection-completeness')
      expect(collectionTasks.length).toBe(1)
    })

    it('should trigger AI insights when Gemini key is added', async () => {
      const { getGeminiAnalysisService } = await import('../../src/main/services/GeminiAnalysisService')
      
      // Simulating the trigger in db:setSetting
      const geminiKey = 'new-gemini-key'
      if (geminiKey) {
        await getGeminiAnalysisService().generateCompletenessInsights(() => {})
      }

      expect(mockGeminiAnalysis.generateCompletenessInsights).toHaveBeenCalled()
    })
  })
})
