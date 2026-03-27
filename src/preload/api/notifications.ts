import { ipcRenderer } from 'electron'

export const notificationsApi = {
  notificationsGetAll: (options?: { limit?: number; offset?: number; type?: string; unreadOnly?: boolean }) =>
    ipcRenderer.invoke('notifications:getAll', options),
  notificationsGetCount: () => ipcRenderer.invoke('notifications:getCount'),
  notificationsMarkRead: (ids: number[]) => ipcRenderer.invoke('notifications:markRead', ids),
  notificationsMarkAllRead: () => ipcRenderer.invoke('notifications:markAllRead'),
  notificationsDelete: (ids: number[]) => ipcRenderer.invoke('notifications:delete', ids),
  notificationsClear: () => ipcRenderer.invoke('notifications:clear'),
}

export type NotificationsAPI = typeof notificationsApi
