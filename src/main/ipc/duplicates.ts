import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { getDeduplicationService } from '@main/services/DeduplicationService'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { z } from 'zod'
import { PositiveIntSchema } from '@main/validation/schemas'

export function registerDuplicateHandlers() {
  createIpcHandler(IPC_CHANNELS.DUPLICATES.GET_PENDING, async (sourceId?: string) => {
    return await getDatabase().duplicates.getPendingDuplicates(sourceId)
  })

  createIpcHandler(IPC_CHANNELS.DUPLICATES.SCAN, async (sourceId?: string) => {
    return await getDeduplicationService().scanForDuplicates(sourceId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DUPLICATES.GET_RECOMMENDATION, z.array(z.number()), async (ids) => {
    return getDeduplicationService().recommendRetention(ids)
  })

  createValidatedIpcHandler(IPC_CHANNELS.DUPLICATES.RESOLVE, z.tuple([PositiveIntSchema, PositiveIntSchema, z.boolean()]), async (duplicateId, keepItemId, deleteOthers) => {
    return await getDeduplicationService().resolveDuplicate(duplicateId, keepItemId, deleteOthers)
  })

  getLoggingService().info('[duplicates]', 'Duplicate IPC handlers registered')
}

