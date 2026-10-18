import { IPC_CHANNELS } from '../../shared/ipcChannels'
/**
 * IPC Handlers for Auto Update System
 */

import { getAutoUpdateService } from '../services/AutoUpdateService'
import { createIpcHandler, createSyncHandler } from './utils/createHandler'

export function registerAutoUpdateHandlers(): void {
  const service = getAutoUpdateService()

  /**
   * Get current update state
   */
  createSyncHandler(IPC_CHANNELS.autoUpdateGetState, () => service.getState())

  /**
   * Manually check for updates
   */
  createIpcHandler(IPC_CHANNELS.autoUpdateCheckForUpdates, async () => {
    await service.checkForUpdates()
    return { success: true }
  })

  /**
   * Download the available update
   */
  createIpcHandler(IPC_CHANNELS.autoUpdateDownloadUpdate, async () => {
    await service.downloadUpdate()
    return { success: true }
  })

  /**
   * Quit and install the downloaded update
   */
  createIpcHandler(IPC_CHANNELS.autoUpdateInstallUpdate, async () => {
    await service.installUpdate()
    return { success: true }
  })

  console.log('[IPC] Auto-update handlers registered')
}
