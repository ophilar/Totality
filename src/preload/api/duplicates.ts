import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcRenderer } from 'electron'

export const duplicatesApi = {
  /**
   * Get all pending duplicate groups
   */
  duplicatesGetPending: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.GET_PENDING, sourceId),

  /**
   * Manually trigger a duplicate scan
   */
  duplicatesScan: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.SCAN, sourceId),

  /**
   * Get retention recommendation for a duplicate group
   */
  duplicatesGetRecommendation: (mediaItemIds: number[]) => ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.GET_RECOMMENDATION, mediaItemIds),

  /**
   * Resolve a duplicate group
   */
  duplicatesResolve: (duplicateId: number, keepItemId: number, deleteOthers: boolean) => 
    ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.RESOLVE, duplicateId, keepItemId, deleteOthers),
}

export type DuplicatesAPI = typeof duplicatesApi
