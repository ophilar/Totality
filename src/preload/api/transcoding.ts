import { ipcRenderer } from 'electron'

export const transcodingAPI = {
  checkAvailability: () => ipcRenderer.invoke('transcoding:checkAvailability'),
  getParameters: (filePath: string, options?: any) => ipcRenderer.invoke('transcoding:getParameters', filePath, options),
  start: (mediaItemId: number, options?: any) => ipcRenderer.invoke('transcoding:start', mediaItemId, options),
  onProgress: (callback: (progress: any) => void) => {
    const listener = (_event: any, progress: any) => callback(progress)
    ipcRenderer.on('transcoding:progress', listener)
    return () => ipcRenderer.removeListener('transcoding:progress', listener)
  }
}
