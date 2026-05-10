import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsSchema, TranscodeMediaItemSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'

export function registerTranscodingHandlers(): void {
  createIpcHandler('transcoding:checkAvailability', async () => {
    return await getTranscodingService().checkAvailability()
  })

  createValidatedIpcHandler('transcoding:getParameters', GetTranscodeParamsSchema, async (filePath, options) => {
    return await getTranscodingService().getTranscodeParameters(filePath, options as any)
  })

  createValidatedIpcHandlerWithEvent('transcoding:start', TranscodeMediaItemSchema, async (event, mediaItemId, options) => {
    return await getTranscodingService().transcode(mediaItemId, options as any, (p) => {
      event.sender.send('transcoding:progress', { mediaItemId, ...p })
    })
  })

  getLoggingService().info('[transcoding]', 'Transcoding IPC handlers registered')
}

