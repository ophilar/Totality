import { ipcRenderer } from 'electron'

export const duplicatesApi = {
  /**
   * Get all pending duplicate groups
   */
  duplicatesGetPending: (sourceId?: string) => ipcRenderer.invoke('duplicates:getPending', sourceId),

  /**
   * Manually trigger a duplicate scan
   */
  duplicatesScan: (sourceId?: string) => ipcRenderer.invoke('duplicates:scan', sourceId),

  /**
   * Get retention recommendation for a duplicate group
   */
  duplicatesGetRecommendation: (mediaItemIds: number[]) => ipcRenderer.invoke('duplicates:getRecommendation', mediaItemIds),

  /**
   * Resolve a duplicate group
   */
  duplicatesResolve: (duplicateId: number, keepItemId: number, deleteOthers: boolean) => 
    ipcRenderer.invoke('duplicates:resolve', duplicateId, keepItemId, deleteOthers),
}

export type DuplicatesAPI = typeof duplicatesApi
