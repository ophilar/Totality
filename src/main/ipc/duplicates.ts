import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcMain } from 'electron'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getDeduplicationService } from '@main/services/DeduplicationService'

export function registerDuplicateHandlers() {
  
  /**
   * Get all pending duplicates
   */
  ipcMain.handle(IPC_CHANNELS.DUPLICATES.GET_PENDING, async (_event, sourceId?: string) => {
    try {
      const db = getDatabase()
      return await db.duplicates.getPendingDuplicates(sourceId)
    } catch (error) {
      getLoggingService().error('[duplicates]', 'Error getting pending duplicates:', error)
      throw error
    }
  })

  /**
   * Scan for duplicates manually
   */
  ipcMain.handle(IPC_CHANNELS.DUPLICATES.SCAN, async (_event, sourceId?: string) => {
    try {
      const service = getDeduplicationService()
      return await service.scanForDuplicates(sourceId)
    } catch (error) {
      getLoggingService().error('[duplicates]', 'Error scanning for duplicates:', error)
      throw error
    }
  })

  /**
   * Get recommendation for a duplicate group
   */
  ipcMain.handle(IPC_CHANNELS.DUPLICATES.GET_RECOMMENDATION, async (_event, mediaItemIds: number[]) => {
    try {
      const service = getDeduplicationService()
      return service.recommendRetention(mediaItemIds)
    } catch (error) {
      getLoggingService().error('[duplicates]', 'Error getting duplicate recommendation:', error)
      throw error
    }
  })

  /**
   * Resolve a duplicate group
   */
  ipcMain.handle(IPC_CHANNELS.DUPLICATES.RESOLVE, async (_event, duplicateId: number, keepItemId: number, deleteOthers: boolean) => {
    try {
      const service = getDeduplicationService()
      return await service.resolveDuplicate(duplicateId, keepItemId, deleteOthers)
    } catch (error) {
      getLoggingService().error('[duplicates]', 'Error resolving duplicate:', error)
      throw error
    }
  })

  getLoggingService().info('[duplicates]', 'Duplicate IPC handlers registered')
}

