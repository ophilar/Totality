import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcRenderer } from 'electron'

export interface NotificationRecord {
  id: number
  type: 'info' | 'success' | 'warning' | 'error' | 'task_complete' | 'task_failed'
  title: string
  message: string
  reference_id?: string
  is_read: boolean
  created_at: string
}

export const notificationsApi = {
  notificationsGetAll: (options?: { limit?: number; offset?: number; type?: string; unreadOnly?: boolean }): Promise<NotificationRecord[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS.GET_ALL, options),
  notificationsGetCount: () => ipcRenderer.invoke('notifications:getCount'),
  notificationsMarkRead: (ids: number[]) => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS.MARK_READ, ids),
  notificationsMarkAllRead: () => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS.MARK_ALL_READ),
  notificationsDelete: (ids: number[]) => ipcRenderer.invoke('notifications:delete', ids),
  notificationsClear: () => ipcRenderer.invoke('notifications:clear'),
}

export type NotificationsAPI = typeof notificationsApi
