import type { Client } from '@libsql/client'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { eq, sql, count, desc, asc, or, like, inArray } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'
import { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

type Predicate = SQL<unknown>
type SortExpression = SQLiteColumn | SQL<unknown>

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

  protected async withBatch<R>(fn: () => Promise<R>): Promise<R> {
    const { getDatabase } = await import('@main/database/BetterSQLiteService')
    return getDatabase().withBatch(fn)
  }

  public async processInChunks<T, R>(
    items: T[],
    batchSize: number,
    fn: (chunk: T[]) => Promise<R[]>
  ): Promise<R[]> {
    if (!items || items.length === 0) return []
    const results: R[] = []
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize)
      const res = await fn(chunk)
      if (res && Array.isArray(res)) results.push(...res)
    }
    return results
  }

  async getById(id: number): Promise<unknown | null> {
    const results = await this.drizzle.select().from(this.table).where(eq((this.table as TTable & { id: AnyColumn }).id, id)).limit(1)
    return results[0] || null
  }

  async delete(id: number): Promise<boolean> {
    await this.drizzle.delete(this.table).where(eq((this.table as TTable & { id: AnyColumn }).id, id))
    return true
  }

  protected async countInternal(where?: Predicate): Promise<number> {
    const result = await this.drizzle.select({ value: count() }).from(this.table).where(where)
    return result[0]?.value || 0
  }

  protected async listInternal<T = InferSelectModel<TTable>>(options: {
    where?: Predicate,
    orderBy?: SortExpression,
    limit?: number,
    offset?: number,
    joins?: <Q>(query: Q) => Q
  }): Promise<T[]> {
    let query = this.drizzle.select().from(this.table)
    if (options.joins) query = options.joins(query)
    if (options.where) query.where(options.where)
    if (options.orderBy) query.orderBy(options.orderBy)
    if (options.limit) query.limit(options.limit)
    if (options.offset) query.offset(options.offset)
    return await query.all() as T[]
  }

  protected buildOrder(sortBy: string = 'id', sortOrder: 'asc' | 'desc' = 'asc', customMap: Record<string, SortExpression> = {}) {
    const columns = this.table as TTable & Record<string, SortExpression>
    const col = customMap[sortBy] || columns[sortBy] || columns.id
    return sortOrder === 'desc' ? desc(col) : asc(col)
  }

  protected buildAlphabetFilter(column: SQLiteColumn, letter: string): SQL<unknown> {
    if (letter === '#') return sql`${column} NOT GLOB '[A-Za-z]*'`
    return eq(sql`UPPER(SUBSTR(${column}, 1, 1))`, letter.toUpperCase())
  }

  protected buildSearchFilter(columns: SQLiteColumn[], query: string): SQL<unknown> {
    const q = `%${query}%`
    return or(...columns.map(col => like(col, q)))!
  }

  protected async reconcileStaleItems(
    whereClause: Predicate,
    providerIdField: SQLiteColumn,
    validProviderIds: Set<string>
  ): Promise<number> {
    const idColumn = (this.table as TTable & { id: SQLiteColumn }).id
    const existing = await this.drizzle.select({ id: idColumn, providerId: providerIdField })
      .from(this.table).where(whereClause).all()
    const staleIds = existing.filter(item => !validProviderIds.has(String(item.providerId))).map(item => item.id)
    if (staleIds.length > 0) {
      const batchSize = 500
      let totalRemoved = 0
      for (let i = 0; i < staleIds.length; i += batchSize) {
        const batch = staleIds.slice(i, i + batchSize)
        const result = await this.drizzle.delete(this.table).where(inArray(idColumn, batch)).run()
        totalRemoved += Number(result.rowsAffected || 0)
      }
      return totalRemoved
    }
    return 0
  }

  protected async upsertWithProviderId<T extends SQLiteTable>(
    table: T,
    data: unknown,
    uniqueConstraint: unknown[],
    updateFields: unknown
  ): Promise<number> {
    const now = new Date().toISOString()
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new TypeError('Repository upsert data must be an object')
    }
    if (typeof updateFields !== 'object' || updateFields === null || Array.isArray(updateFields)) {
      throw new TypeError('Repository update fields must be an object')
    }
    const insertData = { ...(data as Omit<InferInsertModel<T>, 'createdAt' | 'updatedAt'>), createdAt: now, updatedAt: now }
    const conflictTarget = uniqueConstraint as SQLiteColumn[]
    const updateData = { ...(updateFields as Partial<Omit<InferInsertModel<T>, 'createdAt' | 'updatedAt'>>), updatedAt: now }
    const result = await this.drizzle.insert(table)
      .values(insertData as InferInsertModel<T>)
      .onConflictDoUpdate({ target: conflictTarget, set: updateData })
      .returning({ id: (table as T & { id: SQLiteColumn }).id })
    return Number(result[0]?.id ?? 0)
  }

  protected async bulkUpsertWithProviderId<T extends SQLiteTable>(
    table: T,
    items: unknown[],
    uniqueConstraint: unknown[],
    updateFields: unknown
  ): Promise<number> {
    if (!items || items.length === 0) return 0
    const now = new Date().toISOString()

    const insertDataList = items.map((data) => {
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new TypeError('Repository upsert data must be an object')
      }
      return { ...(data as Omit<InferInsertModel<T>, 'createdAt' | 'updatedAt'>), createdAt: now, updatedAt: now }
    })

    if (typeof updateFields !== 'object' || updateFields === null || Array.isArray(updateFields)) {
      throw new TypeError('Repository update fields must be an object')
    }

    const conflictTarget = uniqueConstraint as SQLiteColumn[]
    const updateData = { ...(updateFields as Partial<Omit<InferInsertModel<T>, 'createdAt' | 'updatedAt'>>), updatedAt: now }

    const batchSize = 500
    let totalUpserted = 0

    for (let i = 0; i < insertDataList.length; i += batchSize) {
      const batch = insertDataList.slice(i, i + batchSize)
      const result = await this.drizzle.insert(table)
        .values(batch as InferInsertModel<T>[])
        .onConflictDoUpdate({ target: conflictTarget, set: updateData })
        .returning({ id: (table as T & { id: SQLiteColumn }).id })
      totalUpserted += result.length
    }

    return totalUpserted
  }
}
