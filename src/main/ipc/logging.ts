import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * Logging IPC Handlers
 *
 * Provides IPC communication for log viewing and export functionality.
 */

import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { getLoggingService } from '@main/services/LoggingService'
import path from 'path'
import fs from 'fs'
import { getErrorMessage } from '@main/services/utils/errorUtils'

/**
 * Register all logging-related IPC handlers
 */
export function registerLoggingHandlers(): void {
  /**
   * Get all log entries from the circular buffer
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.GET_ALL, async (_event, limit?: number) => {
    try {
      const logs = getLoggingService().getLogs(limit)
      return logs.map((log: any) => ({
        ...log,
        message: Array.isArray(log.message) ? log.message.join(' ') : String(log.message)
      }))
    } catch (error) {
      getLoggingService().error('[logging]', 'Error getting logs:', error)
      return []
    }
  })

  /**
   * Clear all current logs
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.CLEAR, async () => {
    try {
      getLoggingService().clearLogs()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[logging]', 'Error clearing logs:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Export all current logs to a text file
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.EXPORT, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('No window found')

      const result = await dialog.showSaveDialog(win, {
        title: 'Export Logs',
        defaultPath: `totality-logs-${new Date().toISOString().split('T')[0]}.txt`,
        filters: [
          { name: 'Text Files', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true }
      }

      await getLoggingService().exportLogs(result.filePath)
      return { success: true, path: result.filePath }
    } catch (error: unknown) {
      getLoggingService().error('[logging]', 'Error exporting logs:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  /**
   * Toggle verbose logging
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.SET_VERBOSE, async (_event, enabled: boolean) => {
    getLoggingService().setVerboseLogging(enabled)
    return { success: true }
  })

  /**
   * Check if verbose logging is enabled
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.IS_VERBOSE, async () => {
    return getLoggingService().isVerboseEnabled()
  })

  /**
   * Get file logging settings
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.GET_FILE_SETTINGS, async () => {
    return getLoggingService().getFileLoggingSettings()
  })

  /**
   * Update file logging settings
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.SET_FILE_SETTINGS, async (_event, settings) => {
    getLoggingService().updateFileLoggingSettings(settings)
    return { success: true }
  })

  /**
   * Open the local log directory in the OS file explorer
   */
  ipcMain.handle(IPC_CHANNELS.LOGGING.OPEN_LOG_FOLDER, async () => {
    const logDir = path.join(app.getPath('userData'), 'logs')
    try {
      if (!fs.existsSync(logDir)) {
        await fs.promises.mkdir(logDir, { recursive: true })
      }
      await shell.openPath(logDir)
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Register logger methods for one-way messages from renderer
  ipcMain.on('logs:info', (_event, source, message, ...details) => getLoggingService().info(source, message, ...details))
  ipcMain.on('logs:warn', (_event, source, message, ...details) => getLoggingService().warn(source, message, ...details))
  ipcMain.on('logs:error', (_event, source, message, ...details) => getLoggingService().error(source, message, ...details))
  ipcMain.on('logs:debug', (_event, source, message, ...details) => getLoggingService().debug(source, message, ...details))
}

