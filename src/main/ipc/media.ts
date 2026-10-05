import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * Media IPC Handlers
 * 
 * General media-related operations like searching across all libraries
 * and performing deep file analysis.
 */

import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getSourceManager } from '@main/services/SourceManager'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { getStatsCacheService } from '@main/services/StatsCacheService'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import type { AnalysisScope } from '@shared/analysisScope'

export function registerMediaHandlers(): void {
  const analyzer = getMediaFileAnalyzer()
  const analysisScopeSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), mediaId: z.number().int().positive() }),
    z.object({ kind: z.literal('all-libraries') }),
    z.object({ kind: z.literal('library'), sourceId: z.string().min(1), libraryId: z.string().min(1) }),
    z.object({ kind: z.literal('collection'), collectionId: z.number().int().positive() }),
    z.object({ kind: z.literal('show'), sourceId: z.string().min(1), libraryId: z.string().min(1), seriesIdentityKey: z.string().min(1), title: z.string().min(1) }),
    z.object({ kind: z.literal('album'), albumId: z.number().int().positive() }),
    z.object({ kind: z.literal('artist'), artistId: z.number().int().positive() }),
  ])

  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.ANALYZE, analysisScopeSchema, async (scope: AnalysisScope) => {
    const taskId = await getTaskQueueService().submitAnalysis(scope)
    getStatsCacheService().invalidate()
    return { taskId, scope }
  })

  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.GET_OPTIMIZATION_ADVICE, z.number().int().positive(), async (mediaId) => {
    const item = await getDatabase().media.getItemById(mediaId)
    if (!item) throw new Error(`Media item ${mediaId} was not found`)
    if (!item.deep_analysis) {
      return getQualityAnalyzer().getOptimizationAdvice(item)
    }
    const persisted = JSON.parse(item.deep_analysis) as FileAnalysisResult
    if (!persisted.success || persisted.filePath !== item.file_path) {
      throw new Error(`Persisted file analysis for media item ${mediaId} is invalid`)
    }
    return getQualityAnalyzer().getOptimizationAdvice(item, persisted)
  })

  /**
   * Deep Media Analysis
   * Performs frame-accurate bitrate and volume detection
   */
  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.DEEP_ANALYZE, z.object({
    filePath: z.string(),
    requestId: z.string().min(1).optional(),
    scanBitrate: z.boolean().optional(),
    detectVolume: z.boolean().optional()
  }), async (options) => {
    getLoggingService().info('[media]', `Starting deep analysis for: ${options.filePath}`)
    const item = (await getDatabase().media.getItems()).find(candidate => candidate.file_path === options.filePath)
    if (!item) throw new Error(`No media item is associated with ${options.filePath}`)
    const { analysis, qualityScore } = await getQualityAnalyzer().analyzeMediaItemFileEvidence(item, undefined, options)
    await getDatabase().media.upsertQualityScore(qualityScore)
    return analysis
  })

  createValidatedIpcHandler('media:cancelDeepAnalyze', z.string().min(1), async (requestId) => {
    analyzer.cancelDeepAnalysis(requestId)
    return { success: true }
  })

  createValidatedIpcHandler('media:compareProvider', z.number().int().positive(), async (mediaItemId) => {
    const item = await getDatabase().media.getItemById(mediaItemId)
    if (!item) throw new Error('Media item not found')
    if (!item.source_id) throw new Error('Media item has no source')
    const provider = getSourceManager().getProvider(item.source_id)
    if (!provider) throw new Error(`Provider unavailable for source ${item.source_id}`)
    const providerItem = await provider.getItemMetadata(item.plex_id)
    const fields = ['title', 'year', 'duration', 'resolution', 'width', 'height', 'videoCodec', 'videoBitrate', 'audioCodec', 'audioChannels', 'audioBitrate'] as const
    const localValues: Record<string, unknown> = {
      title: item.title, year: item.year, duration: item.duration, resolution: item.resolution,
      width: item.width, height: item.height, videoCodec: item.video_codec, videoBitrate: item.video_bitrate,
      audioCodec: item.audio_codec, audioChannels: item.audio_channels, audioBitrate: item.audio_bitrate,
    }
    const differences = fields.filter(field => providerItem[field] !== undefined && providerItem[field] !== localValues[field])
      .map(field => ({ field, local: localValues[field], provider: providerItem[field] }))
    return { providerType: provider.providerType, differences }
  })

  createValidatedIpcHandler('media:getFileAudioLanguages', z.number().int().positive(), async (mediaItemId) => {
    const { getDatabase } = await import('@main/database/BetterSQLiteService')
    const db = getDatabase()
    const item = await db.media.getItemById(mediaItemId)
    if (!item) return []
    const languages = new Set<string>()
    if (item.audio_tracks) {
      try {
        const tracks = JSON.parse(item.audio_tracks) as Array<{ language?: string; lang?: string }>
        if (Array.isArray(tracks)) {
          for (const track of tracks) {
            const lang = (track.language || track.lang || '').trim().toLowerCase()
            if (lang) languages.add(lang)
          }
        }
      } catch { /* ignore parse error */ }
    }
    if (item.audio_language) {
      const lang = item.audio_language.trim().toLowerCase()
      if (lang) languages.add(lang)
    }
    return Array.from(languages)
  })

  getLoggingService().info('[media]', 'Media IPC handlers registered')
}
