import { ipcRenderer } from 'electron'
import type { TranscodeOptions, TranscodingParams, TranscodeProgress } from '@main/services/TranscodingService'

export const transcodingAPI = {
  checkAvailability: () => ipcRenderer.invoke('transcoding:checkAvailability'),
  getCapabilities: () => ipcRenderer.invoke('transcoding:getCapabilities'),
  refreshCapabilities: () => ipcRenderer.invoke('transcoding:refreshCapabilities'),
  setSelectedGpu: (gpuId: string | null) => ipcRenderer.invoke('transcoding:setSelectedGpu', gpuId),
  handbrakeGetVersion: () => ipcRenderer.invoke('handbrake:getVersion'),

  getParameters: (filePath: string, options?: TranscodeOptions) => ipcRenderer.invoke('transcoding:getParameters', filePath, options) as Promise<TranscodingParams>,
  start: (mediaItemId: number, options?: TranscodeOptions) => ipcRenderer.invoke('transcoding:start', mediaItemId, options),
  cancel: (mediaItemId: number) => ipcRenderer.invoke('transcoding:cancel', mediaItemId),
  onProgress: (callback: (progress: TranscodeProgress & { mediaItemId: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TranscodeProgress & { mediaItemId: number }) => callback(progress)
    ipcRenderer.on('transcoding:progress', listener)
    return () => ipcRenderer.removeListener('transcoding:progress', listener)
  }
}
