import { ipcMain } from 'electron'
import { getTranscodingService, TranscodeOptions } from '../services/TranscodingService'
import { validateInput, GetTranscodeParamsSchema } from '../validation/schemas'
import { getLoggingService } from '../services/LoggingService'

/**
 * Transcoding IPC Handlers
 */
export function registerTranscodingHandlers(): void {
  // Check if transcoding tools (Handbrake, etc.) are available
  ipcMain.handle('transcoding:checkAvailability', async () => {
    try {
      return await getTranscodingService().checkAvailability()
    } catch (error) {
      getLoggingService().error('[IPC]', 'Error in transcoding:checkAvailability:', error)
      throw error
    }
  })

  // Get AI-optimized transcoding parameters for a file
  ipcMain.handle('transcoding:getParameters', async (_event, filePath: unknown, options?: unknown) => {
    try {
      const [validPath, validOptions] = validateInput(
        GetTranscodeParamsSchema, 
        [filePath, options], 
        'transcoding:getParameters'
      )
      return await getTranscodingService().getTranscodeParameters(validPath, validOptions as TranscodeOptions)
    } catch (error) {
      getLoggingService().error('[IPC]', 'Error in transcoding:getParameters:', error)
      throw error
    }
  })

  // Start a transcoding job for a media item
  ipcMain.handle('transcoding:start', async (event, mediaItemId: number, options?: TranscodeOptions) => {
    const service = getTranscodingService()
    
    // We use a custom progress reporter that sends updates back via IPC
    return await service.transcode(mediaItemId, options, (progress) => {
      event.sender.send('transcoding:progress', { mediaItemId, ...progress })
    })
  })
}
