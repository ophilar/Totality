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

export function registerMediaHandlers(): void {
  const analyzer = getMediaFileAnalyzer()

  /**
   * Deep Media Analysis
   * Performs frame-accurate bitrate and volume detection
   */
  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.DEEP_ANALYZE, z.object({
    filePath: z.string(),
    scanBitrate: z.boolean().optional(),
    detectVolume: z.boolean().optional()
  }), async (options) => {
    getLoggingService().info('[media]', `Starting deep analysis for: ${options.filePath}`)
    return await analyzer.deepAnalyzeFile(options.filePath, {
      scanBitrate: options.scanBitrate ?? true,
      detectVolume: options.detectVolume ?? true
    })
  })

  createValidatedIpcHandler('media:getFileAudioLanguages', z.number().int().positive(), async (mediaItemId) => {
    const { getDatabase } = await import('@main/database/BetterSQLiteService')
    const db = getDatabase()
    const item = await db.media.getById(mediaItemId)
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
