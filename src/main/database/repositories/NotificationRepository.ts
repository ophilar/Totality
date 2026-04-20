import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { BaseRepository } from './BaseRepository'

export interface Notification {
  id?: number
  type: 'info' | 'success' | 'warning' | 'error' | 'task_complete' | 'task_failed'
  title: string
  message: string
  reference_id?: string
  is_read: boolean
  created_at?: string
}

export class NotificationRepository extends BaseRepository<Notification> {
  constructor(db: DatabaseSync) {
    super(db, 'notifications')
  }

  addNotification(notification: Omit<Notification, 'id' | 'is_read' | 'created_at'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO notifications (type, title, message, reference_id, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, datetime('now'))
    `)
    const result = stmt.run(
      notification.type,
      notification.title,
      notification.message,
      notification.reference_id || null
    ) as unknown as { lastInsertRowid: number | bigint }
    return Number(result.lastInsertRowid)
  }

  getUnreadCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0')
    const result = stmt.get() as unknown as { count: number } | undefined
    return result?.count || 0
  }

  createNotification(notification: Omit<Notification, 'id' | 'is_read' | 'created_at'>): number {
    return this.addNotification(notification)
  }

  get(filters?: { unreadOnly?: boolean; limit?: number; offset?: number }): Notification[] {
    return this.getNotifications(filters)
  }

  markAsRead(id: number | number[]): void {
    if (Array.isArray(id)) {
      if (id.length === 0) return
      const placeholders = id.map(() => '?').join(',')
      this.db.prepare(`UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`).run(...id)
    } else {
      this.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id)
    }
  }

  deleteNotifications(ids: number | number[]): void {
    if (Array.isArray(ids)) {
      if (ids.length === 0) return
      const placeholders = ids.map(() => '?').join(',')
      this.db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...ids)
    } else {
      this.db.prepare('DELETE FROM notifications WHERE id = ?').run(ids)
    }
  }

  clearAllNotifications(): void {
    this.clearAll()
  }

  markAllAsRead(): void {
    this.db.prepare('UPDATE notifications SET is_read = 1').run()
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM notifications').run()
  }

  getRecent(limit = 50, offset = 0): Notification[] {
    const sql = 'SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?'
    const params: SQLInputValue[] = [limit, offset]
    const rows = this.db.prepare(sql).all(...params) as unknown as Notification[]
    return rows
  }

  getNotifications(filters?: { unreadOnly?: boolean; limit?: number; offset?: number }): Notification[] {
    let sql = 'SELECT * FROM notifications'
    const params: SQLInputValue[] = []

    if (filters?.unreadOnly) {
      sql += ' WHERE is_read = 0'
    }

    sql += ' ORDER BY created_at DESC'

    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    if (filters?.offset) {
      sql += ' OFFSET ?'
      params.push(filters.offset)
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as Array<{
      id: number
      type: string
      title: string
      message: string
      reference_id: string | null
      is_read: number
      created_at: string
    }>

    return rows.map((r) => ({
      id: r.id,
      type: r.type as any,
      title: r.title,
      message: r.message,
      reference_id: r.reference_id || undefined,
      is_read: r.is_read === 1,
      created_at: r.created_at,
    }))
  }
}
