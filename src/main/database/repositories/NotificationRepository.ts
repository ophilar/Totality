// @ts-nocheck
import type { DatabaseSync } from 'node:sqlite'
import type { Notification, GetNotificationsOptions } from '../../types/monitoring'

export class NotificationRepository {
  constructor(private db: DatabaseSync) {}

  addNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    const result = stmt.run(
      notification.type,
      notification.title,
      notification.message,
      notification.sourceId || null,
      notification.sourceName || null,
      notification.itemCount || 0,
      notification.metadata ? JSON.stringify(notification.metadata) : '{}'
    )

    return Number(result.lastInsertRowid)
  }

  createNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): number {
    return this.addNotification(notification)
  }

  createNotifications(notifications: Array<Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>>): number[] {
    const ids: number[] = []
    const stmt = this.db.prepare(`
      INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    this.db.exec('BEGIN DEFERRED')
    try {
      for (const notification of notifications) {
        const result = stmt.run(
          notification.type,
          notification.title,
          notification.message,
          notification.sourceId || null,
          notification.sourceName || null,
          notification.itemCount || 0,
          notification.metadata ? JSON.stringify(notification.metadata) : '{}'
        )
        ids.push(Number(result.lastInsertRowid))
      }
      this.db.exec('COMMIT')
    } catch(err) {
      this.db.exec('ROLLBACK')
      throw err
    }

    return ids
  }

  get(options: GetNotificationsOptions = {}): Notification[] {
    const { limit = 100, offset = 0, type, unreadOnly = false } = options

    let sql = 'SELECT * FROM notifications WHERE 1=1'
    const params: unknown[] = []

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }
    if (unreadOnly) {
      sql += ' AND is_read = 0'
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(...params) as Array<{
      id: number
      type: string
      title: string
      message: string
      source_id: string | null
      source_name: string | null
      item_count: number
      metadata: string
      is_read: number
      created_at: string
      read_at: string | null
    }>

    return rows.map((row) => ({
      id: row.id,
      type: row.type as any,
      title: row.title,
      message: row.message,
      sourceId: row.source_id || undefined,
      sourceName: row.source_name || undefined,
      itemCount: row.item_count,
      metadata: JSON.parse(row.metadata),
      isRead: row.is_read === 1,
      createdAt: row.created_at,
      readAt: row.read_at || undefined
    }))
  }

  markAsRead(ids: number[]): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`
      UPDATE notifications SET is_read = 1, read_at = datetime('now')
      WHERE id IN (${placeholders})
    `).run(...ids)
  }

  markNotificationRead(id: number): void {
    this.markAsRead([id])
  }

  markAllAsRead(): void {
    this.db.prepare("UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE is_read = 0").run()
  }

  markAllNotificationsRead(): void {
    this.markAllAsRead()
  }

  deleteNotifications(ids: number[]): void {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(',')
    this.db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...ids)
  }

  deleteNotification(id: number): void {
    this.deleteNotifications([id])
  }

  deleteAllNotifications(): void {
    this.db.prepare('DELETE FROM notifications').run()
  }

  clearAllNotifications(): void {
    this.deleteAllNotifications()
  }

  getUnreadCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0').get() as { count: number }
    return row.count
  }

  getNotificationCounts(): { total: number; unread: number } {
    const totalRow = this.db.prepare('SELECT COUNT(*) as count FROM notifications').get() as { count: number }
    const unreadRow = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0').get() as { count: number }
    return {
      total: totalRow.count,
      unread: unreadRow.count
    }
  }
}
