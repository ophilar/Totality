import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { getMovieCollectionService } from '../services/MovieCollectionService'
import { getWindowFromEvent } from './utils/safeSend'
import { createProgressUpdater } from './utils/progressUpdater'
import { validateInput, OptionalSourceIdSchema, PositiveIntSchema, NonEmptyStringSchema } from '../validation/schemas'
import { getTaskQueueService } from '../services/TaskQueueService'
import { createIpcHandler, createIpcHandlerWithEvent } from './utils/createHandler'

export function registerCollectionHandlers() {
  const service = getMovieCollectionService()

  // Analyze all movies for collection completeness
  // @param sourceId Optional source ID to scope analysis
  // @param libraryId Optional library ID to scope analysis
  createIpcHandlerWithEvent(IPC_CHANNELS.collectionsAnalyzeAll, async (event, sourceId?: unknown, libraryId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(NonEmptyStringSchema, sourceId, 'collections:analyzeAll.sourceId') : undefined
    const validLibraryId = libraryId !== undefined ? validateInput(NonEmptyStringSchema, libraryId, 'collections:analyzeAll.libraryId') : undefined

    // Guard: prevent concurrent analysis for the same source/library
    if (getTaskQueueService().hasActiveTask('collection-completeness', validSourceId, validLibraryId)) {
      throw new Error('A collection analysis is already in progress for this library')
    }

    const win = getWindowFromEvent(event)
    const { onProgress, flush } = createProgressUpdater(win, 'collections:progress', 'media')

    try {
      const result = await service.analyzeAllCollections((progress) => {
        onProgress(progress)
      }, validSourceId, validLibraryId)

      return { success: true, ...result }
    } finally {
      flush()
    }
  })

  // Cancel collections analysis
  createIpcHandler(IPC_CHANNELS.collectionsCancelAnalysis, async () => {
    service.cancel()
    return { success: true }
  })

  // Get all collections
  createIpcHandler(IPC_CHANNELS.collectionsGetAll, async (sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'collections:getAll.sourceId') : undefined
    return service.getCollections(validSourceId)
  })

  // Get incomplete collections only
  // @param sourceId Optional source ID to filter by
  createIpcHandler(IPC_CHANNELS.collectionsGetIncomplete, async (sourceId?: unknown) => {
    const validSourceId = sourceId !== undefined ? validateInput(OptionalSourceIdSchema, sourceId, 'collections:getIncomplete.sourceId') : undefined
    return service.getIncompleteCollections(validSourceId)
  })

  // Get collection stats
  createIpcHandler(IPC_CHANNELS.collectionsGetStats, async () => {
    return service.getStats()
  })

  // Delete a collection
  createIpcHandler(IPC_CHANNELS.collectionsDelete, async (id: unknown) => {
    const validId = validateInput(PositiveIntSchema, id, 'collections:delete.id')
    return service.deleteCollection(validId)
  })

  console.log('Movie collection IPC handlers registered')
}
