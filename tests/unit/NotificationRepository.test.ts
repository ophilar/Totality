import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NotificationRepository } from '@main/database/repositories/NotificationRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('NotificationRepository (Real DB)', () => {
  let repo: NotificationRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.notifications
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should add and retrieve notifications', async () => {
    const id = await repo.addNotification({
      type: 'info',
      title: 'Test Note',
      message: 'This is a test message'
    })

    expect(id).toBeGreaterThan(0)

    const notifications = await repo.getNotifications()
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('Test Note')
    expect(notifications[0].is_read).toBe(false)
  })

  it('should filter unread notifications', async () => {
    const id1 = await repo.addNotification({ type: 'info', title: 'Note 1', message: 'M1' })
    await repo.addNotification({ type: 'info', title: 'Note 2', message: 'M2' })

    await repo.markAsRead(id1)

    const unread = await repo.getNotifications({ unreadOnly: true })
    expect(unread).toHaveLength(1)
    expect(unread[0].title).toBe('Note 2')
  })

  it('should get unread count', async () => {
    await repo.addNotification({ type: 'info', title: 'N1', message: 'M1' })
    await repo.addNotification({ type: 'info', title: 'N2', message: 'M2' })
    
    expect(await repo.getUnreadCount()).toBe(2)
  })

  it('should mark all as read', async () => {
    await repo.addNotification({ type: 'info', title: 'N1', message: 'M1' })
    await repo.addNotification({ type: 'info', title: 'N2', message: 'M2' })
    
    await repo.markAllAsRead()
    expect(await repo.getUnreadCount()).toBe(0)
  })

  it('should delete notifications', async () => {
    const id = await repo.addNotification({ type: 'info', title: 'Delete Me', message: 'M' })
    await repo.deleteNotifications(id)
    
    const all = await repo.getNotifications()
    expect(all).toHaveLength(0)
  })

  it('should clear all notifications', async () => {
    await repo.addNotification({ type: 'info', title: 'N1', message: 'M1' })
    await repo.addNotification({ type: 'info', title: 'N2', message: 'M2' })
    
    await repo.clearAll()
    const all = await repo.getNotifications()
    expect(all).toHaveLength(0)
  })
})
