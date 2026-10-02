import { z } from 'zod'
import { shell } from 'electron'
import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsByMediaItemSchema, CancelTranscodeSchema, SetSelectedGpuSchema, PreflightShowTranscodeSchema, QueueShowTranscodeSchema, NonEmptyStringSchema, SourceIdSchema, LibraryIdSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import type { TranscodeOptions } from '@main/services/TranscodingService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'

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

  createValidatedIpcHandler('transcoding:cancel', CancelTranscodeSchema, async (mediaItemId) => {
    return getTranscodingService().cancelTranscode(mediaItemId)
  })

  createValidatedIpcHandler('transcoding:preflightShow', PreflightShowTranscodeSchema, async (request) => {
    return await getTranscodingService().preflightShowTranscode(request)
  })

  createValidatedIpcHandler('transcoding:discardShow', QueueShowTranscodeSchema, async (preflightId) => getTranscodingService().discardShowPreflight(preflightId))
  createValidatedIpcHandler('transcoding:openShowSample', z.tuple([NonEmptyStringSchema, z.number().int().positive(), z.number().int().nonnegative()]), async (preflightId, mediaItemId, index) => {
    const saved = await getDatabase().config.getSetting(`transcoding.preflight.${preflightId}`)
    if (!saved) throw new Error('Sample plan no longer exists')
    const plan = JSON.parse(saved) as { result: import('@main/services/TranscodingService').ShowTranscodePreflight }
    const sample = plan.result.episodes.find(episode => episode.mediaItemId === mediaItemId)?.samplePaths?.[index]
    if (!sample) throw new Error('Sample is not part of the reviewed plan')
    const error = await shell.openPath(sample)
    if (error) throw new Error(error)
  })

  createValidatedIpcHandler('transcoding:queueShow', QueueShowTranscodeSchema, async (preflightId) => {
    return await getTranscodingService().queueShowTranscode(preflightId)
  })

  createValidatedIpcHandler('transcoding:approveShow', QueueShowTranscodeSchema, async (preflightId) => {
    return await getTranscodingService().approveShowTranscode(preflightId)
  })

  createValidatedIpcHandler('transcoding:listShowQuarantine', ShowQuarantineIdentitySchema, async (seriesTitle, sourceId, seriesIdentityKey, libraryId) => getTranscodingService().listShowQuarantine(seriesTitle, sourceId, seriesIdentityKey, libraryId))
  createValidatedIpcHandler('transcoding:purgeShowQuarantine', ShowQuarantineIdentitySchema, async (seriesTitle, sourceId, seriesIdentityKey, libraryId) => getTranscodingService().purgeShowQuarantine(seriesTitle, sourceId, seriesIdentityKey, libraryId))

  getLoggingService().info('[transcoding]', 'Transcoding IPC handlers registered')
}
