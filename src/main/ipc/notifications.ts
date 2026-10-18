import { IPC_CHANNELS } from '../../shared/ipcChannels'
/**
 * IPC Handlers for Notifications
 */

import { getDatabase } from '../database/getDatabase'
import type { GetNotificationsOptions } from '../types/monitoring'
import { createIpcHandler } from './utils/createHandler'

export function registerNotificationHandlers(): void {
  createIpcHandler(IPC_CHANNELS.notificationsGetAll, async (options?: GetNotificationsOptions) => {
    const db = getDatabase()
    return db.getNotifications(options)
  })

  createIpcHandler(IPC_CHANNELS.notificationsGetCount, async () => {
    const db = getDatabase()
    return db.getNotificationCount()
  })

  createIpcHandler(IPC_CHANNELS.notificationsMarkRead, async (ids: number[]) => {
    const db = getDatabase()
    db.markNotificationsRead(ids)
  })

  createIpcHandler(IPC_CHANNELS.notificationsMarkAllRead, async () => {
    const db = getDatabase()
    db.markAllNotificationsRead()
  })

  createIpcHandler(IPC_CHANNELS.notificationsDelete, async (ids: number[]) => {
    const db = getDatabase()
    db.deleteNotifications(ids)
  })

  createIpcHandler(IPC_CHANNELS.notificationsClear, async () => {
    const db = getDatabase()
    db.clearAllNotifications()
  })
}
