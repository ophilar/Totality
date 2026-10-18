import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { getDatabase } from '../database/getDatabase'
import { getLoggingService } from '../services/LoggingService'
import { getDeduplicationService } from '../services/DeduplicationService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from './utils/createHandler'
import { operationRequestRegistry } from './utils/OperationRequestRegistry'
import { z } from 'zod'
import { PositiveIntSchema } from '../validation/schemas'

export function registerDuplicateHandlers() {
  createIpcHandler(IPC_CHANNELS.duplicatesGetPending, async (sourceId?: string) => {
    return getDatabase().getPendingDuplicates(sourceId)
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.duplicatesScan, z.tuple([z.string().optional(), z.string().min(1).max(100)]), async (event, sourceId, requestId) => {
    const operation = operationRequestRegistry.register(event.sender, requestId, {
      kind: 'duplicate-scan',
      label: 'Duplicate scan',
      context: sourceId ? `Source ${sourceId}` : 'All sources',
    })
    try {
      operation.update({ phase: 'Comparing library identities' })
      const count = await getDeduplicationService().scanForDuplicates(sourceId, operation.signal, operation.beginCommit)
      operation.complete('completed', `Found ${count} duplicate groups.`, { duplicateGroupCount: count })
      return count
    } catch (error) {
      if (operation.signal.aborted) {
        operation.complete('cancelled', 'Duplicate scan cancelled before commit.')
        return { cancelled: true as const }
      }
      operation.complete('failed', error instanceof Error ? error.message : 'Duplicate scan failed.')
      throw error
    } finally {
      operation.dispose()
    }
  })

  createValidatedIpcHandler(IPC_CHANNELS.duplicatesGetRecommendation, z.array(z.number()), async (ids) => {
    return getDeduplicationService().recommendRetention(ids)
  })

  createValidatedIpcHandler(IPC_CHANNELS.duplicatesResolve, z.tuple([PositiveIntSchema, PositiveIntSchema, z.boolean()]), async (duplicateId, keepItemId, deleteOthers) => {
    return await getDeduplicationService().resolveDuplicate(duplicateId, keepItemId, deleteOthers)
  })

  getLoggingService().info('[duplicates]', 'Duplicates IPC handlers registered')
}
