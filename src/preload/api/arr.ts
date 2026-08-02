import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'

type ArrConfig = { baseUrl: string; apiKey: string; timeoutMs?: number }
export const arrApi = {
  arrTestConnection: (kind: 'sonarr' | 'radarr', config: ArrConfig) => ipcRenderer.invoke(IPC_CHANNELS.ARR.TEST_CONNECTION, kind, config),
  arrSearchMovie: (config: ArrConfig, movieId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.SEARCH_MOVIE, config, movieId),
  arrSearchSeries: (config: ArrConfig, seriesId: number, seasonNumber?: number, episodeIds?: number[]) => ipcRenderer.invoke(IPC_CHANNELS.ARR.SEARCH_SERIES, config, seriesId, seasonNumber, episodeIds),
  arrGetCommand: (config: ArrConfig, commandId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.GET_COMMAND, config, commandId)
}
export type ArrAPI = typeof arrApi
