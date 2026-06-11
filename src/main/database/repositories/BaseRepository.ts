import type { Client } from '@libsql/client'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { eq, sql, count, desc, asc, or, like, inArray } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'

/**
 * BaseRepository
 *
 * Provides generic CRUD operations for any Drizzle table.
 */
export abstract class BaseRepository<TTable extends SQLiteTable> {
  constructor(
    protected db: Client,
    protected tableName: string,
    protected drizzle: LibSQLDatabase<typeof schema>,
    protected table: TTable
  ) {}

  protected async beginBatch(): Promise<void> { await getDatabase().beginBatch() }
  protected async endBatch(): Promise<void> { await getDatabase().endBatch() }
  protected async rollbackBatch(): Promise<void> { await getDatabase().rollbackBatch() }

  async getById(id: number): Promise<any | null> {
    const results = await this.drizzle.select().from(this.table).where(eq((this.table as any).id, id)).limit(1)
    return results[0] || null
  }

  async delete(id: number): Promise<boolean> {
    await this.drizzle.delete(this.table).where(eq((this.table as any).id, id))
    return true
  }

  protected async countInternal(where?: any): Promise<number> {
    const result = await this.drizzle.select({ value: count() }).from(this.table).where(where)
    return result[0]?.value || 0
  }

  protected async listInternal<T = any>(options: {
    where?: any,
    orderBy?: any,
    limit?: number,
    offset?: number,
    joins?: (query: any) => any
  }): Promise<T[]> {
    let query = this.drizzle.select().from(this.table)
    if (options.joins) query = options.joins(query) as any
    if (options.where) query.where(options.where)
    if (options.orderBy) query.orderBy(options.orderBy)
    if (options.limit) query.limit(options.limit)
    if (options.offset) query.offset(options.offset)
    
    return await query.all() as T[]
  }

  protected buildOrder(sortBy: string = 'id', sortOrder: 'asc' | 'desc' = 'asc', customMap: Record<string, any> = {}) {
    const col = customMap[sortBy] || (this.table as any)[sortBy] || (this.table as any).id
    return sortOrder === 'desc' ? desc(col) : asc(col)
  }

  /**
   * Standardized alphabet filter logic for SQL.
   */
  protected buildAlphabetFilter(column: any, letter: string) {
    if (letter === '#') {
      return sql`${column} NOT GLOB '[A-Za-z]*'`
    }
    return eq(sql`UPPER(SUBSTR(${column}, 1, 1))`, letter.toUpperCase())
  }

  /**
   * Standardized search filter logic.
   */
  protected buildSearchFilter(columns: any[], query: string) {
    const q = `%${query}%`
    return or(...columns.map(col => like(col, q)))
  }

  /**
   * Reconciliation pattern: Remove items for a provider/library that were not seen in a set of valid IDs.
   */
  protected async reconcileStaleItems(
    whereClause: any,
    providerIdField: any,
    validProviderIds: Set<string>
  ): Promise<number> {
    const existing = await this.drizzle.select({ id: (this.table as any).id, providerId: providerIdField })
      .from(this.table)
      .where(whereClause)
      .all()
    
    const staleIds = existing.filter(item => !validProviderIds.has(item.providerId)).map(item => item.id)

    if (staleIds.length > 0) {
      // Chunk deletion to avoid SQLITE_LIMIT_VARIABLE_NUMBER
      const batchSize = 500
      let totalRemoved = 0
      for (let i = 0; i < staleIds.length; i += batchSize) {
        const batch = staleIds.slice(i, i + batchSize)
        const result = await this.drizzle.delete(this.table)
          .where(inArray((this.table as any).id, batch))
          .run()
        totalRemoved += Number(result.rowsAffected || 0)
      }
      return totalRemoved
    }
    return 0
  }

  /**
   * Standardized upsert logic for tables with a unique provider ID.
   */
  protected async upsertWithProviderId(
    table: any,
    data: any,
    uniqueConstraint: any[],
    updateFields: any
  ): Promise<number> {
    const now = new Date().toISOString()
    const result = await this.drizzle.insert(table)
      .values({ ...data, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: uniqueConstraint,
        set: { ...updateFields, updatedAt: now }
      })
      .returning({ id: (table as any).id })
    return result[0]?.id
  }
}
