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

  getLoggingService().info('[media]', 'Media IPC handlers registered')
}
