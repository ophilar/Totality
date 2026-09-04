import { eq, desc, sql, inArray } from 'drizzle-orm'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { Client } from '@libsql/client'
import * as schema from '@main/database/drizzleSchema'
import { BaseRepository } from '@main/database/repositories/BaseRepository'
import { getLoggingService } from '@main/services/LoggingService'

export interface Notification {
  id?: number
  type: 'source_change' | 'scan_complete' | 'error' | 'info' | 'success' | 'warning' | 'task_complete' | 'task_failed'
  title: string
  message: string
  reference_id?: string
  is_read: boolean
  created_at?: string
}

export class NotificationRepository extends BaseRepository<typeof schema.notifications> {
  constructor(db: Client, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'notifications', drizzle, schema.notifications)
  }

  async addNotification(notification: Omit<Notification, 'id' | 'is_read' | 'created_at'>): Promise<number> {
    let dbType: 'source_change' | 'scan_complete' | 'error' | 'info'
    switch (notification.type) {
      case 'source_change':
        dbType = 'source_change'
        break
      case 'scan_complete':
      case 'success':
      case 'task_complete':
        dbType = 'scan_complete'
        break
      case 'error':
      case 'task_failed':
        dbType = 'error'
        break
      case 'info':
      case 'warning':
        dbType = 'info'
        break
      default:
        throw new Error(`Unsupported notification type: ${(notification as { type: string }).type}`)
    }

    const result = await this.drizzle.insert(schema.notifications)
      .values({
        type: dbType,
        title: notification.title,
        message: notification.message,
        referenceId: notification.reference_id ?? null,
        isRead: 0,
        createdAt: new Date().toISOString(),
      })
      .returning({ id: schema.notifications.id })

    const log = getLoggingService()
    const logMsg = `Notification [${notification.type}]: ${notification.title} - ${notification.message}`
    if (notification.type === 'error' || notification.type === 'task_failed') {
      log.error('[Notification]', logMsg)
    } else if (notification.type === 'warning') {
      log.warn('[Notification]', logMsg)
    } else {
      log.info('[Notification]', logMsg)
    }

    const insertedId = result[0]?.id
    if (insertedId == null) {
      throw new Error('Failed to insert notification: no id returned from database')
    }
    return insertedId
  }

  async getUnreadCount(): Promise<number> {
    return await this.countInternal(eq(schema.notifications.isRead, 0))
  }

  async createNotification(notification: Omit<Notification, 'id' | 'is_read' | 'created_at'>): Promise<number> {
    return this.addNotification(notification)
  }

  async get(filters?: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<Notification[]> {
    return this.getNotifications(filters)
  }

  async markAsRead(id: number | number[]): Promise<void> {
    const ids = Array.isArray(id) ? id : [id]
    if (ids.length === 0) return

    await this.drizzle.update(schema.notifications)
      .set({ 
        isRead: 1,
        readAt: sql`(datetime('now'))`
      })
      .where(inArray(schema.notifications.id, ids))
  }

  async deleteNotifications(ids: number | number[]): Promise<void> {
    const idList = Array.isArray(ids) ? ids : [ids]
    if (idList.length === 0) return

    await this.drizzle.delete(schema.notifications)
      .where(inArray(schema.notifications.id, idList))
  }

  async clearAllNotifications(): Promise<void> {
    await this.clearAll()
  }

  async markAllAsRead(): Promise<void> {
    await this.drizzle.update(schema.notifications)
      .set({ 
        isRead: 1,
        readAt: sql`(datetime('now'))`
      })
  }

  async clearAll(): Promise<void> {
    await this.drizzle.delete(schema.notifications)
  }

  async getRecent(limit = 50, offset = 0): Promise<Notification[]> {
    return this.getNotifications({ limit, offset })
  }

  async getNotifications(filters?: { unreadOnly?: boolean; limit?: number; offset?: number }): Promise<Notification[]> {
    const query = this.drizzle.select().from(schema.notifications)
    
    if (filters?.unreadOnly) {
      query.where(eq(schema.notifications.isRead, 0))
    }

    query.orderBy(desc(schema.notifications.createdAt))

    if (filters?.limit) query.limit(filters.limit)
    if (filters?.offset) query.offset(filters.offset)

    const rows = await query.all()
    return this.mapDrizzleToNotifications(rows)
  }

  private mapDrizzleToNotifications(rows: Array<typeof schema.notifications.$inferSelect>): Notification[] {
    return rows.map((r) => ({
      id: r.id,
      type: r.type as Notification['type'],
      title: r.title,
      message: r.message,
      reference_id: r.referenceId || undefined,
      is_read: r.isRead === 1,
      created_at: r.createdAt,
    }))
  }
}
