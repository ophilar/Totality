import { ipcMain } from 'electron'
import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from '../services/LoggingService'
import { getDeduplicationService } from '../services/DeduplicationService'

export function registerDuplicateHandlers() {
  
  /**
   * Get all pending duplicates
   */
  ipcMain.handle('duplicates:getPending', async (_event, sourceId?: string) => {
    try {
      const db = getDatabase()
      return db.duplicateRepo.getPendingDuplicates(sourceId)
    } catch (error) {
      getLoggingService().error('[duplicates]', 'Error getting pending duplicates:', error)
      throw error
    }
  })

  /**
   * Scan for duplicates manually
   */
  ipcMain.handle('duplicates:scan', async (_event, sourceId?: string) => {
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
  ipcMain.handle('duplicates:getRecommendation', async (_event, mediaItemIds: number[]) => {
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
  ipcMain.handle('duplicates:resolve', async (_event, duplicateId: number, keepItemId: number, deleteOthers: boolean) => {
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
