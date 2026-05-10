import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { getLoggingService } from '@main/services/LoggingService'
import path from 'path'
import fs from 'fs/promises'
import { createIpcHandler, createIpcHandlerWithEvent, createSyncHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { z } from 'zod'

export function registerLoggingHandlers(): void {
  const service = getLoggingService()

  createIpcHandler(IPC_CHANNELS.LOGGING.GET_ALL, async (limit?: number) => {
    return service.getLogs(limit).map((log: any) => ({ ...log, message: Array.isArray(log.message) ? log.message.join(' ') : String(log.message) }))
  })

  createIpcHandler(IPC_CHANNELS.LOGGING.CLEAR, async () => {
    service.clearLogs()
    return { success: true }
  })

  createIpcHandlerWithEvent(IPC_CHANNELS.LOGGING.EXPORT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('No window')
    const res = await dialog.showSaveDialog(win, { title: 'Export Logs', defaultPath: `totality-logs-${new Date().toISOString().split('T')[0]}.txt`, filters: [{ name: 'Text Files', extensions: ['txt'] }, { name: 'All Files', extensions: ['*'] }] })
    if (res.canceled || !res.filePath) return { success: false, cancelled: true }
    await service.exportLogs(res.filePath)
    return { success: true, path: res.filePath }
  })

  createValidatedIpcHandler(IPC_CHANNELS.LOGGING.SET_VERBOSE, z.boolean(), async (enabled) => {
    service.setVerboseLogging(enabled)
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.LOGGING.IS_VERBOSE, async () => service.isVerboseEnabled())
  createIpcHandler(IPC_CHANNELS.LOGGING.GET_FILE_SETTINGS, async () => service.getFileLoggingSettings())
  createIpcHandler(IPC_CHANNELS.LOGGING.SET_FILE_SETTINGS, async (settings) => {
    service.updateFileLoggingSettings(settings)
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.LOGGING.OPEN_LOG_FOLDER, async () => {
    const logDir = path.join(app.getPath('userData'), 'logs')
    await fs.mkdir(logDir, { recursive: true })
    await shell.openPath(logDir)
    return { success: true }
  })

  ipcMain.on('logs:info', (_event, source, message, ...details) => service.info(source, message, ...details))
  ipcMain.on('logs:warn', (_event, source, message, ...details) => service.warn(source, message, ...details))
  ipcMain.on('logs:error', (_event, source, message, ...details) => service.error(source, message, ...details))
  ipcMain.on('logs:debug', (_event, source, message, ...details) => service.debug(source, message, ...details))
}

