import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsByMediaItemSchema, TranscodeMediaItemSchema, CancelTranscodeSchema, SetSelectedGpuSchema, PreflightShowTranscodeSchema, QueueShowTranscodeSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import type { TranscodeOptions } from '@main/services/TranscodingService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'

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
  createIpcHandler('transcoding:checkAvailability', async () => {
    return await getTranscodingService().checkAvailability()
  })

  createIpcHandler('transcoding:getCapabilities', async () => {
    return await getTranscodingService().getCapabilities()
  })

  createIpcHandler('transcoding:refreshCapabilities', async () => {
    return await getTranscodingService().getCapabilities({ refresh: true })
  })

  createValidatedIpcHandler('transcoding:setSelectedGpu', SetSelectedGpuSchema, async (gpuId) => {
    return await getTranscodingService().setSelectedGpu(gpuId)
  })


  createValidatedIpcHandler('transcoding:getParameters', GetTranscodeParamsByMediaItemSchema, async (mediaItemId, options) => {
    const filePath = await authorizedMediaPath(mediaItemId)
    return await getTranscodingService().getTranscodeParameters(filePath, options as TranscodeOptions)
  })

  createValidatedIpcHandlerWithEvent('transcoding:start', TranscodeMediaItemSchema, async (event, mediaItemId, options) => {
    return await getTranscodingService().transcode(mediaItemId, options as TranscodeOptions, (p) => {
      event.sender.send('transcoding:progress', { mediaItemId, ...p })
    })
  })

  createValidatedIpcHandler('transcoding:cancel', CancelTranscodeSchema, async (mediaItemId) => {
    return getTranscodingService().cancelTranscode(mediaItemId)
  })

  createValidatedIpcHandler('transcoding:preflightShow', PreflightShowTranscodeSchema, async (request) => {
    return await getTranscodingService().preflightShowTranscode(request)
  })

  createValidatedIpcHandler('transcoding:queueShow', QueueShowTranscodeSchema, async (preflightId) => {
    return await getTranscodingService().queueShowTranscode(preflightId)
  })

  createValidatedIpcHandler('transcoding:approveShow', QueueShowTranscodeSchema, async (preflightId) => {
    return await getTranscodingService().approveShowTranscode(preflightId)
  })

  getLoggingService().info('[transcoding]', 'Transcoding IPC handlers registered')
}

