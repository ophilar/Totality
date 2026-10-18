import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { BrowserWindow } from 'electron'
import { getQualityAnalyzer } from '../services/QualityAnalyzer'
import { getDatabase } from '../database/getDatabase'
import { PositiveIntSchema } from '../validation/schemas'
import { safeSend } from './utils/safeSend'
import { createIpcHandler, createIpcHandlerWithEvent, createValidatedIpcHandler } from './utils/createHandler'

/**
 * Register all quality analysis IPC handlers
 */
export function registerQualityHandlers() {
  const analyzer = getQualityAnalyzer()

  // ============================================================================
  // QUALITY ANALYSIS
  // ============================================================================

  createIpcHandlerWithEvent(IPC_CHANNELS.qualityAnalyzeAll, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    await analyzer.loadThresholdsFromDatabase()

    let lastUpdateTime = 0
    const UPDATE_INTERVAL = 2000 // Send library:updated every 2 seconds during analysis

    const count = await analyzer.analyzeAllMediaItems((current, total) => {
      // Send progress updates to renderer
      safeSend(win, IPC_CHANNELS.qualityAnalysisProgress, { current, total })

      // Send periodic library:updated events for live refresh
      const now = Date.now()
      if (now - lastUpdateTime >= UPDATE_INTERVAL) {
        safeSend(win, IPC_CHANNELS.libraryUpdated, { type: 'media' })
        lastUpdateTime = now
      }
    })

    // Send final update when analysis completes
    safeSend(win, IPC_CHANNELS.libraryUpdated, { type: 'media' })

    return count
  })

  createIpcHandler(IPC_CHANNELS.qualityGetDistribution, async () => {
    return analyzer.getQualityDistribution()
  })

  createValidatedIpcHandler(IPC_CHANNELS.qualityGetRecommendedFormat, PositiveIntSchema, async mediaItemId => {
    const db = getDatabase()
    const mediaItem = db.getMediaItemById(mediaItemId)

    if (!mediaItem) {
      throw new Error('Media item not found')
    }

    const qualityScore = db.getQualityScoreByMediaId(mediaItemId)
    const currentScore = qualityScore?.overall_score || 0

    return analyzer.getRecommendedFormat(mediaItem, currentScore)
  })

  console.log('Quality analysis IPC handlers registered')
}
