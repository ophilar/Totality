import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('Scoped transaction integrity', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  beforeEach(async () => { db = await setupTestDb() })
  afterEach(() => { cleanupTestDb() })

  it('commits concurrent scoped writers without cross-closing', async () => {
    const write = (key: string) => db.withBatch(async () => {
      await db.db.execute({ sql: 'INSERT INTO settings (key, value) VALUES (?, ?)', args: [key, 'done'] })
      await new Promise(resolve => setTimeout(resolve, 5))
    })
    await Promise.all([write('a'), write('b')])
    expect(await db.config.getSetting('a')).toBe('done')
    expect(await db.config.getSetting('b')).toBe('done')
    expect(db.isInTransaction()).toBe(false)
  })

  it('rolls back a failed scoped batch', async () => {
    await expect(db.withBatch(async () => {
      await db.db.execute({ sql: 'INSERT INTO settings (key, value) VALUES (?, ?)', args: ['failed', 'no'] })
      throw new Error('scoped write failed')
    })).rejects.toThrow('scoped write failed')
    expect(await db.config.getSetting('failed')).toBeNull()
    expect(db.isInTransaction()).toBe(false)
  })

  it('rejects nested transaction scopes immediately without deadlocking', async () => {
    await expect(db.withBatch(async () => {
      await db.withBatch(async () => {
        await db.db.execute({ sql: 'INSERT INTO settings (key, value) VALUES (?, ?)', args: ['nested', 'fail'] })
      })
    })).rejects.toThrow('Cannot start scoped transaction while another batch is active')
    expect(db.isInTransaction()).toBe(false)
  })

  it('preserves the primary error on rollback', async () => {
    const error = new Error('primary write failure')
    await expect(db.withBatch(async () => {
      throw error
    })).rejects.toThrow('primary write failure')
    expect(db.isInTransaction()).toBe(false)
  })
})
