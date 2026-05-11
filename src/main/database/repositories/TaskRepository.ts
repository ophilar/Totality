import { desc, sql } from 'drizzle-orm'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

export interface TaskHistoryEntry {
  id?: number
  task_id: string
  type: string
  label: string
  source_id?: string
  library_id?: string
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted'
  error?: string
  result?: string
  created_at: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
  recorded_at?: string
}

export interface ActivityLogEntry {
  id?: number
  entry_type: string
  message: string
  task_id?: string
  task_type?: string
  created_at?: string
}

export class TaskRepository extends BaseRepository<typeof schema.taskHistory> {
  constructor(db: any, drizzle: LibSQLDatabase<typeof schema>) {
    super(db, 'task_history', drizzle, schema.taskHistory)
  }

  async addTaskHistory(entry: TaskHistoryEntry): Promise<number> {
    const result = await this.drizzle.insert(schema.taskHistory)
      .values({
        taskId: entry.task_id,
        type: entry.type,
        label: entry.label,
        sourceId: entry.source_id || null,
        libraryId: entry.library_id || null,
        status: entry.status,
        error: entry.error || null,
        result: entry.result || null,
        createdAt: entry.created_at,
        startedAt: entry.started_at || null,
        completedAt: entry.completed_at || null,
        durationMs: entry.duration_ms || null,
      })
      .returning({ id: schema.taskHistory.id })
    
    return result[0]?.id || 0
  }

  async addActivityLog(entry: Omit<ActivityLogEntry, 'id' | 'created_at'>): Promise<void> {
    await this.drizzle.insert(schema.activityLog)
      .values({
        entryType: entry.entry_type,
        message: entry.message,
        taskId: entry.task_id || null,
        taskType: entry.task_type || null,
        createdAt: sql`(datetime('now'))`
      })
  }

  async getTaskHistory(limit = 50): Promise<TaskHistoryEntry[]> {
    const rows = await this.drizzle.select()
      .from(schema.taskHistory)
      .orderBy(desc(schema.taskHistory.recordedAt))
      .limit(limit)
      .all()
    
    return this.mapDrizzleToTaskHistory(rows)
  }

  async getActivityLogs(limit = 100): Promise<ActivityLogEntry[]> {
    const rows = await this.drizzle.select()
      .from(schema.activityLog)
      .orderBy(desc(schema.activityLog.createdAt))
      .limit(limit)
      .all()
    
    return this.mapDrizzleToActivityLog(rows)
  }

  async clearHistory(): Promise<void> {
    await this.drizzle.delete(schema.taskHistory)
    await this.drizzle.delete(schema.activityLog)
  }

  private mapDrizzleToTaskHistory(rows: any[]): TaskHistoryEntry[] {
    return rows.map(r => ({
      id: r.id,
      task_id: r.taskId,
      type: r.type,
      label: r.label,
      source_id: r.sourceId || undefined,
      library_id: r.libraryId || undefined,
      status: r.status,
      error: r.error || undefined,
      result: r.result || undefined,
      created_at: r.createdAt,
      started_at: r.startedAt || undefined,
      completed_at: r.completedAt || undefined,
      duration_ms: r.durationMs || undefined,
      recorded_at: r.recordedAt
    }))
  }

  private mapDrizzleToActivityLog(rows: any[]): ActivityLogEntry[] {
    return rows.map(r => ({
      id: r.id,
      entry_type: r.entryType,
      message: r.message,
      task_id: r.taskId || undefined,
      task_type: r.taskType || undefined,
      created_at: r.createdAt
    }))
  }
}
