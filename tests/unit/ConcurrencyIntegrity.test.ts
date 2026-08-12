import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, createTempDir } from '@tests/TestUtils'
import { SourceManager } from '@main/services/SourceManager'
import { getLiveMonitoringService } from '@main/services/LiveMonitoringService'
import type { ScanOptions } from '@main/providers/base/MediaProvider'
import type { BetterSQLiteService } from '@main/database/BetterSQLiteService'

type TestDatabase = Awaited<ReturnType<typeof setupTestDb>>
type ScannerState = { activeScans: number; scanCancelled: boolean }
type TestProvider = { scanLibrary: (id: string, options?: ScanOptions) => Promise<unknown> }
type SourceManagerInternals = SourceManager & {
  providers: Map<string, TestProvider>
  getScanner: () => ScannerState
  getLiveMonitoring: () => { sendToRenderer: (...args: unknown[]) => void }
}
type MonitoringInternals = ReturnType<typeof getLiveMonitoringService> & { shouldPause: () => boolean }

describe('Concurrency and Scan State Integrity', () => {
  let db: TestDatabase
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
    it('should have busy_timeout configured in the DB', async () => {
       const result = await db.db.execute('PRAGMA busy_timeout')
       expect(result.rows[0].timeout).toBe(5000)
    })

    it('should have WAL mode enabled', async () => {
       const result = await db.db.execute('PRAGMA journal_mode')
       expect(String(result.rows[0].journal_mode).toLowerCase()).toBe('wal')
    })

    it('should have synchronous mode set to NORMAL', async () => {
       const result = await db.db.execute('PRAGMA synchronous')
       expect(result.rows[0].synchronous).toBe(1)
    })
  })

  describe('SourceManager activeScans Counter', () => {
    it('should correctly track multiple concurrent scans', async () => {
      const manager = new SourceManager({ db })
      await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'L1', connection_config: JSON.stringify({ folderPath: tempDir.path }), is_enabled: 1 })
      await manager.initialize()
      
      const internals = manager as unknown as SourceManagerInternals
      const provider = internals.providers.get('s1')
      provider.scanLibrary = async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return { success: true, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
      }

      const scan1 = manager.scanLibrary('s1', 'movie')
      expect(manager.isScanInProgress()).toBe(true)
      expect(internals.getScanner().activeScans).toBe(1)
      
      const scan2 = manager.scanLibrary('s1', 'tvshows')
      expect(internals.getScanner().activeScans).toBe(2)
      
      await Promise.all([scan1, scan2])
      expect(manager.isScanInProgress()).toBe(false)
      expect(internals.getScanner().activeScans).toBe(0)
    })

    it('should correctly track activeScans during scanAllSources', async () => {
      const manager = new SourceManager({ db })
      await manager.initialize()
      await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'L1', connection_config: JSON.stringify({ folderPath: tempDir.path }), is_enabled: 1 })

      const promise = manager.scanAllSources()
      expect(manager.isScanInProgress()).toBe(true)
      expect((manager as unknown as SourceManagerInternals).getScanner().activeScans).toBe(1)
      
      await promise
      expect(manager.isScanInProgress()).toBe(false)
      expect((manager as unknown as SourceManagerInternals).getScanner().activeScans).toBe(0)
    })

    it('should send throttled library:updated events during scan', async () => {
      const manager = new SourceManager({ db })
      await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'L1', connection_config: JSON.stringify({ folderPath: tempDir.path }), is_enabled: 1 })
      await manager.initialize()

      const monitoring = (manager as unknown as SourceManagerInternals).getLiveMonitoring()
      const sendSpy = vi.spyOn(monitoring, 'sendToRenderer')

      const provider = (manager as unknown as SourceManagerInternals).providers.get('s1')
      provider!.scanLibrary = async (_id: string, options?: ScanOptions) => {
        if (!options?.onProgress) throw new Error('Test scan requires progress callback')
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
       const scanner = (manager as unknown as SourceManagerInternals).getScanner()
       
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
      const scanner = (manager as unknown as SourceManagerInternals).getScanner()
      
      scanner.activeScans = 0
      expect((monitoring as unknown as MonitoringInternals).shouldPause()).toBe(false)
      
      scanner.activeScans = 1
      expect((monitoring as unknown as MonitoringInternals).shouldPause()).toBe(true)
      
      scanner.activeScans = 0
      expect((monitoring as unknown as MonitoringInternals).shouldPause()).toBe(false)
    })
  })
})



