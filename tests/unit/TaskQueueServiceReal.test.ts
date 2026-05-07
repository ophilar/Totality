
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskQueueService } from '@main/services/TaskQueueService'
import * as fs from 'fs'
import * as path from 'path'
import { getLoggingService } from '@main/services/LoggingService'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'

describe('TaskQueueService (No Mocks)', () => {
  const dbPath = path.join(__dirname, 'task-queue.db')
  let taskQueue: TaskQueueService
  let realDbWrapper: any

  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath) } catch {}
    }
    
    // We need a real DB wrapper
    realDbWrapper = getDatabase()
    await realDbWrapper.initialize(dbPath)
    
    // Create a real logging service that doesn't output to console during tests
    const logging = getLoggingService()

    // Using real instances
    taskQueue = new TaskQueueService({ db: realDbWrapper, logging })
    await taskQueue.clearTaskHistory()
  })

  afterEach(async () => {
    realDbWrapper?.close()
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath) } catch (e) {}
    }
  })

  it('should queue multiple tasks', async () => {
    // Pause queue so we can inspect it without background process running
    taskQueue.pause()
    
    const id1 = await taskQueue.addTask({ type: 'library-scan', label: 'Task 1' })
    const id2 = await taskQueue.addTask({ type: 'source-scan', label: 'Task 2' })
    
    const queue = taskQueue.getState().queue
    expect(queue.length).toBe(2)
    expect(queue[0].id).toBe(id1)
    expect(queue[1].id).toBe(id2)
  })

  it('should remove a queued task', async () => {
    taskQueue.pause()
    await taskQueue.addTask({ type: 'library-scan', label: 'Task 1' })
    const id2 = await taskQueue.addTask({ type: 'source-scan', label: 'Task 2' })
    
    const removed = await taskQueue.removeTask(id2)
    expect(removed).toBe(true)
    expect(taskQueue.getState().queue.length).toBe(1)
  })

  it('should handle pause and resume', async () => {
    taskQueue.pause()
    await taskQueue.addTask({ type: 'library-scan', label: 'Task 1', sourceId: 's1', libraryId: 'l1' })
    
    expect(taskQueue.getState().currentTask).toBeNull()
    expect(taskQueue.getState().queue.length).toBe(1)

    await taskQueue.resume()
    
    // Once resumed, the task moves from queue to currentTask (or completed if it's very fast)
    const state = taskQueue.getState()
    expect(state.queue.length).toBe(0)
    // It should either be current or already completed
    expect(state.currentTask !== null || taskQueue.getTaskHistory().length > 0).toBe(true)
  })

  it('should clear history', async () => {
    await taskQueue.clearTaskHistory()
    expect(taskQueue.getTaskHistory().length).toBe(0)
  })
})
