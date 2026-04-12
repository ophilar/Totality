
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import { TaskQueueService } from '../../src/main/services/TaskQueueService'
import * as fs from 'fs'
import * as path from 'path'
import { getLoggingService } from '../../src/main/services/LoggingService'
import { getDatabaseServiceSync } from '../../src/main/database/DatabaseFactory'

describe('TaskQueueService (No Mocks)', () => {
  const dbPath = path.join(__dirname, 'task-queue.db')
  let taskQueue: TaskQueueService
  let realDbWrapper: any

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    
    // We need a real DB wrapper with `getSettingsByPrefix` and `setSetting`
    realDbWrapper = getDatabaseServiceSync(dbPath)
    
    // Create a real logging service that doesn't output to console during tests
    const logging = getLoggingService()

    // Using real instances
    taskQueue = new TaskQueueService({ db: realDbWrapper, logging })
    taskQueue.clearTaskHistory()
  })

  afterEach(() => {
    // BetterSQLiteService doesn't have a close method exposed easily, we just delete the file
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath) } catch (e) {}
    }
  })

  it('should queue multiple tasks', () => {
    // Pause queue so we can inspect it without background process running
    taskQueue.pause()
    
    const id1 = taskQueue.addTask({ type: 'library-scan', label: 'Task 1' })
    const id2 = taskQueue.addTask({ type: 'source-scan', label: 'Task 2' })
    
    const queue = taskQueue.getState().queue
    expect(queue.length).toBe(2)
    expect(queue[0].id).toBe(id1)
    expect(queue[1].id).toBe(id2)
  })

  it('should remove a queued task', () => {
    taskQueue.pause()
    taskQueue.addTask({ type: 'library-scan', label: 'Task 1' })
    const id2 = taskQueue.addTask({ type: 'source-scan', label: 'Task 2' })
    
    const removed = taskQueue.removeTask(id2)
    expect(removed).toBe(true)
    expect(taskQueue.getState().queue.length).toBe(1)
  })

  it('should handle pause and resume', () => {
    taskQueue.pause()
    taskQueue.addTask({ type: 'library-scan', label: 'Task 1' })
    
    expect(taskQueue.getState().currentTask).toBeNull()
    expect(taskQueue.getState().queue.length).toBe(1)

    taskQueue.resume()
    // Once resumed, the task becomes the current task and leaves the queue
    expect(taskQueue.getState().currentTask).not.toBeNull()
    expect(taskQueue.getState().queue.length).toBe(0)
  })

  it('should clear history', () => {
    taskQueue.clearTaskHistory()
    expect(taskQueue.getTaskHistory().length).toBe(0)
  })
})
