import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsSchema, TranscodeMediaItemSchema, CancelTranscodeSchema, SetSelectedGpuSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import type { TranscodeOptions } from '@main/services/TranscodingService'

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

  createIpcHandler('handbrake:getVersion', async () => {
    return await getTranscodingService().getVersion()
  })


  createValidatedIpcHandler('transcoding:getParameters', GetTranscodeParamsSchema, async (filePath, options) => {
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

  getLoggingService().info('[transcoding]', 'Transcoding IPC handlers registered')
}

