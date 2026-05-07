import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { ipcMain } from 'electron'
import { getMovieCollectionService } from '@main/services/MovieCollectionService'
import { validateInput, OptionalSourceIdSchema, PositiveIntSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'

/**
 * Register all movie collection-related IPC handlers
 */
export function registerCollectionHandlers(): void {
  const service = getMovieCollectionService()

  /**
   * Analyze all movie collections in the library
   */
  ipcMain.handle(IPC_CHANNELS.COLLECTIONS.ANALYZE_ALL, async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'collections:analyzeAll')
      const result = await service.analyzeAllCollections(validSourceId)
      return { success: true, result }
    } catch (error) {
      getLoggingService().error('[collections]', 'Error analyzing collections:', error)
      throw error
    }
  })

  /**
   * Cancel in-progress collection analysis
   */
  ipcMain.handle(IPC_CHANNELS.COLLECTIONS.CANCEL_ANALYSIS, () => {
    service.cancel()
    return { success: true }
  })

  /**
   * Get all movie collections
   */
  ipcMain.handle(IPC_CHANNELS.COLLECTIONS.GET_ALL, async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'collections:getAll')
      return await service.getCollections(validSourceId)
    } catch (error) {
      getLoggingService().error('[collections]', 'Error getting collections:', error)
      return []
    }
  })

  /**
   * Get incomplete movie collections
   */
  ipcMain.handle(IPC_CHANNELS.COLLECTIONS.GET_INCOMPLETE, async (_event, sourceId?: unknown) => {
    try {
      const validSourceId = validateInput(OptionalSourceIdSchema, sourceId, 'collections:getIncomplete')
      return await service.getIncompleteCollections(validSourceId)
    } catch (error) {
      getLoggingService().error('[collections]', 'Error getting incomplete collections:', error)
      return []
    }
  })

  /**
   * Get collection stats
   */
  ipcMain.handle(IPC_CHANNELS.COLLECTIONS.GET_STATS, async () => {
    try {
      return await service.getStats()
    } catch (error) {
      getLoggingService().error('[collections]', 'Error getting collection stats:', error)
      return { total: 0, complete: 0 }
    }
  })

  /**
   * Delete a collection record
   */
  ipcMain.handle(IPC_CHANNELS.COLLECTIONS.DELETE, async (_event, id: unknown) => {
    try {
      const validId = validateInput(PositiveIntSchema, id, 'collections:delete')
      await service.deleteCollection(validId)
      return { success: true }
    } catch (error) {
      getLoggingService().error('[collections]', 'Error deleting collection:', error)
      throw error
    }
  })
}

