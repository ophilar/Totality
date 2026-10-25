import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { z } from 'zod'
import { shell } from 'electron'
import { getTranscodingService } from '@main/services/TranscodingService'
import { GetTranscodeParamsByMediaItemSchema, CancelTranscodeSchema, SetSelectedGpuSchema, PreflightShowTranscodeSchema, QueueShowTranscodeSchema, NonEmptyStringSchema, SourceIdSchema, LibraryIdSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler, createValidatedIpcHandlerWithEvent } from '@main/ipc/utils/createHandler'
import { operationRequestRegistry } from '@main/ipc/utils/OperationRequestRegistry'
import type { ActivityOperation } from '@main/ipc/utils/OperationRequestRegistry'
import type { ShowTranscodePreflight, ShowTranscodeRequest, TranscodeOptions } from '@main/services/TranscodingService'
import { getDatabase } from '@main/database/getDatabase'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'
import { getErrorMessage } from './utils'

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
])

const BACKGROUND_PREFLIGHT_SETTING_PREFIX = 'transcoding.backgroundPreflight.'
const PREFLIGHT_CHECKPOINT_SETTING_PREFIX = 'transcoding.preflightCheckpoint.'
const PREFLIGHT_SHUTDOWN_MESSAGE = 'Interrupted because the app is closing. Saved progress will resume on next launch.'
const backgroundPreflightWork = new Map<string, Promise<void>>()

interface PersistedBackgroundPreflight {
  request: ShowTranscodeRequest
  preflightId: string
  batchId: string
  activity?: ActivityOperation
}

function checkpointSettingKey(requestId: string, mediaItemId: number): string {
  return `${PREFLIGHT_CHECKPOINT_SETTING_PREFIX}${requestId}.${mediaItemId}`
}

function launchBackgroundPreflight(requestId: string, record: PersistedBackgroundPreflight): Promise<ShowTranscodePreflight | undefined> {
  const { request: preflightRequest } = record
  const shutdownInterrupted = record.activity?.state === 'partial' && record.activity.outcome?.message === PREFLIGHT_SHUTDOWN_MESSAGE
  if (record.activity && (!record.activity.outcome || shutdownInterrupted)) {
    record.activity = { ...record.activity, state: 'running', phase: record.activity.phase ? `Resuming · ${record.activity.phase}` : 'Resuming preflight' }
    record.activity.outcome = undefined
  }
  const operation = operationRequestRegistry.registerBackground(requestId, {
    kind: 'optimization-preflight',
    label: 'Preflighting TV series',
    context: preflightRequest.seriesTitle ?? `Episode ${preflightRequest.mediaItemId}`,
    entity: {
      seriesTitle: preflightRequest.seriesTitle,
      seriesIdentityKey: preflightRequest.seriesIdentityKey,
      sourceId: preflightRequest.sourceId,
      libraryId: preflightRequest.libraryId,
      mediaItemId: preflightRequest.mediaItemId,
    },
  }, activity => {
    record.activity = activity
    getDatabase().config.setSetting(`${BACKGROUND_PREFLIGHT_SETTING_PREFIX}${requestId}`, JSON.stringify(record))
  }, record.activity)
  if (record.activity?.outcome) return Promise.resolve(undefined)
  getLoggingService().info('[TVOptimization]', `Background preflight started: requestId=${requestId}, series=${preflightRequest.seriesIdentityKey ?? 'episode'}, mediaItem=${preflightRequest.mediaItemId ?? 'all'}`)
  let completed = false
  const work = getTranscodingService().preflightShowTranscode(preflightRequest, {
    signal: operation.signal,
    beginCommit: operation.beginCommit,
    waitUntilRunning: operation.waitUntilRunning,
    update: operation.update,
    preflightId: record.preflightId,
    batchId: record.batchId,
    loadEpisodeCheckpoint: async mediaItemId => {
      const key = checkpointSettingKey(requestId, mediaItemId)
      const raw = await getDatabase().config.getSetting(key)
      if (!raw) return undefined
      try {
        const checkpoint = JSON.parse(raw) as import('@main/services/TranscodingService').ShowTranscodeEpisodeCheckpoint
        if (checkpoint.version === 1 && checkpoint.plan?.mediaItemId === mediaItemId) return checkpoint
      } catch (error) {
        getLoggingService().warn('[TVOptimization]', `Discarding unreadable episode checkpoint: requestId=${requestId}, mediaItem=${mediaItemId}, reason=${getErrorMessage(error)}`)
        await getDatabase().config.deleteSetting(key)
        return undefined
      }
      getLoggingService().warn('[TVOptimization]', `Discarding unsupported episode checkpoint: requestId=${requestId}, mediaItem=${mediaItemId}`)
      await getDatabase().config.deleteSetting(key)
      return undefined
    },
    saveEpisodeCheckpoint: async (mediaItemId, checkpoint) => {
      getDatabase().config.setSetting(checkpointSettingKey(requestId, mediaItemId), JSON.stringify(checkpoint))
    },
  }).then(result => {
    completed = true
    operation.complete('completed', 'Optimization review is ready', { preflightId: result.preflightId })
    return result
  }).catch(error => {
    const outcome = getErrorMessage(error)
    if (operation.signal.aborted) {
      const interruptedByShutdown = operation.signal.reason instanceof DOMException && operation.signal.reason.message === 'Application is shutting down'
      getLoggingService().info('[TVOptimization]', `Background preflight ${interruptedByShutdown ? 'interrupted for shutdown' : 'cancelled'}: requestId=${requestId}, series=${preflightRequest.seriesIdentityKey ?? 'episode'}, mediaItem=${preflightRequest.mediaItemId ?? 'all'}`)
      operation.complete(interruptedByShutdown ? 'partial' : 'cancelled', interruptedByShutdown ? PREFLIGHT_SHUTDOWN_MESSAGE : outcome)
    } else {
      getLoggingService().error('[TVOptimization]', `Background preflight failed: series=${preflightRequest.seriesIdentityKey ?? 'episode'}, mediaItem=${preflightRequest.mediaItemId ?? 'all'}, source=${preflightRequest.sourceId}, library=${preflightRequest.libraryId ?? 'n/a'}:`, outcome)
      operation.complete('failed', outcome)
    }
    throw error
  }).finally(() => {
    if (!completed) return
    try {
      const checkpointKeys = Object.keys(getDatabase().config.getAllSettings()).filter(key => key.startsWith(`${PREFLIGHT_CHECKPOINT_SETTING_PREFIX}${requestId}.`))
      for (const key of checkpointKeys) getDatabase().config.deleteSetting(key)
    } catch (error) {
      getLoggingService().error('[TVOptimization]', `Could not remove completed preflight checkpoints: requestId=${requestId}`, getErrorMessage(error))
    }
  })
  const trackedWork = work.then(() => undefined, () => undefined)
  backgroundPreflightWork.set(requestId, trackedWork)
  void trackedWork.then(() => backgroundPreflightWork.delete(requestId))
  return work
}

export async function stopBackgroundPreflightsForShutdown(): Promise<void> {
  operationRequestRegistry.interruptBackgroundOperations()
  await Promise.all(backgroundPreflightWork.values())
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
      getLoggingService().info('[TVOptimization]', `Resuming interrupted background preflight: requestId=${requestId}`)
      void launchBackgroundPreflight(requestId, record).catch(error => {
        getLoggingService().error('[TVOptimization]', `Could not resume background preflight: requestId=${requestId}`, getErrorMessage(error))
      })
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
    const record: PersistedBackgroundPreflight = { request: preflightRequest, preflightId: `preflight_${requestId}`, batchId: `batch_${requestId}` }
    await getDatabase().config.setSetting(`${BACKGROUND_PREFLIGHT_SETTING_PREFIX}${requestId}`, JSON.stringify(record))
    return await launchBackgroundPreflight(requestId, record)
  })
  createValidatedIpcHandlerWithEvent(IPC_CHANNELS.transcodingStartPreflightShow, PreflightShowTranscodeSchema, async (_event, request) => {
    const { requestId, ...preflightRequest } = request
    const record: PersistedBackgroundPreflight = { request: preflightRequest, preflightId: `preflight_${requestId}`, batchId: `batch_${requestId}` }
    await getDatabase().config.setSetting(`${BACKGROUND_PREFLIGHT_SETTING_PREFIX}${requestId}`, JSON.stringify(record))
    void launchBackgroundPreflight(requestId, record).catch(error => {
      getLoggingService().error('[TVOptimization]', `Background preflight failed after the start request was accepted: requestId=${requestId}`, getErrorMessage(error))
    })
    return { requestId }
  })
  createValidatedIpcHandler(IPC_CHANNELS.transcodingPreflightRemux, z.number().int().positive(), async (mediaItemId) => getTranscodingService().preflightRemux(mediaItemId))
  createValidatedIpcHandler(IPC_CHANNELS.transcodingGetShowPreflight, NonEmptyStringSchema, async (preflightId) => getTranscodingService().getShowPreflight(preflightId))
  createValidatedIpcHandler(IPC_CHANNELS.transcodingFindShowPreflight, FindShowPreflightSchema, async (seriesIdentityKey, sourceId, libraryId, seriesTitle, mediaItemId) => getTranscodingService().findLatestShowPreflight({ seriesIdentityKey, sourceId, libraryId, seriesTitle, mediaItemId }))

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
