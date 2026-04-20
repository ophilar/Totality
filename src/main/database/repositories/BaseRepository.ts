import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

/**
 * BaseRepository
 *
 * Abstract base class for all repositories.
 * Provides generic CRUD operations and common SQL patterns.
 */
export abstract class BaseRepository<T extends { id?: number }> {
  constructor(protected db: DatabaseSync, protected tableName: string) {}

  /**
   * Get a single record by ID
   */
  getById(id: number): T | null {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`)
    return (stmt.get(id) as unknown as T) || null
  }

  /**
   * Delete a record by ID
   */
  delete(id: number): boolean {
    const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`)
    const info = stmt.run(id) as unknown as { changes: number | bigint }
    return Number(info.changes) > 0
  }

  /**
   * Generic count method
   */
  protected countInternal(whereSql: string = '1=1', params: SQLInputValue[] = []): number {
    const sql = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${whereSql}`
    const stmt = this.db.prepare(sql)
    const result = stmt.get(...params) as unknown as { count: number } | undefined
    return result ? result.count : 0
  }

  /**
   * Update timestamps for a record
   */
  protected updateTimestamps(id: number): void {
    const stmt = this.db.prepare(`UPDATE ${this.tableName} SET updated_at = ? WHERE id = ?`)
    stmt.run(new Date().toISOString(), id)
  }

  /**
   * Helper to build paging SQL
   */
  protected buildPagingSql(limit?: number, offset?: number): string {
    let sql = ''
    if (limit !== undefined) {
      sql += ` LIMIT ${limit}`
    }
    if (offset !== undefined) {
      sql += ` OFFSET ${offset}`
    }
    return sql
  }

  /**
   * Execute a raw query and return results
   */
  protected queryAll<R = T>(sql: string, params: SQLInputValue[] = []): R[] {
    const stmt = this.db.prepare(sql)
    return stmt.all(...params) as unknown as R[]
  }

  /**
   * Execute a raw query and return a single result
   */
  protected queryOne<R = T>(sql: string, params: SQLInputValue[] = []): R | null {
    const stmt = this.db.prepare(sql)
    return (stmt.get(...params) as unknown as R) || null
  }
}
