import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskRepository } from '@main/database/repositories/TaskRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('TaskRepository (Real DB)', () => {
  let repo: TaskRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.tasks
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should add and retrieve task history', async () => {
    const task = {
      task_id: 't-1',
      type: 'library-scan',
      label: 'Scan Plex',
      status: 'completed' as const,
      created_at: new Date().toISOString()
    }

    await repo.addTaskHistory(task)
    
    const history = await repo.getTaskHistory()
    expect(history).toHaveLength(1)
    expect(history[0].task_id).toBe('t-1')
  })

  it('should clear task history', async () => {
    await repo.addTaskHistory({ task_id: 't1', type: 'scan', label: 'L', status: 'completed', created_at: 'now' })
    expect(await repo.getTaskHistory()).toHaveLength(1)
    
    await repo.clearHistory()
    expect(await repo.getTaskHistory()).toHaveLength(0)
  })

  it('should log activities', async () => {
    await repo.addActivityLog({ entry_type: 'info', message: 'Started scan', task_id: 't1', task_type: 'scan' })
    
    const logs = await repo.getActivityLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].message).toBe('Started scan')
  })
})
