/**
 * Database entry point. better-sqlite3 is the application's sole database backend.
 * External Kodi/MediaMonkey database readers are independent of this instance.
 */
import { getBetterSQLiteService } from './BetterSQLiteService'
import type { DatabaseServiceInterface } from './DatabaseInterface'

export type { DatabaseServiceInterface }

// Preserve the existing API name without an unnecessary delegate function.
export const getDatabaseServiceSync: () => DatabaseServiceInterface = getBetterSQLiteService
