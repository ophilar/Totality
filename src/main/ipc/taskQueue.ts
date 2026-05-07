import { IPC_CHANNELS } from '@main/constants/ipcChannels'
/**
 * IPC Handlers for Task Queue System
 */

import { ipcMain } from 'electron'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { validateInput, TaskDefinitionSchema, NonEmptyStringSchema } from '@main/validation/schemas'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'

export function registerTaskQueueHandlers(): void {
  const service = getTaskQueueService()

  /**
   * Get current queue state
   */
  ipcMain.handle(IPC_CHANNELS.TASK_QUEUE.GET_STATE, async () => {
    try {
      return await service.getQueueState()
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:getState] Error:', error)
      throw error
    }
  })

  /**
   * Add a task to the queue
   */
  ipcMain.handle('taskQueue:addTask', async (_event, definition: unknown) => {
    try {
      const validDefinition = validateInput(TaskDefinitionSchema, definition, 'taskQueue:addTask')
      getLoggingService().info('[taskQueue]', '[IPC] taskQueue:addTask called with:', validDefinition)
      const taskId = await service.addTask(validDefinition)
      getLoggingService().info('[taskQueue]', '[IPC] taskQueue:addTask returning taskId:', taskId)
      return { success: true, taskId }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:addTask] Error:', error)
      throw error
    }
  })

  /**
   * Remove a task from the queue
   */
  ipcMain.handle('taskQueue:removeTask', async (_event, taskId: unknown) => {
    try {
      const validTaskId = validateInput(NonEmptyStringSchema, taskId, 'taskQueue:removeTask')
      getLoggingService().info('[IPC taskQueue:removeTask]', validTaskId)
      const removed = await service.removeTask(validTaskId)
      return { success: removed }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:removeTask] Error:', error)
      throw error
    }
  })

  /**
   * Reorder the queue
   */
  ipcMain.handle('taskQueue:reorderQueue', async (_event, taskIds: unknown) => {
    try {
      const validTaskIds = validateInput(z.array(z.string().min(1)), taskIds, 'taskQueue:reorderQueue')
      await service.reorderQueue(validTaskIds)
      return { success: true }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:reorderQueue] Error:', error)
      throw error
    }
  })

  /**
   * Clear all queued tasks
   */
  ipcMain.handle('taskQueue:clearQueue', async () => {
    try {
      await service.clearQueue()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:clearQueue] Error:', error)
      throw error
    }
  })

  /**
   * Pause the queue
   */
  ipcMain.handle(IPC_CHANNELS.TASK_QUEUE.PAUSE, async () => {
    try {
      getLoggingService().info('[taskQueue]', '[IPC taskQueue:pause] Queue paused')
      await service.pauseQueue()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:pause] Error:', error)
      throw error
    }
  })

  /**
   * Resume the queue
   */
  ipcMain.handle(IPC_CHANNELS.TASK_QUEUE.RESUME, async () => {
    try {
      getLoggingService().info('[taskQueue]', '[IPC taskQueue:resume] Queue resumed')
      await service.resumeQueue()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:resume] Error:', error)
      throw error
    }
  })

  /**
   * Cancel the current running task
   */
  ipcMain.handle('taskQueue:cancelCurrent', async () => {
    try {
      await service.cancelCurrentTask()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:cancelCurrent] Error:', error)
      throw error
    }
  })

  /**
   * Get task history
   */
  ipcMain.handle('taskQueue:getTaskHistory', async () => {
    try {
      return await service.getTaskHistory()
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:getTaskHistory] Error:', error)
      throw error
    }
  })

  /**
   * Get monitoring history
   */
  ipcMain.handle('taskQueue:getMonitoringHistory', async () => {
    try {
      return await service.getMonitoringHistory()
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:getMonitoringHistory] Error:', error)
      throw error
    }
  })

  /**
   * Clear task history
   */
  ipcMain.handle('taskQueue:clearTaskHistory', async () => {
    try {
      await service.clearTaskHistory()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:clearTaskHistory] Error:', error)
      throw error
    }
  })

  /**
   * Clear monitoring history
   */
  ipcMain.handle('taskQueue:clearMonitoringHistory', async () => {
    try {
      await service.clearMonitoringHistory()
      return { success: true }
    } catch (error) {
      getLoggingService().error('[taskQueue]', '[IPC taskQueue:clearMonitoringHistory] Error:', error)
      throw error
    }
  })

  getLoggingService().info('[taskQueue]', '[IPC] Task queue handlers registered')
}

