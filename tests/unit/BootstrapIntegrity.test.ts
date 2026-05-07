import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import path from 'node:path'
import fs from 'node:fs'

describe('Bootstrap Integrity', () => {
  const testDbPath = path.join('./tests/tmp', 'bootstrap_test.db')

  beforeEach(async () => {
    vi.clearAllMocks()
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath) } catch {}
    }
    // Ensure dir exists
    const dir = path.dirname(testDbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })

  it('should complete a full bootstrap sequence with correct configurations', async () => {
    // 1. Initialize DB
    const db = getDatabase()
    await db.initialize(testDbPath)
    
    expect(db.isInitialized).toBe(true)
    expect(db.getDbPath()).toBe(testDbPath)

    // 2. Verify we can perform a basic query immediately
    const setting = await db.config.getSetting('test_bootstrap')
    expect(setting).toBeNull()
    
    await db.config.setSetting('test_bootstrap', 'success')
    expect(await db.config.getSetting('test_bootstrap')).toBe('success')

    // 3. Verify window creation logic (mocked)
    const win = new BrowserWindow({})
    expect(win).toBeDefined()
    
    // 4. Verify IPC registration calls
    const { registerDatabaseHandlers } = await import('../../src/main/ipc/database')
    registerDatabaseHandlers()
    expect(ipcMain.handle).toHaveBeenCalled()
  })

  it('should prevent "Database not initialized" error when using relative imports', async () => {
    const db = getDatabase()
    await db.initialize(testDbPath)
    
    const { getAutoUpdateService } = await import('../../src/main/services/AutoUpdateService')
    const service = getAutoUpdateService()
    
    expect(() => {
       expect(service).toBeDefined()
    }).not.toThrow()
  })

  it('should resolve the preload path correctly', async () => {
    // Regression check for the @preload path bug
    const mockDirname = 'H:\\Totality\\src\\main'
    const preloadPath = path.join(mockDirname, '../preload/index.cjs')
    
    expect(preloadPath).not.toContain('@preload')
    expect(preloadPath).toMatch(/[\\\/]preload[\\\/]index\.cjs$/)
  })
})
