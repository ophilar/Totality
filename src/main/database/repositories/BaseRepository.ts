import type { Client, Value } from '@libsql/client'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { getDatabase } from '@main/database/BetterSQLiteService'

/**
 * BaseRepository
 *
 * Abstract base class for all repositories.
 * Provides generic CRUD operations and common SQL patterns.
 */
export abstract class BaseRepository<T extends { id?: number }> {
  constructor(
    protected db: Client, 
    protected tableName: string,
    protected drizzle: LibSQLDatabase<typeof schema>
  ) {}

  protected async beginBatch(): Promise<void> {
    await getDatabase().beginBatch()
  }

  protected async endBatch(): Promise<void> {
    await getDatabase().endBatch()
  }

  protected async rollbackBatch(): Promise<void> {
    await getDatabase().rollbackBatch()
  }

  /**
   * Get a single record by ID.
   * Uses raw SQL to avoid Drizzle query builder issues with dynamic table names.
   */
  async getById(id: number): Promise<T | null> {
    const result = await this.db.execute({
      sql: `SELECT * FROM ${this.tableName} WHERE id = ?`,
      args: [id]
    })
    return (result.rows[0] as unknown as T) || null
  }

  /**
   * Delete a record by ID
   */
  async delete(id: number): Promise<boolean> {
    await this.db.execute({
      sql: `DELETE FROM ${this.tableName} WHERE id = ?`,
      args: [id]
    })
    return true
  }

  /**
   * Generic count method
   */
  protected async countInternal(whereSql: string = '1=1', params: Value[] = []): Promise<number> {
    const result = await this.db.execute({ 
      sql: `SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${whereSql}`, 
      args: params 
    })
    return (result.rows[0]?.count as number) || 0
  }

  /**
   * Update timestamps for a record
   */
  protected async updateTimestamps(id: number): Promise<void> {
    await this.db.execute({
      sql: `UPDATE ${this.tableName} SET updated_at = ? WHERE id = ?`,
      args: [new Date().toISOString(), id]
    })
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
  protected async queryAll<R = T>(sql: string, params: Value[] = []): Promise<R[]> {
    const result = await this.db.execute({ sql, args: params })
    return result.rows as unknown as R[]
  }

  /**
   * Execute a raw query and return a single result
   */
  protected async queryOne<R = T>(sql: string, params: Value[] = []): Promise<R | null> {
    const result = await this.db.execute({ sql, args: params })
    return (result.rows[0] as unknown as R) || null
  }
}
