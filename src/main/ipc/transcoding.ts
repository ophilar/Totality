import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { z } from 'zod'
import { shell } from 'electron'
import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsByMediaItemSchema, CancelTranscodeSchema, SetSelectedGpuSchema, PreflightShowTranscodeSchema, QueueShowTranscodeSchema, NonEmptyStringSchema, SourceIdSchema, LibraryIdSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import type { ShowTranscodeRequest, TranscodeOptions } from '@main/services/TranscodingService'
import { getDatabase } from '@main/database/getDatabase'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'
import { getErrorMessage } from './utils'
import { getTaskQueueService } from '@main/services/TaskQueueService'

const ShowQuarantineIdentitySchema = z.tuple([
  NonEmptyStringSchema,
  SourceIdSchema,
  NonEmptyStringSchema,
  LibraryIdSchema,
])
const FindShowPreflightSchema = z.tuple([
  NonEmptyStringSchema,
  SourceIdSchema,
  LibraryIdSchema,
  NonEmptyStringSchema,
  z.number().int().positive().optional(),
  z.number().int().nonnegative().optional(),
])

const BACKGROUND_PREFLIGHT_SETTING_PREFIX = 'transcoding.backgroundPreflight.'

interface PersistedBackgroundPreflight {
  request: ShowTranscodeRequest
  preflightId: string
  batchId: string
  activity?: { state?: string; outcome?: { message?: string } }
}

function queuePreflight(requestId: string, preflightRequest: ShowTranscodeRequest, preflightId = `preflight_${requestId}`, batchId = `batch_${requestId}`): string {
  const mediaItem = preflightRequest.mediaItemId === undefined
    ? null
    : getDatabase().media.getItemById(preflightRequest.mediaItemId)
  const seriesTitle = preflightRequest.seriesTitle ?? mediaItem?.series_title
  const episodeCoordinates = mediaItem?.season_number != null && mediaItem.episode_number != null
    ? `S${String(mediaItem.season_number).padStart(2, '0')}E${String(mediaItem.episode_number).padStart(2, '0')}`
    : undefined
  const episodeDescription = [seriesTitle, episodeCoordinates, mediaItem?.title]
    .filter((part): part is string => Boolean(part))
    .join(' · ')
  const target = mediaItem?.type === 'movie'
    ? `movie: ${mediaItem.title}${mediaItem.year ? ` (${mediaItem.year})` : ''}`
    : preflightRequest.mediaItemId !== undefined
      ? `TV episode: ${episodeDescription || `media item ${preflightRequest.mediaItemId}`}`
      : preflightRequest.seasonNumber !== undefined
        ? `TV season: ${seriesTitle ? `${seriesTitle} · ` : ''}Season ${preflightRequest.seasonNumber}`
        : `TV show${seriesTitle ? `: ${seriesTitle}` : ''}`
  const taskId = getTaskQueueService().addTask({
    type: 'optimization-preflight',
    label: `Preflight ${target}`,
    sourceId: preflightRequest.sourceId,
    libraryId: preflightRequest.libraryId,
    mediaItemId: preflightRequest.mediaItemId,
    batchId,
    options: { requestId, request: preflightRequest, preflightId, batchId, mediaType: mediaItem?.type },
  })
  if (!taskId) throw new Error('Optimization preflight could not be added to the task queue')
  return taskId
}

export function resumeBackgroundPreflights(): void {
  const pending = Object.entries(getDatabase().config.getAllSettings())
    .filter(([key]) => key.startsWith(BACKGROUND_PREFLIGHT_SETTING_PREFIX))
  for (const [key, raw] of pending) {
    const requestId = key.slice(BACKGROUND_PREFLIGHT_SETTING_PREFIX.length)
    try {
      const saved = JSON.parse(raw) as Partial<PersistedBackgroundPreflight>
      let record: PersistedBackgroundPreflight
      if (saved.request && saved.preflightId && saved.batchId) {
        record = saved as PersistedBackgroundPreflight
      } else {
        const legacy = PreflightShowTranscodeSchema.safeParse([{ ...saved, requestId }])
        if (!legacy.success) throw new Error('Background preflight record is incomplete')
        const [{ requestId: parsedRequestId, ...request }] = legacy.data
        if (parsedRequestId !== requestId) throw new Error('Background preflight identity does not match its saved key')
        record = { request, preflightId: `preflight_${requestId}`, batchId: `batch_${requestId}` }
        getDatabase().config.setSetting(key, JSON.stringify(record))
      }
      if (!record.request || !record.preflightId || !record.batchId) throw new Error('Background preflight record is incomplete')
      const interruptedForShutdown = record.activity?.state === 'partial' && record.activity.outcome?.message === 'Interrupted because the app is closing. Saved progress will resume on next launch.'
      if (record.activity?.outcome && !interruptedForShutdown) continue
      queuePreflight(requestId, record.request, record.preflightId, record.batchId)
    } catch (error) {
      getLoggingService().error('[TVOptimization]', `Could not resume background preflight record: key=${key}`, getErrorMessage(error))
    }
  }
}

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

  createValidatedIpcHandler(IPC_CHANNELS.transcodingPreflightShow, PreflightShowTranscodeSchema, async (request) => {
    const { requestId, ...preflightRequest } = request
    const taskId = queuePreflight(requestId, preflightRequest)
    const task = await getTaskQueueService().waitForTask(taskId)
    if (task.status !== 'completed') throw new Error(task.error ?? 'Optimization preflight was cancelled')
    if (typeof task.result?.preflightId !== 'string') throw new Error('Completed optimization preflight has no saved review identifier')
    const saved = await getTranscodingService().getShowPreflight(task.result.preflightId)
    if (!saved) throw new Error('Completed optimization review could not be found')
    return saved.result
  })
  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.transcodingStartPreflightShow, PreflightShowTranscodeSchema, async (_event, request) => {
    const { requestId, ...preflightRequest } = request
    const taskId = queuePreflight(requestId, preflightRequest)
    return { requestId, taskId }
  })
  createValidatedIpcHandler(IPC_CHANNELS.transcodingPreflightRemux, z.number().int().positive(), async (mediaItemId) => getTranscodingService().preflightRemux(mediaItemId))
  createValidatedIpcHandler(IPC_CHANNELS.transcodingGetShowPreflight, NonEmptyStringSchema, async (preflightId) => getTranscodingService().getShowPreflight(preflightId))
  createValidatedIpcHandler(IPC_CHANNELS.transcodingFindShowPreflight, FindShowPreflightSchema, async (seriesIdentityKey, sourceId, libraryId, seriesTitle, mediaItemId, seasonNumber) => getTranscodingService().findLatestShowPreflight({ seriesIdentityKey, sourceId, libraryId, seriesTitle, mediaItemId, seasonNumber }))

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
