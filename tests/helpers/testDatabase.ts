/**
 * Test database adapter using the official SQLite Wasm build.
 *
 * SQLite Wasm runs in Node.js with in-memory databases and includes FTS5,
 * allowing database services to be exercised against SQLite itself.
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { Database as SqliteDatabase, SqlValue } from '@sqlite.org/sqlite-wasm'
import { DATABASE_SCHEMA } from '../../src/main/database/schema'

interface RunResult {
  changes: number
  lastInsertRowid: number
}

interface PreparedStatement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
}

export interface TestDatabase {
  prepare(sql: string): PreparedStatement
  exec(sql: string): void
  pragma(str: string): unknown
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T
  close(): void
}

function bindValues(params: unknown[]): SqlValue[] {
  return params as SqlValue[]
}

function createAdapter(db: SqliteDatabase): TestDatabase {
  return {
    prepare(sql: string): PreparedStatement {
      return {
        run(...params: unknown[]): RunResult {
          const statement = db.prepare(sql)
          try {
            if (params.length > 0) statement.bind(bindValues(params))
            statement.step()
            return {
              changes: Number(db.changes()),
              lastInsertRowid: Number(db.exec('SELECT last_insert_rowid()', {
                rowMode: 0,
                returnValue: 'resultRows',
              })[0]),
            }
          } finally {
            statement.finalize()
          }
        },
        get(...params: unknown[]): Record<string, unknown> | undefined {
          const statement = db.prepare(sql)
          try {
            if (params.length > 0) statement.bind(bindValues(params))
            if (!statement.step()) return undefined
            return statement.get({})
          } finally {
            statement.finalize()
          }
        },
        all(...params: unknown[]): Record<string, unknown>[] {
          const statement = db.prepare(sql)
          try {
            if (params.length > 0) statement.bind(bindValues(params))
            const rows: Record<string, unknown>[] = []
            while (statement.step()) rows.push(statement.get({}))
            return rows
          } finally {
            statement.finalize()
          }
        },
      }
    },

    exec(sql: string): void {
      db.exec(sql)
    },

    pragma(str: string): unknown {
      return db.exec(`PRAGMA ${str}`, { rowMode: 'object', returnValue: 'resultRows' })
    },

    transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
      return (...args: unknown[]) => {
        db.exec('BEGIN TRANSACTION')
        try {
          const result = fn(...args)
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    },

    close(): void {
      db.close()
    },
  }
}

/** Create an in-memory SQLite database with the full application schema. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const sqlite3 = await sqlite3InitModule()
  const db = new sqlite3.oo1.DB(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DATABASE_SCHEMA)

  return createAdapter(db)
}

/**
 * Create a constructor for tests that need to inject the in-memory database.
 * Must be called before importing BetterSQLiteService.
 */
export async function createBetterSqliteMock(): Promise<{
  testDb: TestDatabase
  mockConstructor: new (...args: unknown[]) => TestDatabase
}> {
  const testDb = await createTestDatabase()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockConstructor = function(this: any) {
    Object.assign(this, testDb)
    return this
  } as unknown as new (...args: unknown[]) => TestDatabase

  Object.setPrototypeOf(mockConstructor.prototype, Object.getPrototypeOf(testDb))

  return { testDb, mockConstructor }
}
