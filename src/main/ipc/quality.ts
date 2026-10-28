import { IPC_CHANNELS } from '../../shared/ipcChannels'
import { getQualityAnalyzer } from '../services/QualityAnalyzer'
import { getTaskQueueService } from '../services/TaskQueueService'
import { getDatabase } from '../database/getDatabase'
import { PositiveIntSchema } from '../validation/schemas'
import { createIpcHandler, createValidatedIpcHandler } from './utils/createHandler'

/**
 * Register all quality analysis IPC handlers
 */
export function registerQualityHandlers() {
  const analyzer = getQualityAnalyzer()

  // ============================================================================
  // QUALITY ANALYSIS
  // ============================================================================

  createIpcHandler(IPC_CHANNELS.qualityAnalyzeAll, async () => {
    const queue = getTaskQueueService()
    const taskId = queue.addTask({ type: 'quality-analysis', label: 'Refresh media quality' })
    const task = await queue.waitForTask(taskId)
    if (task.status !== 'completed') throw new Error(task.error ?? `Quality refresh ${task.status}`)
    return task.result!.itemsScanned!
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

    return analyzer.getRecommendedFormat(mediaItem)
  })

  console.log('Quality analysis IPC handlers registered')
}
