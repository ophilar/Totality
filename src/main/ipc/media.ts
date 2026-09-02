import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * Media IPC Handlers
 * 
 * General media-related operations like searching across all libraries
 * and performing deep file analysis.
 */

import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getSourceManager } from '@main/services/SourceManager'
import type { MediaItem } from '@main/types/database'

export function registerMediaHandlers(): void {
  const analyzer = getMediaFileAnalyzer()

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
    const result = await analyzer.deepAnalyzeFile(options.filePath, {
      scanBitrate: options.scanBitrate ?? true,
      detectVolume: options.detectVolume ?? true,
      requestId: options.requestId
    })
    await getDatabase().media.updateDeepAnalysisByPath(options.filePath, {
      deepAnalysis: result.deepAnalysis,
      audioTracks: result.audioTracks,
    }, new Date().toISOString())
    return result
  })

  createValidatedIpcHandler('media:cancelDeepAnalyze', z.string().min(1), async (requestId) => {
    analyzer.cancelDeepAnalysis(requestId)
    return { success: true }
  })

  createValidatedIpcHandler('media:compareProvider', z.number().int().positive(), async (mediaItemId) => {
    const item = await getDatabase().media.getById(mediaItemId) as MediaItem | null
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
    const item = (await db.media.getById(mediaItemId)) as import('@main/types/database').MediaItem | null
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
