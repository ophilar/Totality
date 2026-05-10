import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getAutoUpdateService } from '@main/services/AutoUpdateService'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createSyncHandler } from '@main/ipc/utils/createHandler'

export function registerAutoUpdateHandlers(): void {
  const service = getAutoUpdateService()

  createSyncHandler(IPC_CHANNELS.AUTO_UPDATE.GET_STATE, () => {
    return service.getState()
  })

  createIpcHandler(IPC_CHANNELS.AUTO_UPDATE.CHECK_FOR_UPDATES, async () => {
    await service.checkForUpdates()
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.AUTO_UPDATE.DOWNLOAD_UPDATE, async () => {
    await service.downloadUpdate()
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.AUTO_UPDATE.INSTALL_UPDATE, async () => {
    await service.installUpdate()
    return { success: true }
  })

  getLoggingService().info('[autoUpdate]', '[IPC] Auto-update handlers registered')
}

