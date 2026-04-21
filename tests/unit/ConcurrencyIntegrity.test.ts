import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, createTempDir } from '../TestUtils'
import { SourceManager } from '../../src/main/services/SourceManager'
import { getLiveMonitoringService } from '../../src/main/services/LiveMonitoringService'

describe('Concurrency and Scan State Integrity', () => {
  let db: any
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('concurrency-test')
  })

  afterEach(() => {
    cleanupTestDb()
    tempDir.cleanup()
  })

  describe('SQLite Concurrency Config', () => {
    it('should have busy_timeout configured in the DB', () => {
       const result = db.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
       expect(result.timeout).toBe(5000)
    })

    it('should have WAL mode enabled', () => {
       const result = db.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
       expect(result.journal_mode.toLowerCase()).toBe('wal')
    })

    it('should have synchronous mode set to NORMAL', () => {
       const result = db.db.prepare('PRAGMA synchronous').get() as { synchronous: number }
       expect(result.synchronous).toBe(1)
    })
  })

  describe('SourceManager activeScans Counter', () => {
    it('should correctly track multiple concurrent scans', async () => {
      const manager = new SourceManager({ db })
      db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'L1', connection_config: JSON.stringify({ folderPath: tempDir.path }), is_enabled: 1 })
      await manager.initialize()
      
      const provider = (manager as any).providers.get('s1')
      provider.scanLibrary = async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return { success: true, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
      }

      const scan1 = manager.scanLibrary('s1', 'movie')
      expect(manager.isScanInProgress()).toBe(true)
      expect((manager as any).getScanner().activeScans).toBe(1)
      
      const scan2 = manager.scanLibrary('s1', 'tvshows')
      expect((manager as any).getScanner().activeScans).toBe(2)
      
      await Promise.all([scan1, scan2])
      expect(manager.isScanInProgress()).toBe(false)
      expect((manager as any).getScanner().activeScans).toBe(0)
    })

    it('should correctly track activeScans during scanAllSources', async () => {
      const manager = new SourceManager({ db })
      await manager.initialize()
      db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'L1', connection_config: JSON.stringify({ folderPath: tempDir.path }), is_enabled: 1 })

      const promise = manager.scanAllSources()
      expect(manager.isScanInProgress()).toBe(true)
      expect((manager as any).getScanner().activeScans).toBe(1)
      
      await promise
      expect(manager.isScanInProgress()).toBe(false)
      expect((manager as any).getScanner().activeScans).toBe(0)
    })

    it('should send throttled library:updated events during scan', async () => {
      const manager = new SourceManager({ db })
      db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'L1', connection_config: JSON.stringify({ folderPath: tempDir.path }), is_enabled: 1 })
      await manager.initialize()

      const monitoring = (manager as any).getLiveMonitoring()
      const sendSpy = vi.spyOn(monitoring, 'sendToRenderer')

      const provider = (manager as any).providers.get('s1')
      provider.scanLibrary = async (_id: string, options: any) => {
        options.onProgress({ phase: 'processing', current: 1, total: 100 })
        options.onProgress({ phase: 'processing', current: 2, total: 100 })
        await new Promise(resolve => setTimeout(resolve, 6000))
        options.onProgress({ phase: 'processing', current: 3, total: 100 })
        return { success: true, itemsScanned: 3, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
      }

      await manager.scanLibrary('s1', 'movie')
      const updateCalls = sendSpy.mock.calls.filter(call => call[0] === 'library:updated')
      expect(updateCalls.length).toBeGreaterThanOrEqual(3)
    })

    it('should correctly reset scanCancelled only when ALL scans finish', async () => {
       const manager = new SourceManager({ db })
       await manager.initialize()
       const scanner = (manager as any).getScanner()
       
       scanner.activeScans = 2
       manager.stopScan()
       expect(scanner.scanCancelled).toBe(true)
       
       scanner.activeScans--
       if (scanner.activeScans === 0) scanner.scanCancelled = false
       expect(scanner.scanCancelled).toBe(true)
       
       scanner.activeScans--
       if (scanner.activeScans === 0) scanner.scanCancelled = false
       expect(scanner.scanCancelled).toBe(false)
    })
  })

  describe('LiveMonitoringService Integration', () => {
    it('should pause when SourceManager has active scans', async () => {
      const monitoring = getLiveMonitoringService()
      const manager = (await import('../../src/main/services/SourceManager')).getSourceManager()
      await manager.initialize()
      const scanner = (manager as any).getScanner()
      
      scanner.activeScans = 0
      expect((monitoring as any).shouldPause()).toBe(false)
      
      scanner.activeScans = 1
      expect((monitoring as any).shouldPause()).toBe(true)
      
      scanner.activeScans = 0
      expect((monitoring as any).shouldPause()).toBe(false)
    })
  })
})
