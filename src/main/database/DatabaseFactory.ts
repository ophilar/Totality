/**
 * Database Factory
 *
 * Provides the database service instance using better-sqlite3.
 * SQL.js backend was removed — better-sqlite3 is the sole database backend.
 * (sql.js is still used by KodiLocalProvider and MediaMonkeyProvider
 *  to read external database files, but not for the app's own database.)
 */

import { getBetterSQLiteService } from './BetterSQLiteService'

import type { DatabaseServiceInterface } from './DatabaseInterface'
export type { DatabaseServiceInterface }

/**
 * Get the database service instance (synchronous)
 * Should only be called after app.whenReady() and database initialization
 */
export function getDatabaseServiceSync(): DatabaseServiceInterface {
  return getBetterSQLiteService()
}
