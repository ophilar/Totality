/**
 * Database Migration Utility
 *
 * Handles transition to better-sqlite3.
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { getLoggingService } from '../services/LoggingService'

interface MigrationResult {
  success: boolean
  tablesExported: number
  rowsExported: number
  rowsImported: number
  errors: string[]
  backupPath?: string
}

/**
 * Check if migration from SQL.js to better-sqlite3 is needed
 */
export function needsMigration(): boolean {
  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const betterSqliteDbPath = path.join(userDataPath, 'totality-v2.db')

  // Migration needed if legacy SQL.js db exists but better-sqlite3 doesn't
  const sqlJsExists = fs.existsSync(sqlJsDbPath)
  const betterSqliteExists = fs.existsSync(betterSqliteDbPath)

  return sqlJsExists && !betterSqliteExists
}

/**
 * Check if we should use better-sqlite3 (always true in v0.4.0+)
 */
export function shouldUseBetterSqlite(): boolean {
  return true
}

/**
 * Transition data from SQL.js to better-sqlite3
 * Note: Real data migration is deprecated in v0.4.0 as SQL.js is removed.
 * Legacy databases are simply backed up to encourage a fresh high-performance scan.
 */
export async function migrateDatabase(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    tablesExported: 0,
    rowsExported: 0,
    rowsImported: 0,
    errors: [],
  }

  const userDataPath = app.getPath('userData')
  const sqlJsDbPath = path.join(userDataPath, 'totality.db')
  const backupPath = path.join(userDataPath, 'totality.db.legacy-backup')

  try {
    if (fs.existsSync(sqlJsDbPath)) {
      getLoggingService().info('[DatabaseMigration]', '[Migration] Legacy SQL.js database found. Backing up and requiring new scan for v0.4.0 performance features.')
      fs.renameSync(sqlJsDbPath, backupPath)
      result.backupPath = backupPath
    }
    return result
  } catch (error) {
    getLoggingService().error('[DatabaseMigration]', '[Migration] Failed to backup legacy database:', error)
    result.success = false
    result.errors.push(String(error))
    return result
  }
}
