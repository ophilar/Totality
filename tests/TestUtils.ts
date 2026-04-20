import { vi } from 'vitest'
import { BetterSQLiteService, resetBetterSQLiteServiceForTesting, getBetterSQLiteService } from '../src/main/database/BetterSQLiteService'
import * as dbFuncs from '../src/main/database/getDatabase'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Standard setup for tests that need a real database.
 * Returns the BetterSQLiteService instance.
 */
export async function setupTestDb(): Promise<BetterSQLiteService> {
  resetBetterSQLiteServiceForTesting()
  
  // Ensure NODE_ENV is set so BetterSQLiteService uses the test path
  process.env.NODE_ENV = 'test'
  
  const db = getBetterSQLiteService()
  await db.initialize()
  
  // Spy on getDatabase to return our standard instance
  vi.spyOn(dbFuncs, 'getDatabase').mockReturnValue(db)
  
  return db
}

/**
 * Standard cleanup for tests using setupTestDb.
 */
export function cleanupTestDb() {
  resetBetterSQLiteServiceForTesting()
  vi.restoreAllMocks()
  
  // Optionally clean up the tests/tmp directory if it gets too large
  // but usually it's better to leave it for debugging failed tests
}

/**
 * Creates a real temporary directory for file-based tests.
 * Returns the path and a cleanup function.
 */
export function createTempDir(name: string): { path: string; cleanup: () => void } {
  const tmpRoot = path.join(process.cwd(), 'tests', 'tmp')
  if (!fs.existsSync(tmpRoot)) fs.mkdirSync(tmpRoot, { recursive: true })
  
  const dirPath = path.join(tmpRoot, `${name}-${Math.random().toString(36).substring(7)}`)
  fs.mkdirSync(dirPath, { recursive: true })
  
  return {
    path: dirPath,
    cleanup: () => {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true })
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}
