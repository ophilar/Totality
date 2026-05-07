import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcRenderer } from 'electron'

export const appApi = {
  // App lifecycle
  appReady: () => ipcRenderer.send('app:ready'),
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP.GET_VERSION),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),

  // General
  onMessage: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('main-process-message', handler)
    return () => ipcRenderer.removeListener('main-process-message', handler)
  },

  // Notifications (legacy simple notification)
  onNotification: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
    ipcRenderer.on('notification', handler)
    return () => ipcRenderer.removeListener('notification', handler)
  },

  // ============================================================================
  // AUTO UPDATE
  // ============================================================================
  autoUpdateGetState: () => ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE.GET_STATE),
  autoUpdateCheckForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE.CHECK_FOR_UPDATES),
  autoUpdateDownloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE.DOWNLOAD_UPDATE),
  autoUpdateInstallUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.AUTO_UPDATE.INSTALL_UPDATE),
  onAutoUpdateStateChanged: (callback: (state: {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: string
    downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
    error?: string
    lastChecked?: string
  }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: {
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      version?: string
      releaseNotes?: string
      downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
      error?: string
      lastChecked?: string
    }) => callback(state)
    ipcRenderer.on('autoUpdate:stateChanged', handler)
    return () => ipcRenderer.removeListener('autoUpdate:stateChanged', handler)
  },
}

export interface AppAPI {
  // App lifecycle
  appReady: () => void
  getAppVersion: () => Promise<string>
  openExternal: (url: string) => Promise<void>

  // General
  onMessage: (callback: (message: string) => void) => () => void

  // Notifications (legacy)
  onNotification: (callback: (message: string) => void) => () => void

  // ============================================================================
  // AUTO UPDATE
  // ============================================================================
  autoUpdateGetState: () => Promise<{
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: string
    downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
    error?: string
    lastChecked?: string
  }>
  autoUpdateCheckForUpdates: () => Promise<{ success: boolean }>
  autoUpdateDownloadUpdate: () => Promise<{ success: boolean }>
  autoUpdateInstallUpdate: () => Promise<{ success: boolean }>
  onAutoUpdateStateChanged: (callback: (state: {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: string
    downloadProgress?: { percent: number; bytesPerSecond: number; transferred: number; total: number }
    error?: string
    lastChecked?: string
  }) => void) => () => void
}
