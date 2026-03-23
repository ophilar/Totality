/**
 * IPC Handlers for Auto Update System
 */

import { ipcMain } from 'electron'
import { getAutoUpdateService } from '../services/AutoUpdateService'
import { getLoggingService } from '../services/LoggingService'

export function registerAutoUpdateHandlers(): void {
  const service = getAutoUpdateService()

  /**
   * Get current update state
   */
  ipcMain.handle('autoUpdate:getState', () => {
    try {
      return service.getState()
    } catch (error) {
      getLoggingService().error('[autoUpdate]', '[IPC autoUpdate:getState] Error:', error)
      throw error
    }
  })

  /**
   * Manually check for updates
   */
  ipcMain.handle('autoUpdate:checkForUpdates', async () => {
    try {
      getLoggingService().info('[autoUpdate]', '[IPC autoUpdate:checkForUpdates] Checking for updates')
      await service.checkForUpdates()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[autoUpdate]', '[IPC autoUpdate:checkForUpdates] Error:', error)
      throw error
    }
  })

  /**
   * Download the available update
   */
  ipcMain.handle('autoUpdate:downloadUpdate', async () => {
    try {
      getLoggingService().info('[autoUpdate]', '[IPC autoUpdate:downloadUpdate] Downloading update')
      await service.downloadUpdate()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[autoUpdate]', '[IPC autoUpdate:downloadUpdate] Error:', error)
      throw error
    }
  })

  /**
   * Quit and install the downloaded update
   */
  ipcMain.handle('autoUpdate:installUpdate', async () => {
    try {
      getLoggingService().info('[autoUpdate]', '[IPC autoUpdate:installUpdate] Installing update and restarting')
      await service.installUpdate()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[autoUpdate]', '[IPC autoUpdate:installUpdate] Error:', error)
      throw error
    }
  })

  getLoggingService().info('[autoUpdate]', '[IPC] Auto-update handlers registered')
}
