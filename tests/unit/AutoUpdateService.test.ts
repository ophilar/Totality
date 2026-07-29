import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AutoUpdateService, getAutoUpdateService } from '@main/services/AutoUpdateService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { getLoggingService } from '@main/services/LoggingService'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { safeSend } from '@main/ipc/utils/safeSend'
import { NotificationType } from '@main/types/monitoring'

vi.mock('electron-updater', () => {
  const listeners: Record<string, Function[]> = {}

  return {
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      logger: null,
      on: vi.fn((event: string, callback: Function) => {
        if (!listeners[event]) {
          listeners[event] = []
        }
        listeners[event].push(callback)
      }),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn(),
      // Helper to trigger events in tests
      __triggerEvent: (event: string, ...args: any[]) => {
        if (listeners[event]) {
          listeners[event].forEach(cb => cb(...args))
        }
      },
      __resetListeners: () => {
        for (const key in listeners) delete listeners[key]
      }
    }
  }
})

vi.mock('@main/ipc/utils/safeSend', () => ({
  safeSend: vi.fn()
}))

describe('AutoUpdateService', () => {
  let service: AutoUpdateService
  let db: any
  let logging: any

  beforeEach(async () => {
    vi.clearAllMocks()
    ;(autoUpdater as any).__resetListeners()

    db = await setupTestDb()
    logging = getLoggingService()
    logging.setDatabaseGetter(() => db)

    // Reset singleton if we test that way, but let's just make a new instance
    service = new AutoUpdateService()

    // Default electron mock state
    app.isPackaged = true
  })

  afterEach(async () => {
    service.cleanup()
    await cleanupTestDb(db)
  })

  it('should initialize correctly', () => {
    service.initialize()
    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdater.on).toHaveBeenCalledWith('checking-for-update', expect.any(Function))
    expect(service.getState().status).toBe('idle')
  })

  it('should not initialize twice', () => {
    service.initialize()
    const callCount = (autoUpdater.on as any).mock.calls.length
    service.initialize()
    expect((autoUpdater.on as any).mock.calls.length).toBe(callCount)
  })

  it('should allow setting main window', () => {
    const mockWin = { id: 1 } as any
    service.setMainWindow(mockWin)
    service.initialize()

    ;(autoUpdater as any).__triggerEvent('checking-for-update')
    expect(safeSend).toHaveBeenCalledWith(mockWin, 'autoUpdate:stateChanged', expect.objectContaining({ status: 'checking' }))
  })

  it('should trigger check manually', async () => {
    await service.checkForUpdates()
    expect(autoUpdater.checkForUpdates).toHaveBeenCalled()
  })

  it('should handle check error', async () => {
    ;(autoUpdater.checkForUpdates as any).mockRejectedValueOnce(new Error('Network error'))
    await service.checkForUpdates()
    expect(service.getState().status).toBe('error')
    expect(service.getState().error).toBe('Network error')
  })

  it('should trigger download update when packaged', async () => {
    app.isPackaged = true
    await service.downloadUpdate()
    expect(autoUpdater.downloadUpdate).toHaveBeenCalled()
  })

  it('should not trigger download update when not packaged', async () => {
    app.isPackaged = false
    await service.downloadUpdate()
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('should handle download error', async () => {
    app.isPackaged = true
    ;(autoUpdater.downloadUpdate as any).mockRejectedValueOnce(new Error('Download failed'))
    await service.downloadUpdate()
    expect(service.getState().status).toBe('error')
    expect(service.getState().error).toBe('Download failed')
  })

  it('should trigger install update', async () => {
    app.isPackaged = true
    await service.installUpdate()
    // Assuming DB is closed, quitAndInstall is called
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('should not trigger install update when not packaged', async () => {
    app.isPackaged = false
    await service.installUpdate()
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('should quit and install even if db close fails', async () => {
    app.isPackaged = true
    const errorLogSpy = vi.spyOn(logging, 'error')
    db.close = vi.fn().mockRejectedValueOnce(new Error('DB Close Failed'))

    await service.installUpdate()

    expect(errorLogSpy).toHaveBeenCalledWith('[AutoUpdateService]', '[AutoUpdate] Failed to close database before update:', expect.any(Error))
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  describe('scheduling and autoCheckIfEnabled', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should schedule auto check after delay and interval', async () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval')
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      service.initialize()

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000)
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 4 * 60 * 60 * 1000)
    })

    it('should call checkForUpdates when auto_update_enabled is not false', async () => {
      db.config.getSetting = vi.fn().mockReturnValue('true')
      const checkForUpdatesSpy = vi.spyOn(service, 'checkForUpdates').mockResolvedValue()

      service.initialize()

      // Advance by CHECK_DELAY_MS
      await vi.advanceTimersByTimeAsync(30_000)

      expect(db.config.getSetting).toHaveBeenCalledWith('auto_update_enabled')
      expect(checkForUpdatesSpy).toHaveBeenCalled()
    })

    it('should not call checkForUpdates when auto_update_enabled is false', async () => {
      db.config.getSetting = vi.fn().mockReturnValue('false')
      const checkForUpdatesSpy = vi.spyOn(service, 'checkForUpdates').mockResolvedValue()

      service.initialize()

      // Advance by CHECK_DELAY_MS
      await vi.advanceTimersByTimeAsync(30_000)

      expect(db.config.getSetting).toHaveBeenCalledWith('auto_update_enabled')
      expect(checkForUpdatesSpy).not.toHaveBeenCalled()
    })

    it('should clear timer on cleanup', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
      service.initialize()

      // Service should now have a checkTimer set
      service.cleanup()

      expect(clearIntervalSpy).toHaveBeenCalled()
      // Calling it again should not crash or call it again
      clearIntervalSpy.mockClear()
      service.cleanup()
      expect(clearIntervalSpy).not.toHaveBeenCalled()
    })
  })

  describe('event handlers', () => {
    beforeEach(() => {
      service.initialize()
    })

    it('handles checking-for-update', () => {
      ;(autoUpdater as any).__triggerEvent('checking-for-update')
      expect(service.getState().status).toBe('checking')
    })

    it('handles update-available', async () => {
      ;(autoUpdater as any).__triggerEvent('update-available', { version: '1.2.3', releaseNotes: 'Fixed bugs' })
      const state = service.getState()
      expect(state.status).toBe('available')
      expect(state.version).toBe('1.2.3')
      expect(state.releaseNotes).toBe('Fixed bugs')

      // Wait a tick for the async DB insertion to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      const notifications = await db.notifications.getNotifications()
      expect(notifications.length).toBe(1)
      expect(notifications[0].title).toBe('Update available')
      expect(notifications[0].type).toBe(NotificationType.Info)
    })

    it('handles update-not-available', () => {
      ;(autoUpdater as any).__triggerEvent('update-not-available', {})
      const state = service.getState()
      expect(state.status).toBe('not-available')
      expect(state.lastChecked).toBeDefined()
    })

    it('handles download-progress', () => {
      ;(autoUpdater as any).__triggerEvent('download-progress', {
        percent: 50,
        bytesPerSecond: 1000,
        transferred: 500,
        total: 1000
      })
      const state = service.getState()
      expect(state.status).toBe('downloading')
      expect(state.downloadProgress).toEqual({
        percent: 50,
        bytesPerSecond: 1000,
        transferred: 500,
        total: 1000
      })
    })

    it('handles update-downloaded', async () => {
      ;(autoUpdater as any).__triggerEvent('update-downloaded', { version: '1.2.3' })
      const state = service.getState()
      expect(state.status).toBe('downloaded')
      expect(state.version).toBe('1.2.3')

      // Wait a tick for the async DB insertion to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      const notifications = await db.notifications.getNotifications()
      expect(notifications.length).toBe(1)
      expect(notifications[0].title).toBe('Update ready')
    })

    it('handles error', () => {
      ;(autoUpdater as any).__triggerEvent('error', new Error('Some update error'))
      const state = service.getState()
      expect(state.status).toBe('error')
      expect(state.error).toBe('Some update error')
    })
  })
})
