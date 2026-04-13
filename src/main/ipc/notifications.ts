/**
 * IPC Handlers for Notifications
 */

import { ipcMain } from 'electron'
import { getDatabase } from '../database/getDatabase'

import { GetNotificationsOptions } from '../types/monitoring'

export function registerNotificationHandlers(): void {
  ipcMain.handle('notifications:getAll', async (_event, options?: any) => {
    try {
      const db = getDatabase()
      return db.notifications.get(options as GetNotificationsOptions || {})
    } catch (error) {
      console.error('[IPC notifications:getAll] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:getCount', async () => {
    try {
      const db = getDatabase()
      return db.notifications.getUnreadCount()
    } catch (error) {
      console.error('[IPC notifications:getCount] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:markRead', async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      db.notifications.markAsRead(ids)
    } catch (error) {
      console.error('[IPC notifications:markRead] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:markAllRead', async () => {
    try {
      const db = getDatabase()
      db.notifications.markAllAsRead()
    } catch (error) {
      console.error('[IPC notifications:markAllRead] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:delete', async (_event, ids: number[]) => {
    try {
      const db = getDatabase()
      db.notifications.deleteNotifications(ids)
    } catch (error) {
      console.error('[IPC notifications:delete] Error:', error)
      throw error
    }
  })

  ipcMain.handle('notifications:clear', async () => {
    try {
      const db = getDatabase()
      db.notifications.clearAllNotifications()
    } catch (error) {
      console.error('[IPC notifications:clear] Error:', error)
      throw error
    }
  })
}
