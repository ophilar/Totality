import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { TaskDefinitionSchema, NonEmptyStringSchema } from '@main/validation/schemas'
import { z } from 'zod'
import { getLoggingService } from '@main/services/LoggingService'
import { createIpcHandler, createValidatedIpcHandler } from '@main/ipc/utils/createHandler'

export function registerTaskQueueHandlers(): void {
  const service = getTaskQueueService()

  createIpcHandler(IPC_CHANNELS.TASK_QUEUE.GET_STATE, async () => {
    return await service.getQueueState()
  })

  createValidatedIpcHandler('taskQueue:addTask', TaskDefinitionSchema, async (definition) => {
    return { success: true, taskId: await service.addTask(definition) }
  })

  createValidatedIpcHandler('taskQueue:addTasks', z.array(TaskDefinitionSchema), async (definitions) => {
    return { success: true, taskIds: await service.addTasks(definitions) }
  })

  createValidatedIpcHandler('taskQueue:removeTask', NonEmptyStringSchema, async (taskId) => {
    return { success: await service.removeTask(taskId) }
  })

  createValidatedIpcHandler('taskQueue:reorderQueue', z.array(z.string().min(1)), async (ids) => {
    await service.reorderQueue(ids)
    return { success: true }
  })

  createIpcHandler('taskQueue:clearQueue', async () => {
    await service.clearQueue()
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.TASK_QUEUE.PAUSE, async () => {
    await service.pauseQueue()
    return { success: true }
  })

  createIpcHandler(IPC_CHANNELS.TASK_QUEUE.RESUME, async () => {
    await service.resumeQueue()
    return { success: true }
  })

  createIpcHandler('taskQueue:cancelCurrent', async () => {
    await service.cancelCurrentTask()
    return { success: true }
  })

  createIpcHandler('taskQueue:getTaskHistory', async () => {
    return await service.getTaskHistory()
  })

  createIpcHandler('taskQueue:getMonitoringHistory', async () => {
    return await service.getMonitoringHistory()
  })

  createIpcHandler('taskQueue:clearTaskHistory', async () => {
    await service.clearTaskHistory()
    return { success: true }
  })

  createIpcHandler('taskQueue:clearMonitoringHistory', async () => {
    await service.clearMonitoringHistory()
    return { success: true }
  })

  getLoggingService().info('[taskQueue]', '[IPC] Task queue handlers registered')
}

