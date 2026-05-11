import { eq, desc, sql, inArray } from 'drizzle-orm'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

export interface Notification {
  id?: number
  type: 'info' | 'success' | 'warning' | 'error' | 'task_complete' | 'task_failed'
  title: string
  message: string
  reference_id?: string
  is_read: boolean
  created_at?: string
}

export class NotificationRepository extends BaseRepository<typeof schema.notifications> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'notifications', drizzle, schema.notifications)
  }

  async addNotification(notification: Omit<Notification, 'id' | 'is_read' | 'created_at'>): Promise<number> {
    const result = await this.drizzle.insert(schema.notifications)
      .values({
        type: notification.type,
        title: notification.title,
        message: notification.message,
        referenceId: notification.reference_id || null,
        isRead: 0,
      })
      .returning({ id: schema.notifications.id })
    
    return result[0]?.id || 0
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

  private mapDrizzleToNotifications(rows: any[]): Notification[] {
    return rows.map((r) => ({
      id: r.id,
      type: r.type as any,
      title: r.title,
      message: r.message,
      reference_id: r.referenceId || undefined,
      is_read: r.isRead === 1,
      created_at: r.createdAt,
    }))
  }
}
