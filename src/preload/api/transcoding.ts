import { ipcRenderer } from 'electron'
import type { TranscodeOptions, TranscodingParams, TranscodeProgress } from '@main/services/TranscodingService'

export const transcodingAPI = {
  checkAvailability: () => ipcRenderer.invoke('transcoding:checkAvailability'),
  getCapabilities: () => ipcRenderer.invoke('transcoding:getCapabilities'),
  refreshCapabilities: () => ipcRenderer.invoke('transcoding:refreshCapabilities'),
  setSelectedGpu: (gpuId: string | null) => ipcRenderer.invoke('transcoding:setSelectedGpu', gpuId),
  getParameters: (mediaItemId: number, options?: TranscodeOptions) => ipcRenderer.invoke('transcoding:getParameters', mediaItemId, options) as Promise<TranscodingParams>,
  cancel: (mediaItemId: number) => ipcRenderer.invoke('transcoding:cancel', mediaItemId),
  preflightShow: (request: unknown) => ipcRenderer.invoke('transcoding:preflightShow', request),
  preflightRemux: (mediaItemId: number) => ipcRenderer.invoke('transcoding:preflightRemux', mediaItemId),
  queueShow: (preflightId: string) => ipcRenderer.invoke('transcoding:queueShow', preflightId),
  approveShow: (preflightId: string) => ipcRenderer.invoke('transcoding:approveShow', preflightId),
  discardShow: (preflightId: string) => ipcRenderer.invoke('transcoding:discardShow', preflightId),
  openShowSample: (preflightId: string, mediaItemId: number, index: number) => ipcRenderer.invoke('transcoding:openShowSample', preflightId, mediaItemId, index),
  listShowQuarantine: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => ipcRenderer.invoke('transcoding:listShowQuarantine', seriesTitle, sourceId, seriesIdentityKey, libraryId),
  purgeShowQuarantine: (seriesTitle: string, sourceId: string, seriesIdentityKey: string, libraryId: string) => ipcRenderer.invoke('transcoding:purgeShowQuarantine', seriesTitle, sourceId, seriesIdentityKey, libraryId),
  onProgress: (callback: (progress: TranscodeProgress & { mediaItemId: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TranscodeProgress & { mediaItemId: number }) => callback(progress)
    ipcRenderer.on('transcoding:progress', listener)
    return () => ipcRenderer.removeListener('transcoding:progress', listener)
  }
}
