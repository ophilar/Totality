import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { PositiveIntSchema } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'

export function registerQualityHandlers() {
  const analyzer = getQualityAnalyzer()

  createIpcHandler('quality:getDistribution', async () => {
    return analyzer.getQualityDistribution()
  })

  createValidatedIpcHandler('quality:getRecommendedFormat', PositiveIntSchema, async (mediaItemId) => {
    const db = getDatabase()
    const mediaItem = await db.media.getItem(mediaItemId)
    if (!mediaItem) throw new Error('Media item not found')
    const score = await db.media.getQualityScoreByMediaId(mediaItemId)
    return analyzer.getRecommendedFormat(mediaItem, score?.overall_score || 0)
  })

  getLoggingService().info('[quality]', 'Quality analysis IPC handlers registered')
}

