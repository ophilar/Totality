import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getAutoUpdateService } from '@main/services/AutoUpdateService'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createSyncHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'
import { z } from 'zod'

export function registerAutoUpdateHandlers(): void {
  const service = getAutoUpdateService()

  createSyncHandler(IPC_CHANNELS.AUTO_UPDATE.GET_STATE, () => {
    return service.getState()
  })

  createIpcHandler(IPC_CHANNELS.AUTO_UPDATE.CHECK_FOR_UPDATES, async () => {
    await service.checkForUpdates()
    return { success: true }
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.AUTO_UPDATE.DOWNLOAD_UPDATE, z.tuple([z.string().min(1).max(100)]), async (event, requestId) => {
    const operation = operationRequestRegistry.register(event.sender, requestId, {
      kind: 'update-download',
      label: 'Update download',
      context: service.getState().version ? `Version ${service.getState().version}` : undefined,
    })
    try {
      await service.downloadUpdate(operation.signal, progress => operation.update({
        phase: 'Downloading update',
        progress: { percentage: progress.percent, currentItem: `${Math.round(progress.bytesPerSecond / 1024)} KB/s` },
      }))
      operation.complete('completed', 'Update download finished.')
      return { success: true as const }
    } catch (error) {
      if (operation.signal.aborted) {
        operation.complete('cancelled', 'Update download cancelled.')
        return { cancelled: true as const }
      }
      operation.complete('failed', error instanceof Error ? error.message : 'Update download failed.')
      throw error
    } finally {
      operation.dispose()
    }
  })

  createIpcHandler(IPC_CHANNELS.AUTO_UPDATE.INSTALL_UPDATE, async () => {
    await service.installUpdate()
    return { success: true }
  })

  getLoggingService().info('[autoUpdate]', '[IPC] Auto-update handlers registered')
}

