import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * Media IPC Handlers
 * 
 * General media-related operations like searching across all libraries
 * and performing deep file analysis.
 */

import { getDatabase } from '@main/database/BetterSQLiteService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { NonEmptyStringSchema } from '@main/validation/schemas'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'

export function registerMediaHandlers(): void {
  const db = getDatabase()
  const analyzer = getMediaFileAnalyzer()

  /**
   * Global Search
   * Searches across Movies, TV Shows, and Music
   */
  createValidatedIpcHandler(IPC_CHANNELS.MEDIA.SEARCH, NonEmptyStringSchema, async (query) => {
    const [movies, shows, music] = await Promise.all([
      db.media.searchMediaItems(query, { limit: 10 }),
      db.tvShows.searchTVShows(query, { limit: 10 }),
      db.music.searchArtists(query, { limit: 10 })
    ])

    return {
      movies,
      shows,
      music
    }
  })

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

  getLoggingService().info('[media]', 'Media IPC handlers registered')
}
