import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { z } from 'zod'

export function registerNotificationHandlers(): void {
  const db = getDatabase()

  createIpcHandler(IPC_CHANNELS.NOTIFICATIONS.GET_ALL, async (options?: any) => {
    return await db.notifications.get(options || {})
  })

  createIpcHandler('notifications:getCount', async () => {
    return await db.notifications.getUnreadCount()
  })

  createValidatedIpcHandler(IPC_CHANNELS.NOTIFICATIONS.MARK_READ, z.array(z.number()), async (ids) => {
    await db.notifications.markAsRead(ids)
  })

  createIpcHandler(IPC_CHANNELS.NOTIFICATIONS.MARK_ALL_READ, async () => {
    await db.notifications.markAllAsRead()
  })

  createValidatedIpcHandler('notifications:delete', z.array(z.number()), async (ids) => {
    await db.notifications.deleteNotifications(ids)
  })

  createIpcHandler('notifications:clear', async () => {
    await db.notifications.clearAllNotifications()
  })

  getLoggingService().info('[notifications]', 'Notification IPC handlers registered')
}

