import type { Client, Value } from '@libsql/client'
import { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { eq, sql, count, desc, asc } from 'drizzle-orm'
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

  protected buildOrder(sortBy: string = 'id', sortOrder: 'asc' | 'desc' = 'asc') {
    const col = (this.table as any)[sortBy] || (this.table as any).id
    return sortOrder === 'desc' ? desc(col) : asc(col)
  }

  /**
   * Reconciliation pattern: Remove items for a provider/library that were not seen in a set of valid IDs.
   */
  protected async reconcileStaleItems(
    whereClause: any,
    providerIdField: any,
    validProviderIds: Set<string>
  ): Promise<number> {
    const existing = await this.drizzle.select({ id: (this.table as any).id, providerId: providerIdField }).from(this.table).where(whereClause)
    const staleIds = existing.filter(item => !validProviderIds.has(item.providerId)).map(item => item.id)

    if (staleIds.length > 0) {
      // Drizzle 'inArray' or raw SQL delete
      const result = await this.db.execute({
        sql: `DELETE FROM ${this.tableName} WHERE id IN (${staleIds.join(',')})`,
        args: []
      })
      return Number(result.rowsAffected)
    }
    return 0
  }

  /**
   * Standardized upsert logic for tables with a unique provider ID.
   */
  protected async upsertWithProviderId(
    data: any,
    uniqueConstraint: any[],
    updateFields: any
  ): Promise<number> {
    const result = await this.drizzle.insert(this.table)
      .values(data)
      .onConflictDoUpdate({
        target: uniqueConstraint,
        set: { ...updateFields, updatedAt: new Date().toISOString() }
      })
      .returning({ id: (this.table as any).id })
    return result[0]?.id
  }
}
