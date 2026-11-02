import { BrowserWindow } from 'electron'
import { getLoggingService } from '@main/services/LoggingService'

/**
 * Safely send a message to a BrowserWindow's webContents if not destroyed.
 * Logs and rethrows any unexpected errors encountered during transmission.
 */
export function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]): boolean {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    try {
      win.webContents.send(channel, ...args)
      return true
    } catch (error) {
      getLoggingService().error('[IPC]', `Failed to send IPC message on channel "${channel}":`, error)
      throw error
    }
  }
  return false
}

/**
 * Get the BrowserWindow from an IPC event sender.
 */
export function getWindowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}
