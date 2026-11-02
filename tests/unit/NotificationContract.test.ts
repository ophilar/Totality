import { describe, expect, it } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('notification IPC record contract', () => {
  it('returns persisted snake_case fields with a valid ISO timestamp', async () => {
    const db = await setupTestDb()
    try {
      await db.notifications.addNotification({ type: 'error', title: 'Task failed', message: 'Example' })
      const [record] = await db.notifications.getNotifications()
      expect(record).toMatchObject({ is_read: false, title: 'Task failed' })
      expect(record.created_at).toEqual(expect.any(String))
      expect(Number.isNaN(Date.parse(record.created_at!))).toBe(false)
    } finally {
      cleanupTestDb()
    }
  })
})
