/**
 * Centralized database getter
 *
 * This module provides a single entry point for getting the database service.
 * Strictly uses BetterSQLite3 for performance and modern feature support.
 *
 * Usage:
 *   import { getDatabase } from '../database/getDatabase'
 *   const db = getDatabase()
 */

import { getBetterSQLiteService, BetterSQLiteService } from './BetterSQLiteService'

/**
 * Get the database service instance (synchronous)
 */
export function getDatabase(): BetterSQLiteService {
  return getBetterSQLiteService()
}

/**
 * Alias for getDatabase() - for compatibility with existing code
 */
export const getDatabaseService = getDatabase
