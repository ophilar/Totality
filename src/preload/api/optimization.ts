import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'

export const optimizationApi = {
  optimizationRequestArrSearch: (seriesId: number, optIn: boolean) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH, seriesId, optIn),
  optimizationGetPending: () => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.GET_PENDING),
  optimizationGetRemuxJob: (mediaItemId: number) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.GET_REMUX_JOB, mediaItemId),
  optimizationGetDecision: (mediaItemId: number) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.GET_DECISION, mediaItemId)
}

export type OptimizationAPI = typeof optimizationApi
