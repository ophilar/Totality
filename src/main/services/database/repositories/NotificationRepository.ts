import type { Database } from 'sql.js'
import type {
  Notification,
  NotificationRow,
  NotificationType,
  GetNotificationsOptions,
  NotificationCountResult,
} from '../../../types/monitoring'

type SaveCallback = () => Promise<void>

export class NotificationRepository {
  constructor(
    private getDb: () => Database | null,
    private save: SaveCallback,
    private startBatch: () => void,
    private endBatch: () => Promise<void>
  ) {}

  private get db(): Database {
    const db = this.getDb()
    if (!db) throw new Error('Database not initialized')
    return db
  }

  /**
   * Create a new notification
   */
  async createNotification(notification: Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>): Promise<number> {
    this.db.run(
      `INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        notification.type,
        notification.title,
        notification.message,
        notification.sourceId || null,
        notification.sourceName || null,
        notification.itemCount || 0,
        notification.metadata ? JSON.stringify(notification.metadata) : '{}',
      ]
    )

    // Get the last inserted ID
    const result = this.db.exec('SELECT last_insert_rowid()')
    const id = result[0]?.values[0]?.[0] as number

    await this.save()
    return id
  }

  /**
   * Create multiple notifications in batch
   */
  async createNotifications(notifications: Array<Omit<Notification, 'id' | 'isRead' | 'createdAt' | 'readAt'>>): Promise<number[]> {
    const ids: number[] = []
    this.startBatch()

    for (const notification of notifications) {
      this.db.run(
        `INSERT INTO notifications (type, title, message, source_id, source_name, item_count, metadata, is_read)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          notification.type,
          notification.title,
          notification.message,
          notification.sourceId || null,
          notification.sourceName || null,
          notification.itemCount || 0,
          notification.metadata ? JSON.stringify(notification.metadata) : '{}',
        ]
      )

      const result = this.db.exec('SELECT last_insert_rowid()')
      ids.push(result[0]?.values[0]?.[0] as number)
    }

    await this.endBatch()
    return ids
  }

  /**
   * Get notifications with optional filtering
   */
  getNotifications(options: GetNotificationsOptions = {}): Notification[] {
    const { limit = 100, offset = 0, type, unreadOnly = false } = options

    let sql = 'SELECT * FROM notifications WHERE 1=1'
    const params: (string | number)[] = []

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    if (unreadOnly) {
      sql += ' AND is_read = 0'
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = this.db.exec(sql, params)
    if (!result[0]) return []

    return result[0].values.map(row => this.rowToNotification(row, result[0].columns))
  }

  /**
   * Get unread notifications
   */
  getUnreadNotifications(): Notification[] {
    return this.getNotifications({ unreadOnly: true })
  }

  /**
   * Get notification count
   */
  getNotificationCount(): NotificationCountResult {
    const totalResult = this.db.exec('SELECT COUNT(*) FROM notifications')
    const unreadResult = this.db.exec('SELECT COUNT(*) FROM notifications WHERE is_read = 0')

    return {
      total: (totalResult[0]?.values[0]?.[0] as number) || 0,
      unread: (unreadResult[0]?.values[0]?.[0] as number) || 0,
    }
  }

  /**
   * Mark notification(s) as read
   */
  async markNotificationsRead(ids: number[]): Promise<void> {
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.run(
      `UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`,
      ids
    )

    await this.save()
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(): Promise<void> {
    this.db.run('UPDATE notifications SET is_read = 1 WHERE is_read = 0')
    await this.save()
  }

  /**
   * Delete notification(s)
   */
  async deleteNotifications(ids: number[]): Promise<void> {
    if (ids.length === 0) return

    const placeholders = ids.map(() => '?').join(',')
    this.db.run(
      `DELETE FROM notifications WHERE id IN (${placeholders})`,
      ids
    )

    await this.save()
  }

  /**
   * Clear all notifications
   */
  async clearAllNotifications(): Promise<void> {
    this.db.run('DELETE FROM notifications')
    await this.save()
  }

  /**
   * Prune old notifications to keep only the most recent N
   */
  async pruneNotifications(maxCount: number): Promise<number> {
    // Get count of notifications to delete
    const countResult = this.db.exec('SELECT COUNT(*) FROM notifications')
    const totalCount = (countResult[0]?.values[0]?.[0] as number) || 0

    if (totalCount <= maxCount) return 0

    const deleteCount = totalCount - maxCount

    // Delete oldest notifications
    this.db.run(
      `DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications ORDER BY created_at ASC LIMIT ?
      )`,
      [deleteCount]
    )

    await this.save()
    return deleteCount
  }

  /**
   * Convert database row to Notification object
   */
  private rowToNotification(row: unknown[], columns: string[]): Notification {
    const obj: Record<string, unknown> = {}
    columns.forEach((col, i) => {
      obj[col] = row[i]
    })

    const dbRow = obj as unknown as NotificationRow

    return {
      id: dbRow.id,
      type: dbRow.type as NotificationType,
      title: dbRow.title,
      message: dbRow.message,
      sourceId: dbRow.source_id || undefined,
      sourceName: dbRow.source_name || undefined,
      itemCount: dbRow.item_count,
      metadata: dbRow.metadata ? JSON.parse(dbRow.metadata) : undefined,
      isRead: dbRow.is_read === 1,
      createdAt: dbRow.created_at,
      readAt: dbRow.read_at || undefined,
    }
  }
}
