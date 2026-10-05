import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcRenderer } from 'electron'
import type { MediaDuplicate } from '@main/database/repositories/DuplicateRepository'
import type { DuplicateResolutionOutcome } from '@shared/duplicateResolution'

export const duplicatesApi = {
  /**
   * Get all pending duplicate groups
   */
  duplicatesGetPending: (sourceId?: string): Promise<MediaDuplicate[]> => ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.GET_PENDING, sourceId),

  /**
   * Manually trigger a duplicate scan
   */
  duplicatesScan: (sourceId: string | undefined, requestId: string) => ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.SCAN, sourceId, requestId),

  /**
   * Get retention recommendation for a duplicate group
   */
  duplicatesGetRecommendation: (mediaItemIds: number[]) => ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.GET_RECOMMENDATION, mediaItemIds),

  /**
   * Resolve a duplicate group
   */
  duplicatesResolve: (duplicateId: number, keepItemId: number, deleteOthers: boolean): Promise<DuplicateResolutionOutcome> =>
    ipcRenderer.invoke(IPC_CHANNELS.DUPLICATES.RESOLVE, duplicateId, keepItemId, deleteOthers),
}

export type DuplicatesAPI = typeof duplicatesApi
