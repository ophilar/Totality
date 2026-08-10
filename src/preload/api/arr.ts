import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'

type ArrConfig = { baseUrl: string; apiKey: string; timeoutMs?: number }
export const arrApi = {
  arrTestConnection: (kind: 'sonarr' | 'radarr', config: ArrConfig) => ipcRenderer.invoke(IPC_CHANNELS.ARR.TEST_CONNECTION, kind, config),
  arrSearchMovie: (config: ArrConfig, movieId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.SEARCH_MOVIE, config, movieId),
  arrFindManagedMovie: (config: ArrConfig, tmdbId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.FIND_MANAGED_MOVIE, config, tmdbId),
  arrFindManagedSeries: (config: ArrConfig, tvdbId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.FIND_MANAGED_SERIES, config, tvdbId),
  arrWaitForCommand: (config: ArrConfig, commandId: number, options?: { pollIntervalMs?: number; timeoutMs?: number }) => ipcRenderer.invoke(IPC_CHANNELS.ARR.WAIT_COMMAND, config, commandId, options),
  arrSearchSeries: (config: ArrConfig, seriesId: number, seasonNumber?: number, episodeIds?: number[]) => ipcRenderer.invoke(IPC_CHANNELS.ARR.SEARCH_SERIES, config, seriesId, seasonNumber, episodeIds),
  arrLookupMovie: (config: ArrConfig, tmdbId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.LOOKUP_MOVIE, config, tmdbId),
  arrLookupSeries: (config: ArrConfig, tvdbId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.LOOKUP_SERIES, config, tvdbId),
  arrGetCommand: (config: ArrConfig, commandId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.GET_COMMAND, config, commandId)
  ,arrGetLanguageProfiles: (config: ArrConfig) => ipcRenderer.invoke(IPC_CHANNELS.ARR.GET_LANGUAGE_PROFILES, config)
  ,arrGetManagedState: (config: ArrConfig, seriesId: number) => ipcRenderer.invoke(IPC_CHANNELS.ARR.GET_MANAGED_STATE, config, seriesId)
}
export type ArrAPI = typeof arrApi
