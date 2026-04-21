import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerDatabaseHandlers } from '../../src/main/ipc/database'
import { ipcMain } from 'electron'
import { getMovieCollectionService } from '../../src/main/services/MovieCollectionService'
import { SourceManager } from '../../src/main/services/SourceManager'
import { getLiveMonitoringService } from '../../src/main/services/LiveMonitoringService'
import { setupTestDb, cleanupTestDb, createTempDir } from '../TestUtils'
import * as fs from 'fs'
import * as path from 'path'

// Electron infrastructure mocks (allowed as per browser-environment exception)
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

describe('Library Issues Fixes (No Project Logic Mocks)', () => {
  let db: any
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('library-integrity')
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDb()
    tempDir.cleanup()
  })

  describe('IPC Handler Registration', () => {
    it('should register db:media:getItem and its legacy alias', () => {
      registerDatabaseHandlers()
      const registeredChannels = (ipcMain.handle as any).mock.calls.map((call: any) => call[0])
      expect(registeredChannels).toContain('db:media:getItem')
      expect(registeredChannels).toContain('db:getMediaItemById')
    })
  })

  describe('MovieCollectionService - Optional TMDB API Key', () => {
    it('should skip analysis and return successfully when TMDB API key is missing', async () => {
      const service = getMovieCollectionService()
      db.deleteSetting('tmdb_api_key')
      const result = await service.analyzeAllCollections()
      expect(result.completed).toBe(true)
      expect(result.analyzed).toBe(0)
    })
  })

  describe('SourceManager - Real Scan Integration', () => {
    it('should notify renderer during real local scan', async () => {
      const liveMonitoring = getLiveMonitoringService()
      const sendToRendererSpy = vi.spyOn(liveMonitoring, 'sendToRenderer')

      // Create real files
      const moviesDir = path.join(tempDir.path, 'Movies')
      fs.mkdirSync(moviesDir, { recursive: true })
      fs.writeFileSync(path.join(moviesDir, 'Movie (2020).mkv'), 'dummy')

      const manager = new SourceManager({ db })
      await manager.addSource({
        sourceId: 's1',
        sourceType: 'local' as any,
        displayName: 'Local',
        connectionConfig: { folderPath: tempDir.path, mediaType: 'movies' },
        isEnabled: true
      })
      await manager.initialize()

      await manager.scanLibrary('s1', 'movies')

      const libraryUpdateCalls = sendToRendererSpy.mock.calls.filter(call => 
        call[0] === 'library:updated' && (call[1] as any)?.type === 'media'
      )
      expect(libraryUpdateCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('should add completeness tasks when TMDB key is present', async () => {
      const manager = new SourceManager({ db })
      
      // Setup real local show
      const showDir = path.join(tempDir.path, 'TV', 'Show', 'Season 1')
      fs.mkdirSync(showDir, { recursive: true })
      fs.writeFileSync(path.join(showDir, 'Show S01E01.mkv'), 'dummy')

      await manager.addSource({
        sourceId: 's1',
        sourceType: 'local' as any,
        displayName: 'Local TV',
        connectionConfig: { folderPath: tempDir.path, mediaType: 'tvshows' },
        isEnabled: true
      })
      await manager.initialize()

      // Case 1: TMDB key missing
      db.deleteSetting('tmdb_api_key')
      await manager.scanLibrary('s1', 'tvshows')
      expect((manager as any).getTaskQueue().getTasks().length).toBe(0)

      // Case 2: TMDB key present
      db.setSetting('tmdb_api_key', 'test-key')
      await manager.scanLibrary('s1', 'tvshows')
      const tasks = (manager as any).getTaskQueue().getTasks()
      expect(tasks.some((t: any) => t.type === 'series-completeness')).toBe(true)
    })
  })
})
