import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcRenderer } from 'electron'

export const loggingApi = {
  log: {
    info: (source: string, message: unknown, ...details: unknown[]) => ipcRenderer.send('logs:info', source, message, ...details),
    warn: (source: string, message: unknown, ...details: unknown[]) => ipcRenderer.send('logs:warn', source, message, ...details),
    error: (source: string, message: unknown, ...details: unknown[]) => ipcRenderer.send('logs:error', source, message, ...details),
    debug: (source: string, message: unknown, ...details: unknown[]) => ipcRenderer.send('logs:debug', source, message, ...details),
  },

  // ============================================================================
  // LOGGING
  // ============================================================================
  getLogs: (limit?: number) => ipcRenderer.invoke(IPC_CHANNELS.LOGGING.GET_ALL, limit),
  clearLogs: () => ipcRenderer.invoke(IPC_CHANNELS.LOGGING.CLEAR),
  exportLogs: () => ipcRenderer.invoke(IPC_CHANNELS.LOGGING.EXPORT),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke(IPC_CHANNELS.LOGGING.SET_VERBOSE, enabled),
  isVerboseLogging: () => ipcRenderer.invoke(IPC_CHANNELS.LOGGING.IS_VERBOSE),
  getFileLoggingSettings: () => ipcRenderer.invoke(IPC_CHANNELS.LOGGING.GET_FILE_SETTINGS),
  setFileLoggingSettings: (settings: { enabled?: boolean; minLevel?: string; retentionDays?: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.LOGGING.SET_FILE_SETTINGS, settings),
  openLogFolder: () => ipcRenderer.invoke(IPC_CHANNELS.LOGGING.OPEN_LOG_FOLDER),
  onNewLog: (callback: (entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => callback(entry)
    ipcRenderer.on('logs:new', handler)
    return () => ipcRenderer.removeListener('logs:new', handler)
  },
}

export interface LoggingAPI {
  log: {
    info: (source: string, message: unknown, ...details: unknown[]) => void
    warn: (source: string, message: unknown, ...details: unknown[]) => void
    error: (source: string, message: unknown, ...details: unknown[]) => void
    debug: (source: string, message: unknown, ...details: unknown[]) => void
  }

  // ============================================================================
  // LOGGING
  // ============================================================================
  getLogs: (limit?: number) => Promise<Array<{ id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }>>
  clearLogs: () => Promise<void>
  exportLogs: () => Promise<{
    success: boolean
    filePath?: string
    error?: string
    canceled?: boolean
  }>
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>
  isVerboseLogging: () => Promise<boolean>
  getFileLoggingSettings: () => Promise<{ enabled: boolean; minLevel: string; retentionDays: number }>
  setFileLoggingSettings: (settings: { enabled?: boolean; minLevel?: string; retentionDays?: number }) => Promise<{ success: boolean }>
  openLogFolder: () => Promise<{ success: boolean }>
  onNewLog?: (callback: (entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => void) => () => void
}
