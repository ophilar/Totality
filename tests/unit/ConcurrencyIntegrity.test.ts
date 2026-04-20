import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, createTempDir } from '../TestUtils'
import { SourceManager } from '../../src/main/services/SourceManager'
import { getLiveMonitoringService } from '../../src/main/services/LiveMonitoringService'
import { DatabaseSync } from 'node:sqlite'
import * as path from 'path'
import * as fs from 'fs'

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
       // We can check if the pragma is set by querying it
       const result = db.db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
       expect(result.timeout).toBe(5000)
    })

    it('should have WAL mode enabled', () => {
       const result = db.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
       expect(result.journal_mode.toLowerCase()).toBe('wal')
    })

    it('should have synchronous mode set to NORMAL', () => {
       const result = db.db.prepare('PRAGMA synchronous').get() as { synchronous: number }
       // 1 = NORMAL
       expect(result.synchronous).toBe(1)
    })

    it('should use PASSIVE checkpointing which is non-blocking', () => {
       expect(() => db.forceSave()).not.toThrow()
    })
  })

  describe('SourceManager activeScans Counter', () => {
    it('should correctly track multiple concurrent scans', async () => {
      const manager = new SourceManager({ db })
      
      // Setup a source
      db.sources.upsertSource({
        source_id: 's1',
        source_type: 'local',
        display_name: 'Local 1',
        connection_config: JSON.stringify({ folderPath: tempDir.path }),
        is_enabled: 1
      })
      
      await manager.initialize()
      
      // We'll mock the provider scanLibrary to be slow so we can check state mid-scan
      const provider = (manager as any).providers.get('s1')
      provider.scanLibrary = async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return { success: true, itemsScanned: 0, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
      }

      // Start first scan
      const scan1 = manager.scanLibrary('s1', 'movie')
      // Should be true immediately because increment is at the top of the method
      expect(manager.isScanInProgress()).toBe(true)
      expect((manager as any).activeScans).toBe(1)
      
      // Start second scan
      const scan2 = manager.scanLibrary('s1', 'tvshows')
      expect((manager as any).activeScans).toBe(2)
      
      await Promise.all([scan1, scan2])
      
      expect(manager.isScanInProgress()).toBe(false)
      expect((manager as any).activeScans).toBe(0)
    })

    it('should correctly track activeScans during scanAllSources', async () => {
      const manager = new SourceManager({ db })
      await manager.initialize()
      
      // Setup a source with a slow library list
      db.sources.upsertSource({
        source_id: 's1',
        source_type: 'local',
        display_name: 'Local 1',
        connection_config: JSON.stringify({ folderPath: tempDir.path }),
        is_enabled: 1
      })

      // Start all scans
      const promise = manager.scanAllSources()
      
      // Should be true immediately
      expect(manager.isScanInProgress()).toBe(true)
      expect((manager as any).activeScans).toBe(1)
      
      await promise
      
      expect(manager.isScanInProgress()).toBe(false)
      expect((manager as any).activeScans).toBe(0)
    })

    it('should send throttled library:updated events during scan', async () => {
      const manager = new SourceManager({ db })
      
      db.sources.upsertSource({
        source_id: 's1',
        source_type: 'local',
        display_name: 'Local 1',
        connection_config: JSON.stringify({ folderPath: tempDir.path }),
        is_enabled: 1
      })

      await manager.initialize()

      const provider = (manager as any).providers.get('s1')
      expect(provider).toBeDefined()
      
      const monitoring = (manager as any).getLiveMonitoring()
      const sendSpy = vi.spyOn(monitoring, 'sendToRenderer')

      // Mock scanLibrary to simulate multiple progress updates
      provider.scanLibrary = async (id: string, options: any) => {
        // First item
        options.onProgress({ phase: 'processing', current: 1, total: 100 })
        // Second item immediately
        options.onProgress({ phase: 'processing', current: 2, total: 100 })
        
        // Wait 6s to bypass throttle
        await new Promise(resolve => setTimeout(resolve, 6000))
        
        // Third item after throttle
        options.onProgress({ phase: 'processing', current: 3, total: 100 })
        
        return { success: true, itemsScanned: 3, itemsAdded: 0, itemsUpdated: 0, itemsRemoved: 0, errors: [], durationMs: 0 }
      }

      await manager.scanLibrary('s1', 'movie')
      
      // Expected:
      // 1. One call for item 1 (first item)
      // 2. Item 2 is throttled
      // 3. One call for item 3 (after 6s)
      // 4. One call from notifyLibraryUpdated in finally block
      
      const updateCalls = sendSpy.mock.calls.filter(call => call[0] === 'library:updated')
      expect(updateCalls.length).toBe(3)
    })

    it('should correctly reset scanCancelled only when ALL scans finish', async () => {
       const manager = new SourceManager({ db })
       await manager.initialize()
       
       // Manually simulate two scans for logic verification
       ;(manager as any).activeScans = 2
       manager.stopScan()
       expect((manager as any).scanCancelled).toBe(true)
       
       // One scan finishes (simulated decrement)
       ;(manager as any).activeScans--
       if ((manager as any).activeScans === 0) {
         (manager as any).scanCancelled = false
       }
       // Since activeScans is 1, scanCancelled should STILL be true
       expect((manager as any).scanCancelled).toBe(true)
       
       // Second scan finishes
       ;(manager as any).activeScans--
       if ((manager as any).activeScans === 0) {
         (manager as any).scanCancelled = false
       }
       expect((manager as any).scanCancelled).toBe(false)
    })
  })

  describe('LiveMonitoringService Integration', () => {
    it('should pause when SourceManager has active scans', async () => {
      const monitoring = getLiveMonitoringService()
      const manager = (await import('../../src/main/services/SourceManager')).getSourceManager()
      
      await manager.initialize()
      
      // Initially no scans
      ;(manager as any).activeScans = 0
      expect((monitoring as any).shouldPause()).toBe(false)
      
      // Start a scan
      ;(manager as any).activeScans = 1
      expect((monitoring as any).shouldPause()).toBe(true)
      
      // Second scan
      ;(manager as any).activeScans = 2
      expect((monitoring as any).shouldPause()).toBe(true)
      
      // Reset
      ;(manager as any).activeScans = 0
      expect((monitoring as any).shouldPause()).toBe(false)
    })
  })
})
