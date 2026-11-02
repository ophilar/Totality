import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getDeduplicationService } from '@main/services/DeduplicationService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'
import { z } from 'zod'
import { PositiveIntSchema } from '@main/validation/schemas'

export function registerDuplicateHandlers() {
  createIpcHandler(IPC_CHANNELS.DUPLICATES.GET_PENDING, async (sourceId?: string) => {
    return await getDatabase().duplicates.getPendingDuplicates(sourceId)
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.DUPLICATES.SCAN, z.tuple([z.string().optional(), z.string().min(1).max(100)]), async (event, sourceId, requestId) => {
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

  createValidatedIpcHandler(IPC_CHANNELS.DUPLICATES.GET_RECOMMENDATION, z.array(z.number()), async (ids) => {
    return getDeduplicationService().recommendRetention(ids)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DUPLICATES.RESOLVE, z.tuple([PositiveIntSchema, PositiveIntSchema, z.boolean()]), async (duplicateId, keepItemId, deleteOthers) => {
    return await getDeduplicationService().resolveDuplicate(duplicateId, keepItemId, deleteOthers)
  })

  getLoggingService().info('[duplicates]', 'Duplicates IPC handlers registered')
}

