import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
export const optimizationApi = {
  optimizationDryRun: (title: string, sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.DRY_RUN, title, sourceId),
  optimizationDecideLanguage: (language: string | null, tracks: unknown[], agrees?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.DECIDE_LANGUAGE, language, tracks, agrees),
  optimizationRequestArrSearch: (config: { baseUrl: string; apiKey: string; timeoutMs?: number }, seriesId: number, pendingKey: string) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH, config, seriesId, pendingKey),
  optimizationGetPending: () => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.GET_PENDING)
  ,optimizationLocalRemux: (filePath: string, quarantineDirectory: string, retainedAudioIndexes: number[], mediaItemId?: number) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZATION.LOCAL_REMUX, filePath, quarantineDirectory, retainedAudioIndexes, mediaItemId)
}
export type OptimizationAPI = typeof optimizationApi
