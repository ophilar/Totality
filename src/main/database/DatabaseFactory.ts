import { BetterSQLiteService, getBetterSQLiteService } from './BetterSQLiteService'

/**
 * Database Factory
 *
 * Provides a factory function to get the appropriate database service.
 * Now strictly defaults to BetterSQLite3 for high performance and advanced features.
 */

/**
 * Get the synchronous database service
 */
export function getDatabaseServiceSync(): BetterSQLiteService {
  return getBetterSQLiteService()
}

/**
 * Get the database service instance (async version)
 */
export async function getDatabaseServiceAsync(): Promise<BetterSQLiteService> {
  const service = getBetterSQLiteService()
  if (!service.isInitialized) {
    await service.initialize()
  }
  return service
}

/**
 * Get the database instance (legacy-compatible name)
 */
export function getDatabase(): BetterSQLiteService {
  return getBetterSQLiteService()
}

/**
 * Check which backend is currently configured (always better-sqlite3 now)
 */
export function getDatabaseBackend(): 'better-sqlite3' {
  return 'better-sqlite3'
}
