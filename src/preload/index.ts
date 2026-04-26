import { contextBridge } from 'electron'

// Import modules
import { appApi, AppAPI } from './api/app'
import { sourcesApi, SourcesAPI } from './api/sources'
import { mediaApi, MediaAPI } from './api/media'
import { musicApi, MusicAPI } from './api/music'
import { duplicatesApi, DuplicatesAPI } from './api/duplicates'
import { wishlistApi, WishlistAPI } from './api/wishlist'
import { monitoringApi, MonitoringAPI } from './api/monitoring'
import { aiApi, AiAPI } from './api/ai'
import { loggingApi, LoggingAPI } from './api/logging'
import { notificationsApi, NotificationsAPI } from './api/notifications'
import { transcodingAPI } from './api/transcoding'

// Import types
import {
  LibraryType,
  ConnectionTestResult,
  MediaSourceResponse,
  ServerInstanceResponse,
  MediaLibraryResponse,
  ScanResultResponse,
  DiscoveredServerResponse
} from './api/types'

// Re-export for consumers of this module
export { LibraryType }
export type {
  ConnectionTestResult,
  MediaSourceResponse,
  ServerInstanceResponse,
  MediaLibraryResponse,
  ScanResultResponse,
  DiscoveredServerResponse
}

// Re-export specific APIs types
export type {
  AppAPI,
  SourcesAPI,
  MediaAPI,
  MusicAPI,
  WishlistAPI,
  MonitoringAPI,
  AiAPI,
  LoggingAPI,
  NotificationsAPI
}

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
