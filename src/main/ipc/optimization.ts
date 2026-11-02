import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'
import { getMediaFileAnalyzer, type AnalyzedAudioStream } from '@main/services/MediaFileAnalyzer'
import { MediaPathAuthorization } from '@main/services/MediaPathAuthorization'
import {
  buildOptimizationDecision,
  buildUnavailableOptimizationDecision,
  type OptimizationDecisionAudioTrack,
} from '@main/services/OptimizationDecisionService'
import { getLoggingService } from '@main/services/LoggingService'

const config = z.object({ baseUrl: z.string().url(), apiKey: z.string().min(1), timeoutMs: z.number().int().positive().optional() })
const pendingRecord = z.object({ requestedAt: z.string(), seriesId: z.number().int().positive(), commandId: z.number().int().nullable(), state: z.literal('awaiting-rescan') })

async function getMediaItemAndSource(db: ReturnType<typeof getDatabase>, mediaItemId: number) {
  const item = await db.media.getItemById(mediaItemId)
  if (!item || !item.file_path || !item.source_id) throw new Error('Media item has no local source path')
  const source = await db.sources.getSourceById(item.source_id)
  if (!source) throw new Error('Media source was not found')
  return { item: item as typeof item & { file_path: string }, source }
}

function mapAnalysisAudioTracksToDecisionTracks(audioTracks: AnalyzedAudioStream[]): OptimizationDecisionAudioTrack[] {
  return audioTracks.map(track => ({
    index: track.index,
    language: track.language,
    title: track.title,
    codec: track.codec,
    channels: track.channels,
    channelLayout: track.channelLayout,
    bitrate: track.bitrate,
    isDefault: track.isDefault,
    hasObjectAudio: track.hasObjectAudio,
    reliableTag: Boolean(track.language),
    isCommentary: track.isCommentary,
    isAudioDescription: track.isAudioDescription,
    isAccessibility: track.isAccessibility,
  }))
}

export function registerOptimizationHandlers() {
  const db = getDatabase()
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.REQUEST_ARR_SEARCH, z.tuple([z.number().int().positive(), z.boolean()]), async (seriesId, optIn) => {
    if (!optIn) throw new Error('Opt-in is required before requesting an Arr search')
    const baseUrl = await db.config.getSetting('arr_base_url'), apiKey = await db.config.getSetting('arr_api_key')
    if (!baseUrl || !apiKey) throw new Error('Arr integration is not configured in main-process settings')
    const arrConfig = config.parse({ baseUrl, apiKey })
    const key = `optimization.pending.arr.series.${seriesId}`
    const pending = await db.config.getSetting(key)
    if (pending) return { state: 'awaiting-rescan', pending: pendingRecord.parse(JSON.parse(pending)) }
    const command = await new ArrIntegrationService(arrConfig).searchSeries(seriesId)
    const record = { requestedAt: new Date().toISOString(), seriesId, commandId: command.id ?? null, state: 'awaiting-rescan' }
    await db.config.setSetting(key, JSON.stringify(record))
    return record
  })
  createIpcHandler(IPC_CHANNELS.OPTIMIZATION.GET_PENDING, async () => {
    const settings = await db.config.getAllSettings()
    return Object.entries(settings)
      .filter(([key]) => key.startsWith('optimization.pending.'))
      .flatMap(([key, value]) => {
        try {
          return [{ key, value: pendingRecord.parse(JSON.parse(String(value))) }]
        } catch (error) {
          getLoggingService().warn('[optimization]', `Failed to parse pending optimization record for key ${key}:`, error)
          return []
        }
      })
  })
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.GET_REMUX_JOB, z.number().int().positive(), async mediaItemId => db.mediaRemuxJobs.getLatest(mediaItemId))
  createValidatedIpcHandler(IPC_CHANNELS.OPTIMIZATION.GET_DECISION, z.number().int().positive(), async mediaItemId => {
    const { item, source } = await getMediaItemAndSource(db, mediaItemId)

    try {
      MediaPathAuthorization.assertMediaAuthorized(item, source)
    } catch (e) {
      return buildUnavailableOptimizationDecision(e instanceof Error ? e.message : 'Not authorized', item.original_language)
    }

    const analysis = await getMediaFileAnalyzer().analyzeFile(item.file_path)
    if (!analysis.success) throw new Error(analysis.error || 'Fresh media analysis failed')

    return buildOptimizationDecision({
      originalLanguage: item.original_language,
      durationSeconds: analysis.duration == null ? undefined : analysis.duration / 1000,
      fileSize: analysis.fileSize || 0,
      videoStorageDebtBytes: null,
      legacyTotalRecoverableBytes: item.storage_debt_bytes,
      audioTranscodeSavingsBytes: null,
      audioTracks: mapAnalysisAudioTracksToDecisionTracks(analysis.audioTracks),
    })
  })
}
