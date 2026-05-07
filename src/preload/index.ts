import { contextBridge } from 'electron'

// Import modules
import { appApi, AppAPI } from '@preload/api/app'
import { sourcesApi, SourcesAPI } from '@preload/api/sources'
import { mediaApi, MediaAPI } from '@preload/api/media'
import { musicApi, MusicAPI } from '@preload/api/music'
import { duplicatesApi, DuplicatesAPI } from '@preload/api/duplicates'
import { wishlistApi, WishlistAPI } from '@preload/api/wishlist'
import { monitoringApi, MonitoringAPI } from '@preload/api/monitoring'
import { aiApi, AiAPI } from '@preload/api/ai'
import { loggingApi, LoggingAPI } from '@preload/api/logging'
import { notificationsApi, NotificationsAPI } from '@preload/api/notifications'
import { transcodingAPI } from '@preload/api/transcoding'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  ...appApi,
  ...sourcesApi,
  ...mediaApi,
  ...musicApi,
  ...duplicatesApi,
  ...wishlistApi,
  ...monitoringApi,
  ...aiApi,
  ...loggingApi,
  ...notificationsApi,
  ...transcodingAPI
})

// Type definitions for window object
export type ElectronAPI = AppAPI &
  SourcesAPI &
  MediaAPI &
  MusicAPI &
  DuplicatesAPI &
  WishlistAPI &
  MonitoringAPI &
  AiAPI &
  LoggingAPI &
  NotificationsAPI &
  typeof transcodingAPI

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
