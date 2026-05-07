import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * IPC Handlers for Notifications
 */

import { ipcMain } from 'electron'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'

import { GetNotificationsOptions } from '@main/types/monitoring'

export function registerNotificationHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NOTIFICATIONS.GET_ALL, async (_event, options?: any) => {
    try {
      const db = getDatabase()
      return await db.notifications.get(options as GetNotificationsOptions || {})
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in getAll:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:getCount', async () => {
    try {
      const db = getDatabase()
      return await db.notifications.getUnreadCount()
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in getCount:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.NOTIFICATIONS.MARK_READ, async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      await db.notifications.markAsRead(ids)
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in markRead:', error)
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.NOTIFICATIONS.MARK_ALL_READ, async () => {
    try {
      const db = getDatabase()
      await db.notifications.markAllAsRead()
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in markAllRead:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:delete', async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      await db.notifications.deleteNotifications(ids)
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in delete:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:clear', async () => {
    try {
      const db = getDatabase()
      await db.notifications.clearAllNotifications()
    } catch (error) {
      getLoggingService().error('[IPC notifications]', 'Error in clear:', error)
      throw error
    }
  })
}

