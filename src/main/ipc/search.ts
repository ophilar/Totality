import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { z } from 'zod'
import { getDatabase } from '@main/database/BetterSQLiteService'

export function registerSearchHandlers() {
  createValidatedIpcHandler('db:search-global', z.string().min(1), async (query) => {
    const db = getDatabase()
    return await db.globalSearch.search(query as string)
  })
}
