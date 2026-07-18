import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsSchema, TranscodeMediaItemSchema, CancelTranscodeSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'

import { GpuDetector } from '@main/services/utils/GpuDetector'

export function registerTranscodingHandlers(): void {
  createIpcHandler('transcoding:checkAvailability', async () => {
    return await getTranscodingService().checkAvailability()
  })

  createIpcHandler('handbrake:getVersion', async () => {
    return await getTranscodingService().getVersion()
  })

  createIpcHandler('gpus:list', async () => {
    return await GpuDetector.detectGpus()
  })

  createValidatedIpcHandler('transcoding:getParameters', GetTranscodeParamsSchema, async (filePath, options) => {
    return await getTranscodingService().getTranscodeParameters(filePath, options as any)
  })

  createValidatedIpcHandlerWithEvent('transcoding:start', TranscodeMediaItemSchema, async (event, mediaItemId, options) => {
    return await getTranscodingService().transcode(mediaItemId, options as any, (p) => {
      event.sender.send('transcoding:progress', { mediaItemId, ...p })
    })
  })

  createValidatedIpcHandler('transcoding:cancel', CancelTranscodeSchema, async (mediaItemId) => {
    return getTranscodingService().cancelTranscode(mediaItemId)
  })

  getLoggingService().info('[transcoding]', 'Transcoding IPC handlers registered')
}

