import { desc, eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import * as schema from '@main/database/drizzleSchema'
import type { Client } from '@libsql/client'

export type MediaRemuxJobStatus = 'planned' | 'running' | 'verified' | 'promoted' | 'failed'
export type MediaRemuxJob = typeof schema.mediaRemuxJobs.$inferSelect

export class MediaRemuxJobRepository {
  constructor(_db: Client, private readonly drizzle: LibSQLDatabase<typeof schema>) {}

  async create(data: Omit<typeof schema.mediaRemuxJobs.$inferInsert, 'id'>): Promise<number> {
    const result = await this.drizzle.insert(schema.mediaRemuxJobs).values(data).returning({ id: schema.mediaRemuxJobs.id })
    return result[0].id
  }

  async update(id: number, data: Partial<typeof schema.mediaRemuxJobs.$inferInsert>): Promise<void> {
    await this.drizzle.update(schema.mediaRemuxJobs).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.mediaRemuxJobs.id, id))
  }

  async getLatest(mediaItemId: number): Promise<MediaRemuxJob | null> {
    return await this.drizzle.select().from(schema.mediaRemuxJobs)
      .where(eq(schema.mediaRemuxJobs.mediaItemId, mediaItemId))
      .orderBy(desc(schema.mediaRemuxJobs.updatedAt)).limit(1).get() || null
  }
}
