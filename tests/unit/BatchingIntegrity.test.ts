
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDatabase, resetBetterSQLiteServiceForTesting } from '@main/database/BetterSQLiteService'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TaskType } from '@main/types/database'

describe('Batching Integrity (No Mocks)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('Database Exclusions Batching', () => {
    it('should add multiple exclusions in a single batch', async () => {
      const exclusions = [
        { exclusion_type: 'media_upgrade' as const, reference_id: 1, title: 'Movie 1' },
        { exclusion_type: 'media_upgrade' as const, reference_id: 2, title: 'Movie 2' },
        { exclusion_type: 'media_upgrade' as const, reference_id: 3, title: 'Movie 3' }
      ]

      await db.exclusions.batchAddExclusions(exclusions)

      const result = await db.exclusions.getExclusions('media_upgrade')
      expect(result).toHaveLength(3)
      expect(result.map((r: any) => r.title)).toContain('Movie 1')
      expect(result.map((r: any) => r.title)).toContain('Movie 2')
      expect(result.map((r: any) => r.title)).toContain('Movie 3')
    })

    it('should handle large batches with chunking', async () => {
      // Repository uses chunk size of 100
      const largeBatch = Array.from({ length: 150 }, (_, i) => ({
        exclusion_type: 'media_upgrade' as const,
        reference_id: i + 100,
        title: `Large Batch Movie ${i}`
      }))

      await db.exclusions.batchAddExclusions(largeBatch)

      const result = await db.exclusions.getExclusions('media_upgrade')
      expect(result).toHaveLength(150)
    })
  })

  describe('Task Queue Batching', () => {
    it('should add multiple tasks to the queue at once', async () => {
      const taskQueue = getTaskQueueService()
      taskQueue.pause()
      await taskQueue.clearQueue()

      const tasks = [
        { type: TaskType.Transcode, label: 'Transcode 1', mediaItemId: 1 },
        { type: TaskType.Transcode, label: 'Transcode 2', mediaItemId: 2 },
        { type: TaskType.Transcode, label: 'Transcode 3', mediaItemId: 3 }
      ]

      const ids = await taskQueue.addTasks(tasks)
      expect(ids).toHaveLength(3)
      expect(ids[0]).toContain('task_')

      const state = taskQueue.getState()
      expect(state.queue).toHaveLength(3)
      expect(state.queue[0].label).toBe('Transcode 1')
      expect(state.queue[2].label).toBe('Transcode 3')
    })
  })
})
