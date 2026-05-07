import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcRenderer } from 'electron'

export const notificationsApi = {
  notificationsGetAll: (options?: { limit?: number; offset?: number; type?: string; unreadOnly?: boolean }) =>
    ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS.GET_ALL, options),
  notificationsGetCount: () => ipcRenderer.invoke('notifications:getCount'),
  notificationsMarkRead: (ids: number[]) => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS.MARK_READ, ids),
  notificationsMarkAllRead: () => ipcRenderer.invoke(IPC_CHANNELS.NOTIFICATIONS.MARK_ALL_READ),
  notificationsDelete: (ids: number[]) => ipcRenderer.invoke('notifications:delete', ids),
  notificationsClear: () => ipcRenderer.invoke('notifications:clear'),
}

export type NotificationsAPI = typeof notificationsApi
