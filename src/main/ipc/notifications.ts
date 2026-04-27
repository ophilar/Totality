/**
 * IPC Handlers for Notifications
 */

import { ipcMain } from 'electron'
import { getDatabase } from '@main/database/getDatabase'
import { getLoggingService } from '@main/services/LoggingService'

import { GetNotificationsOptions } from '@main/types/monitoring'

export function registerNotificationHandlers(): void {
  ipcMain.handle('notifications:getAll', async (_event, options?: any) => {
    try {
      const db = getDatabase()
      return db.notifications.get(options as GetNotificationsOptions || {})
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in getAll:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:getCount', async () => {
    try {
      const db = getDatabase()
      return db.notifications.getUnreadCount()
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in getCount:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:markRead', async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      db.notifications.markAsRead(ids)
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in markRead:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:markAllRead', async () => {
    try {
      const db = getDatabase()
      db.notifications.markAllAsRead()
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in markAllRead:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:delete', async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      db.notifications.deleteNotifications(ids)
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in delete:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:clear', async () => {
    try {
      const db = getDatabase()
      db.notifications.clearAllNotifications()
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in clear:', error)
      throw error
    }
  })
}
