import { ipcRenderer } from 'electron'

export const loggingApi = {
  // ============================================================================
  // LOGGING
  // ============================================================================
  getLogs: (limit?: number) => ipcRenderer.invoke('logs:getAll', limit),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('logs:setVerbose', enabled),
  isVerboseLogging: () => ipcRenderer.invoke('logs:isVerbose'),
  getFileLoggingSettings: () => ipcRenderer.invoke('logs:getFileLoggingSettings'),
  setFileLoggingSettings: (settings: { enabled?: boolean; minLevel?: string; retentionDays?: number }) =>
    ipcRenderer.invoke('logs:setFileLoggingSettings', settings),
  openLogFolder: () => ipcRenderer.invoke('logs:openLogFolder'),
  onNewLog: (callback: (entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: { id: string; timestamp: string; level: 'verbose' | 'debug' | 'info' | 'warn' | 'error'; source: string; message: string; details?: string }) => callback(entry)
    ipcRenderer.on('logs:new', handler)
    return () => ipcRenderer.removeListener('logs:new', handler)
  },
}

export interface LoggingAPI {
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
