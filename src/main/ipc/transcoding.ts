import { ipcMain } from 'electron'
import { z } from 'zod'
import { getDatabase } from '../database/getDatabase'
import { MediaPathAuthorization } from '../services/MediaPathAuthorization'
import { getTranscodingService } from '../services/TranscodingService'

const TranscodeOptionsSchema = z.object({
  targetCodec: z.enum(['av1', 'hevc']).optional(),
  useGpu: z.boolean().optional(),
  gpuId: z.string().min(1).optional(),
  encoder: z.string().min(1).optional(),
  crf: z.number().int().min(0).max(51).optional(),
  preset: z.string().min(1).optional(),
  optimizationMode: z.enum(['smart', 'remux_only', 'transcode']).optional(),
  targetContainer: z.enum(['mkv', 'mp4']).optional(),
})

function getAuthorizedItem(mediaItemId: number) {
  const db = getDatabase()
  const item = db.getMediaItemById(mediaItemId)
  if (!item) throw new Error(`Media item ${mediaItemId} no longer exists.`)
  if (!item.source_id) throw new Error(`Media item ${mediaItemId} has no registered source.`)
  const source = db.getMediaSourceById(item.source_id)
  if (!source) throw new Error(`Media source '${item.source_id}' no longer exists.`)
  MediaPathAuthorization.assertMediaAuthorized(item, {
    source_type: source.source_type,
    connection_config: source.connection_config,
  })
  return item
}

export function registerTranscodingHandlers(): void {
  ipcMain.handle('transcoding:getCapabilities', async (_event, refresh: unknown) => {
    const refreshValue = z.boolean().optional().parse(refresh)
    return getTranscodingService().getCapabilities({ refresh: refreshValue })
  })
  ipcMain.handle('transcoding:cancel', (_event, mediaItemId: unknown) => {
    const id = z.number().int().positive().optional().parse(mediaItemId)
    return getTranscodingService().cancelTranscode(id)
  })
  ipcMain.handle('transcoding:preflightRemux', async (_event, mediaItemId: unknown) => {
    const id = z.number().int().positive().parse(mediaItemId)
    const item = getAuthorizedItem(id)
    const analysis = await (await import('../services/MediaFileAnalyzer')).getMediaFileAnalyzer().analyzeCompleteFile(item.file_path)
    if (!analysis.success) throw new Error(`Media analysis failed: ${analysis.error}`)
    return { itemId: id, duration: analysis.duration, video: analysis.video, audioTracks: analysis.audioTracks, fileSize: analysis.fileSize }
  })
  ipcMain.handle('transcoding:transcode', async (event, mediaItemId: unknown, options: unknown, requestId: unknown) => {
    const id = z.number().int().positive().parse(mediaItemId)
    const validOptions = TranscodeOptionsSchema.parse(options)
    const request = z.string().min(1).max(100).parse(requestId)
    const item = getAuthorizedItem(id)
    return getTranscodingService().transcodeMediaItem(item, validOptions, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('transcoding:progress', { requestId: request, mediaItemId: id, progress })
    })
  })
}
