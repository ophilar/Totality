import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { z } from 'zod'
import { shell } from 'electron'
import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsByMediaItemSchema, CancelTranscodeSchema, SetSelectedGpuSchema, PreflightShowTranscodeSchema, QueueShowTranscodeSchema, NonEmptyStringSchema, SourceIdSchema, LibraryIdSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'
import type { TranscodeOptions } from '@main/services/TranscodingService'
import { getDatabase } from '@main/database/getDatabase'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'
import { getErrorMessage } from './utils'

const ShowQuarantineIdentitySchema = z.tuple([
  NonEmptyStringSchema,
  SourceIdSchema,
  NonEmptyStringSchema,
  LibraryIdSchema,
])

async function authorizedMediaPath(mediaItemId: number): Promise<string> {
  const db = getDatabase()
  const item = await db.media.getItemById(mediaItemId)
  if (!item?.file_path || !item.source_id) throw new Error('Media item has no local source path')
  const source = await db.sources.getSourceById(item.source_id)
  if (!source) throw new Error('Media source was not found')
  MediaPathAuthorization.assertMediaAuthorized(item, source)
  return item.file_path
}

export function registerTranscodingHandlers(): void {
  createIpcHandler(IPC_CHANNELS.transcodingCheckAvailability, async () => {
    return await getTranscodingService().checkAvailability()
  })

  createIpcHandler(IPC_CHANNELS.transcodingGetCapabilities, async () => {
    return await getTranscodingService().getCapabilities()
  })

  createIpcHandler(IPC_CHANNELS.transcodingRefreshCapabilities, async () => {
    return await getTranscodingService().getCapabilities({ refresh: true })
  })

  createValidatedIpcHandler(IPC_CHANNELS.transcodingSetSelectedGpu, SetSelectedGpuSchema, async (gpuId) => {
    return await getTranscodingService().setSelectedGpu(gpuId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.transcodingGetParameters, GetTranscodeParamsByMediaItemSchema, async (mediaItemId, options) => {
    const filePath = await authorizedMediaPath(mediaItemId)
    return await getTranscodingService().getTranscodeParameters(filePath, options as TranscodeOptions)
  })

  createValidatedIpcHandler(IPC_CHANNELS.transcodingCancel, CancelTranscodeSchema, async (mediaItemId) => {
    return getTranscodingService().cancelTranscode(mediaItemId)
  })

  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.transcodingPreflightShow, PreflightShowTranscodeSchema, async (event, request) => {
    const { requestId, ...preflightRequest } = request
    const operation = operationRequestRegistry.register(event.sender, requestId, {
      kind: 'optimization-preflight',
      label: 'Preflighting TV series',
      context: preflightRequest.seriesTitle ?? `Episode ${preflightRequest.mediaItemId}`,
    })
    try {
      const result = await getTranscodingService().preflightShowTranscode(preflightRequest, {
        signal: operation.signal,
        beginCommit: operation.beginCommit,
        waitUntilRunning: operation.waitUntilRunning,
        update: operation.update,
      })
      operation.complete('completed', 'Optimization review is ready')
      return result
    } catch (error) {
      getLoggingService().error('[TVOptimization]', `Preflight failed: series=${preflightRequest.seriesIdentityKey ?? 'episode'}, mediaItem=${preflightRequest.mediaItemId ?? 'all'}, source=${preflightRequest.sourceId}, library=${preflightRequest.libraryId ?? 'n/a'}:`, getErrorMessage(error))
      operation.complete(operation.signal.aborted ? 'cancelled' : 'failed', getErrorMessage(error))
      throw error
    } finally {
      operation.dispose()
    }
  })
  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.transcodingStartPreflightShow, PreflightShowTranscodeSchema, async (_event, request) => {
    const { requestId, ...preflightRequest } = request
    const operation = operationRequestRegistry.registerBackground(requestId, {
      kind: 'optimization-preflight',
      label: 'Preflighting TV series',
      context: preflightRequest.seriesTitle ?? `Episode ${preflightRequest.mediaItemId}`,
    })
    getLoggingService().info('[TVOptimization]', `Background preflight accepted: requestId=${requestId}, series=${preflightRequest.seriesIdentityKey ?? 'episode'}, mediaItem=${preflightRequest.mediaItemId ?? 'all'}`)
    void getTranscodingService().preflightShowTranscode(preflightRequest, {
      signal: operation.signal,
      beginCommit: operation.beginCommit,
      waitUntilRunning: operation.waitUntilRunning,
      update: operation.update,
    }).then(result => {
      operation.complete('completed', 'Optimization review is ready', { preflightId: result.preflightId })
    }).catch(error => {
      getLoggingService().error('[TVOptimization]', `Background preflight failed: series=${preflightRequest.seriesIdentityKey ?? 'episode'}, mediaItem=${preflightRequest.mediaItemId ?? 'all'}, source=${preflightRequest.sourceId}, library=${preflightRequest.libraryId ?? 'n/a'}:`, getErrorMessage(error))
      operation.complete(operation.signal.aborted ? 'cancelled' : 'failed', getErrorMessage(error))
    })
    return { requestId }
  })
  createValidatedIpcHandler(IPC_CHANNELS.transcodingPreflightRemux, z.number().int().positive(), async (mediaItemId) => getTranscodingService().preflightRemux(mediaItemId))
  createValidatedIpcHandler(IPC_CHANNELS.transcodingGetShowPreflight, NonEmptyStringSchema, async (preflightId) => getTranscodingService().getShowPreflight(preflightId))

  createValidatedIpcHandler(IPC_CHANNELS.transcodingDiscardShow, QueueShowTranscodeSchema, async (preflightId) => getTranscodingService().discardShowPreflight(preflightId))
  createValidatedIpcHandler(IPC_CHANNELS.transcodingOpenShowSample, z.tuple([NonEmptyStringSchema, z.number().int().positive(), z.number().int().nonnegative()]), async (preflightId, mediaItemId, index) => {
    const saved = await getDatabase().config.getSetting(`transcoding.preflight.${preflightId}`)
    if (!saved) throw new Error('Sample plan no longer exists')
    const plan = JSON.parse(saved) as { result: import('@main/services/TranscodingService').ShowTranscodePreflight }
    const sample = plan.result.episodes.find(episode => episode.mediaItemId === mediaItemId)?.samplePaths?.[index]
    if (!sample) throw new Error('Sample is not part of the reviewed plan')
    const error = await shell.openPath(sample)
    if (error) throw new Error(error)
  })

  createValidatedIpcHandler(IPC_CHANNELS.transcodingQueueShow, QueueShowTranscodeSchema, async (preflightId) => {
    return await getTranscodingService().queueShowTranscode(preflightId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.transcodingApproveShow, QueueShowTranscodeSchema, async (preflightId) => {
    return await getTranscodingService().approveShowTranscode(preflightId)
  })

  createValidatedIpcHandler(IPC_CHANNELS.transcodingListShowQuarantine, ShowQuarantineIdentitySchema, async (seriesTitle, sourceId, seriesIdentityKey, libraryId) => getTranscodingService().listShowQuarantine(seriesTitle, sourceId, seriesIdentityKey, libraryId))
  createValidatedIpcHandler(IPC_CHANNELS.transcodingPurgeShowQuarantine, ShowQuarantineIdentitySchema, async (seriesTitle, sourceId, seriesIdentityKey, libraryId) => getTranscodingService().purgeShowQuarantine(seriesTitle, sourceId, seriesIdentityKey, libraryId))

  getLoggingService().info('[transcoding]', 'Transcoding IPC handlers registered')
}
