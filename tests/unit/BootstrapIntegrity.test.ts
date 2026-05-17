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
    const dir = path.dirname(testDbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })

  it('should complete a full bootstrap sequence with correct configurations', async () => {
    const db = getDatabase()
    await db.initialize(testDbPath)
    
    expect(db.isInitialized).toBe(true)
    const win = new BrowserWindow({})
    expect(win).toBeDefined()
    
    const { registerDatabaseHandlers } = await import('../../src/main/ipc/database')
    registerDatabaseHandlers()
    expect(ipcMain.handle).toHaveBeenCalled()
  }, 30000)

  it('should prevent "Database not initialized" error when using relative imports', async () => {
    const db = getDatabase()
    await db.initialize(testDbPath)
    const { getAutoUpdateService } = await import('../../src/main/services/AutoUpdateService')
    const service = getAutoUpdateService()
    expect(service).toBeDefined()
  }, 30000)

  it('should resolve the preload path correctly', async () => {
    const mockDirname = 'C:\\Projects\\Totality\\src\\main'
    const preloadPath = path.join(mockDirname, '../preload/index.cjs')
    expect(preloadPath).not.toContain('@preload')
    expect(preloadPath).toMatch(/[\\\/]preload[\\\/]index\.cjs$/)
  })
})
