import { IPC_CHANNELS } from '../../shared/ipcChannels'
/**
 * IPC Handlers for Task Queue System
 */

import { getTaskQueueService } from '../services/TaskQueueService'
import { validateInput, TaskDefinitionSchema, NonEmptyStringSchema } from '../validation/schemas'
import { z } from 'zod'
import { createIpcHandler } from './utils/createHandler'

export function registerTaskQueueHandlers(): void {
  const service = getTaskQueueService()

  /**
   * Get current queue state
   */
  createIpcHandler(IPC_CHANNELS.taskQueueGetState, async () => {
    return service.getQueueState()
  })

  /**
   * Add a task to the queue
   */
  createIpcHandler(IPC_CHANNELS.taskQueueAddTask, async (definition: unknown) => {
    const validDefinition = validateInput(TaskDefinitionSchema, definition, 'taskQueue:addTask')
    console.log('[IPC] taskQueue:addTask called with:', validDefinition)
    const taskId = service.addTask(validDefinition)
    console.log('[IPC] taskQueue:addTask returning taskId:', taskId)
    return { success: true, taskId }
  })

  /**
   * Remove a task from the queue
   */
  createIpcHandler(IPC_CHANNELS.taskQueueRemoveTask, async (taskId: unknown) => {
    const validTaskId = validateInput(NonEmptyStringSchema, taskId, 'taskQueue:removeTask')
    console.log('[IPC taskQueue:removeTask]', validTaskId)
    const removed = service.removeTask(validTaskId)
    return { success: removed }
  })

  /**
   * Reorder the queue
   */
  createIpcHandler(IPC_CHANNELS.taskQueueReorderQueue, async (taskIds: unknown) => {
    const validTaskIds = validateInput(z.array(z.string().min(1)), taskIds, 'taskQueue:reorderQueue')
    service.reorderQueue(validTaskIds)
    return { success: true }
  })

  /**
   * Clear all queued tasks
   */
  createIpcHandler(IPC_CHANNELS.taskQueueClearQueue, async () => {
    service.clearQueue()
    return { success: true }
  })

  /**
   * Pause the queue
   */
  createIpcHandler(IPC_CHANNELS.taskQueuePause, async () => {
    console.log('[IPC taskQueue:pause] Queue paused')
    service.pauseQueue()
    return { success: true }
  })

  /**
   * Resume the queue
   */
  createIpcHandler(IPC_CHANNELS.taskQueueResume, async () => {
    console.log('[IPC taskQueue:resume] Queue resumed')
    service.resumeQueue()
    return { success: true }
  })

  /**
   * Cancel the current running task
   */
  createIpcHandler(IPC_CHANNELS.taskQueueCancelCurrent, async () => {
    service.cancelCurrentTask()
    return { success: true }
  })

  /**
   * Get task history
   */
  createIpcHandler(IPC_CHANNELS.taskQueueGetTaskHistory, async () => {
    return service.getTaskHistory()
  })

  /**
   * Get monitoring history
   */
  createIpcHandler(IPC_CHANNELS.taskQueueGetMonitoringHistory, async () => {
    return service.getMonitoringHistory()
  })

  /**
   * Clear task history
   */
  createIpcHandler(IPC_CHANNELS.taskQueueClearTaskHistory, async () => {
    service.clearTaskHistory()
    return { success: true }
  })

  /**
   * Clear monitoring history
   */
  createIpcHandler(IPC_CHANNELS.taskQueueClearMonitoringHistory, async () => {
    service.clearMonitoringHistory()
    return { success: true }
  })

  console.log('[IPC] Task queue handlers registered')
}
