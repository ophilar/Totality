import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getMovieCollectionService } from '@main/services/MovieCollectionService'
import { OptionalSourceIdSchema, PositiveIntSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getStatsCacheService } from '@main/services/StatsCacheService'

export function registerCollectionHandlers(): void {
  const service = getMovieCollectionService()

  createValidatedIpcHandler(IPC_CHANNELS.COLLECTIONS.ANALYZE_ALL, OptionalSourceIdSchema, async (sourceId) => {
    const result = { success: true, result: await service.analyzeAllCollections(sourceId) }
    getStatsCacheService().invalidate()
    return result
  })

  createIpcHandler(IPC_CHANNELS.COLLECTIONS.CANCEL_ANALYSIS, async () => {
    service.cancel()
    return { success: true }
  })

  createValidatedIpcHandler(IPC_CHANNELS.COLLECTIONS.GET_ALL, OptionalSourceIdSchema, async (sourceId) => {
    return await service.getCollections(sourceId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.COLLECTIONS.GET_INCOMPLETE, OptionalSourceIdSchema, async (sourceId) => {
    return await service.getIncompleteCollections(sourceId)
  })

  createIpcHandler(IPC_CHANNELS.COLLECTIONS.GET_STATS, async () => {
    return await getStatsCacheService().getCollectionStats(() => service.getStats())
  })

  createValidatedIpcHandler(IPC_CHANNELS.COLLECTIONS.DELETE, PositiveIntSchema, async (id) => {
    await service.deleteCollection(id)
    getStatsCacheService().invalidate()
    return { success: true }
  })

  getLoggingService().info('[collections]', 'Movie collection IPC handlers registered')
}

