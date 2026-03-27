import type { Database } from 'better-sqlite3'
import { BaseRepository } from './BaseRepository'

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

export class TaskRepository extends BaseRepository<TaskHistoryEntry> {
  constructor(db: Database) {
    super(db, 'task_history')
  }

  addTaskHistory(entry: TaskHistoryEntry): number {
    const stmt = this.db.prepare(`
      INSERT INTO task_history (
        task_id, type, label, source_id, library_id, status, error, result,
        created_at, started_at, completed_at, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      entry.task_id, entry.type, entry.label, entry.source_id || null, entry.library_id || null,
      entry.status, entry.error || null, entry.result || null,
      entry.created_at, entry.started_at || null, entry.completed_at || null, entry.duration_ms || null
    )
    return Number(result.lastInsertRowid)
  }

  addActivityLog(entry: Omit<ActivityLogEntry, 'id' | 'created_at'>): void {
    const stmt = this.db.prepare('INSERT INTO activity_log (entry_type, message, task_id, task_type) VALUES (?, ?, ?, ?)')
    stmt.run(entry.entry_type, entry.message, entry.task_id || null, entry.task_type || null)
  }

  getTaskHistory(limit = 50): TaskHistoryEntry[] {
    const stmt = this.db.prepare('SELECT * FROM task_history ORDER BY recorded_at DESC LIMIT ?')
    return stmt.all(limit) as TaskHistoryEntry[]
  }

  getActivityLogs(limit = 100): ActivityLogEntry[] {
    const stmt = this.db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?')
    return stmt.all(limit) as ActivityLogEntry[]
  }

  clearHistory(): void {
    this.db.prepare('DELETE FROM task_history').run()
    this.db.prepare('DELETE FROM activity_log').run()
  }
}
