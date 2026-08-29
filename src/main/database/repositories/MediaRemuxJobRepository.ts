import { desc, eq, and, isNotNull } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import type { Client } from '@libsql/client'

export type MediaRemuxJobStatus = 'planned' | 'running' | 'verified' | 'promoted' | 'failed'
export type MediaRemuxJob = typeof schema.mediaOptimizationJobs.$inferSelect

export class MediaRemuxJobRepository {
  constructor(_db: Client, private readonly drizzle: LibSQLDatabase<typeof schema>) {}

  async create(data: Omit<typeof schema.mediaOptimizationJobs.$inferInsert, 'id'>): Promise<number> {
    const result = await this.drizzle.insert(schema.mediaOptimizationJobs).values(data).returning({ id: schema.mediaOptimizationJobs.id })
    return result[0].id
  }

  async update(id: number, data: Partial<typeof schema.mediaOptimizationJobs.$inferInsert>): Promise<void> {
    await this.drizzle.update(schema.mediaOptimizationJobs).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.mediaOptimizationJobs.id, id))
  }

  async getLatest(mediaItemId: number): Promise<MediaRemuxJob | null> {
    return await this.drizzle.select().from(schema.mediaOptimizationJobs)
      .where(eq(schema.mediaOptimizationJobs.mediaItemId, mediaItemId))
      .orderBy(desc(schema.mediaOptimizationJobs.updatedAt)).limit(1).get() || null
  }

  async getCalibratedOutputBytes(sourceSize: number, operationKind: string, encoderProfile: string): Promise<number | null> {
    const rows = await this.drizzle.select({ sourceSize: schema.mediaOptimizationJobs.sourceSize, actualOutputBytes: schema.mediaOptimizationJobs.actualOutputBytes })
      .from(schema.mediaOptimizationJobs)
      .where(and(
        eq(schema.mediaOptimizationJobs.operationKind, operationKind),
        eq(schema.mediaOptimizationJobs.status, 'promoted'),
        eq(schema.mediaOptimizationJobs.encoderProfile, encoderProfile),
        isNotNull(schema.mediaOptimizationJobs.actualOutputBytes),
      )).all()
    if (rows.length < 5) return null
    const ratios = rows
      .filter(row => row.sourceSize > 0 && row.actualOutputBytes != null && row.actualOutputBytes > 0)
      .map(row => row.actualOutputBytes! / row.sourceSize)
      .sort((left, right) => left - right)
    if (ratios.length < 5) return null
    const middle = Math.floor(ratios.length / 2)
    const ratio = ratios.length % 2 === 1 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2
    return Math.round(sourceSize * ratio)
  }
}
