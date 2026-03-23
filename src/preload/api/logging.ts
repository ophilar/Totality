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
