import { ipcRenderer } from 'electron'

export const monitoringApi = {
  // ============================================================================
  // LIVE MONITORING
  // ============================================================================

  // Monitoring Control
  monitoringGetConfig: () => ipcRenderer.invoke('monitoring:getConfig'),
  monitoringSetConfig: (config: {
    enabled?: boolean
    startOnLaunch?: boolean
    pauseDuringManualScan?: boolean
    pollingIntervals?: Record<string, number>
  }) => ipcRenderer.invoke('monitoring:setConfig', config),
  monitoringStart: () => ipcRenderer.invoke('monitoring:start'),
  monitoringStop: () => ipcRenderer.invoke('monitoring:stop'),
  monitoringIsActive: () => ipcRenderer.invoke('monitoring:isActive'),
  monitoringForceCheck: (sourceId: string) => ipcRenderer.invoke('monitoring:forceCheck', sourceId),

  // Monitoring Events
  onMonitoringStatusChanged: (callback: (status: { isActive: boolean; lastCheck?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { isActive: boolean; lastCheck?: string }) => callback(status)
    ipcRenderer.on('monitoring:statusChanged', handler)
    return () => ipcRenderer.removeListener('monitoring:statusChanged', handler)
  },
  onMonitoringSourceChecked: (callback: (data: { sourceId: string; hasChanges: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { sourceId: string; hasChanges: boolean }) => callback(data)
    ipcRenderer.on('monitoring:sourceChecked', handler)
    return () => ipcRenderer.removeListener('monitoring:sourceChecked', handler)
  },
  onMonitoringStatus: (callback: (status: { isActive: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { isActive: boolean }) => callback(status)
    ipcRenderer.on('monitoring:status', handler)
    return () => ipcRenderer.removeListener('monitoring:status', handler)
  },
  onMonitoringEvent: (callback: (event: { type: string; message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { type: string; message: string }) => callback(data)
    ipcRenderer.on('monitoring:event', handler)
    return () => ipcRenderer.removeListener('monitoring:event', handler)
  },
  getMonitoringStatus: () => ipcRenderer.invoke('monitoring:getStatus'),

  // ============================================================================
  // TASK QUEUE
  // ============================================================================

  // Queue State
  taskQueueGetState: () => ipcRenderer.invoke('taskQueue:getState'),

  // Task Management
  taskQueueAddTask: (definition: {
    type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
    label: string
    sourceId?: string
    libraryId?: string
    artistId?: number
  }) => ipcRenderer.invoke('taskQueue:addTask', definition),
  taskQueueRemoveTask: (taskId: string) => ipcRenderer.invoke('taskQueue:removeTask', taskId),
  taskQueueReorderQueue: (taskIds: string[]) => ipcRenderer.invoke('taskQueue:reorderQueue', taskIds),
  taskQueueClearQueue: () => ipcRenderer.invoke('taskQueue:clearQueue'),

  // Queue Control
  taskQueuePause: () => ipcRenderer.invoke('taskQueue:pause'),
  taskQueueResume: () => ipcRenderer.invoke('taskQueue:resume'),
  taskQueueCancelCurrent: () => ipcRenderer.invoke('taskQueue:cancelCurrent'),

  // History
  taskQueueGetTaskHistory: () => ipcRenderer.invoke('taskQueue:getTaskHistory'),
  taskQueueGetMonitoringHistory: () => ipcRenderer.invoke('taskQueue:getMonitoringHistory'),
  taskQueueClearTaskHistory: () => ipcRenderer.invoke('taskQueue:clearTaskHistory'),
  taskQueueClearMonitoringHistory: () => ipcRenderer.invoke('taskQueue:clearMonitoringHistory'),

  // Task Queue Events
  onTaskQueueUpdated: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('taskQueue:updated', handler)
    return () => ipcRenderer.removeListener('taskQueue:updated', handler)
  },
  onTaskQueueTaskComplete: (callback: (task: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, task: unknown) => callback(task)
    ipcRenderer.on('taskQueue:taskComplete', handler)
    return () => ipcRenderer.removeListener('taskQueue:taskComplete', handler)
  },
  onScanCompleted: (callback: (data: {
    sourceId?: string
    libraryId?: string
    libraryName: string
    itemsAdded: number
    itemsUpdated: number
    itemsScanned: number
    isFirstScan: boolean
  }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: {
      sourceId?: string
      libraryId?: string
      libraryName: string
      itemsAdded: number
      itemsUpdated: number
      itemsScanned: number
      isFirstScan: boolean
    }) => callback(data)
    ipcRenderer.on('scan:completed', handler)
    return () => ipcRenderer.removeListener('scan:completed', handler)
  },
  onTaskQueueHistoryUpdated: (callback: (history: { taskHistory: unknown[]; monitoringHistory: unknown[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, history: { taskHistory: unknown[]; monitoringHistory: unknown[] }) => callback(history)
    ipcRenderer.on('taskQueue:historyUpdated', handler)
    return () => ipcRenderer.removeListener('taskQueue:historyUpdated', handler)
  },
  onWishlistAutoCompleted: (callback: (items: Array<{ id: number; title: string; reason: string; media_type: string }>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, items: Array<{ id: number; title: string; reason: string; media_type: string }>) => callback(items)
    ipcRenderer.on('wishlist:autoCompleted', handler)
    return () => ipcRenderer.removeListener('wishlist:autoCompleted', handler)
  },
  onLibraryUpdated: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('library:updated', handler)
    return () => ipcRenderer.removeListener('library:updated', handler)
  },
}

export interface MonitoringAPI {
  // ============================================================================
  // LIVE MONITORING
  // ============================================================================

  // Monitoring Control
  monitoringGetConfig: () => Promise<{
    enabled: boolean
    startOnLaunch: boolean
    pauseDuringManualScan: boolean
    pollingIntervals: Record<string, number>
  }>
  monitoringSetConfig: (config: {
    enabled?: boolean
    startOnLaunch?: boolean
    pauseDuringManualScan?: boolean
    pollingIntervals?: Record<string, number>
  }) => Promise<{ success: boolean }>
  monitoringStart: () => Promise<{ success: boolean }>
  monitoringStop: () => Promise<{ success: boolean }>
  monitoringIsActive: () => Promise<boolean>
  monitoringForceCheck: (sourceId: string) => Promise<Array<{
    sourceId: string
    sourceName: string
    sourceType: string
    libraryId: string
    libraryName: string
    changeType: 'added' | 'updated' | 'removed'
    itemCount: number
    items: Array<{
      id: string
      title: string
      type: 'movie' | 'episode' | 'album' | 'track' | 'artist'
      year?: number
      posterUrl?: string
      seriesTitle?: string
      artistName?: string
    }>
    detectedAt: string
  }>>

  // Monitoring Events
  onMonitoringStatusChanged: (callback: (status: { isActive: boolean; lastCheck?: string }) => void) => () => void
  onMonitoringSourceChecked: (callback: (data: { sourceId: string; hasChanges: boolean }) => void) => () => void
  onMonitoringStatus: (callback: (status: { isActive: boolean }) => void) => () => void
  onMonitoringEvent: (callback: (event: { type: string; message: string }) => void) => () => void
  getMonitoringStatus: () => Promise<{ isActive: boolean }>

  // ============================================================================
  // TASK QUEUE
  // ============================================================================

  // Queue State
  taskQueueGetState: () => Promise<{
    currentTask: {
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      artistId?: number
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    } | null
    queue: Array<{
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      artistId?: number
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    }>
    isPaused: boolean
    completedTasks: Array<{
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      artistId?: number
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    }>
  }>

  // Task Management
  taskQueueAddTask: (definition: {
    type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
    label: string
    sourceId?: string
    libraryId?: string
    artistId?: number
  }) => Promise<{ success: boolean; taskId: string }>
  taskQueueRemoveTask: (taskId: string) => Promise<{ success: boolean }>
  taskQueueReorderQueue: (taskIds: string[]) => Promise<{ success: boolean }>
  taskQueueClearQueue: () => Promise<{ success: boolean }>

  // Queue Control
  taskQueuePause: () => Promise<{ success: boolean }>
  taskQueueResume: () => Promise<{ success: boolean }>
  taskQueueCancelCurrent: () => Promise<{ success: boolean }>

  // History
  taskQueueGetTaskHistory: () => Promise<Array<{
    id: string
    timestamp: string
    type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
    message: string
    taskId?: string
    taskType?: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
  }>>
  taskQueueGetMonitoringHistory: () => Promise<Array<{
    id: string
    timestamp: string
    type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
    message: string
    taskId?: string
    taskType?: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
  }>>
  taskQueueClearTaskHistory: () => Promise<{ success: boolean }>
  taskQueueClearMonitoringHistory: () => Promise<{ success: boolean }>

  // Task Queue Events
  onTaskQueueUpdated: (callback: (state: {
    currentTask: {
      id: string
      type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
      label: string
      sourceId?: string
      libraryId?: string
      artistId?: number
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      progress?: {
        current: number
        total: number
        percentage: number
        phase: string
        currentItem?: string
      }
      createdAt: string
      startedAt?: string
      completedAt?: string
      error?: string
      result?: {
        itemsScanned?: number
        itemsAdded?: number
        itemsUpdated?: number
        itemsRemoved?: number
      }
    } | null
    queue: unknown[]
    isPaused: boolean
    completedTasks: unknown[]
  }) => void) => () => void
  onTaskQueueTaskComplete: (callback: (task: {
    id: string
    type: 'library-scan' | 'source-scan' | 'series-completeness' | 'collection-completeness' | 'music-completeness' | 'music-scan'
    label: string
    status: 'completed' | 'failed' | 'cancelled'
    completedAt: string
    error?: string
    result?: {
      itemsScanned?: number
      itemsAdded?: number
      itemsUpdated?: number
      itemsRemoved?: number
    }
  }) => void) => () => void
  onScanCompleted: (callback: (data: {
    sourceId?: string
    libraryId?: string
    libraryName: string
    itemsAdded: number
    itemsUpdated: number
    itemsScanned: number
    isFirstScan: boolean
  }) => void) => () => void
  onTaskQueueHistoryUpdated: (callback: (history: {
    taskHistory: Array<{
      id: string
      timestamp: string
      type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
      message: string
      taskId?: string
      taskType?: string
    }>
    monitoringHistory: Array<{
      id: string
      timestamp: string
      type: 'task-complete' | 'task-failed' | 'task-cancelled' | 'monitoring'
      message: string
      taskId?: string
      taskType?: string
    }>
  }) => void) => () => void
  onWishlistAutoCompleted: (callback: (items: Array<{ id: number; title: string; reason: string; media_type: string }>) => void) => () => void
  onLibraryUpdated: (callback: () => void) => () => void
}
