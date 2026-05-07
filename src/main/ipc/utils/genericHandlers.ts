
import { ipcMain } from 'electron'
import { validateInput } from '@main/validation/schemas'
import { getLoggingService } from '@main/services/LoggingService'
import { z } from 'zod'

/**
 * Register standard list and count IPC handlers for a resource.
 * 
 * @param baseChannel - The base name for the IPC channels (e.g. 'music:artists')
 * @param listFn - Function to fetch the list of items
 * @param countFn - Function to fetch the total count of items
 * @param filtersSchema - Zod schema to validate incoming filters
 * @param options - Additional registration options (aliases for backward compatibility)
 */
export function registerListHandlers<T, TFilters>(
  baseChannel: string,
  listFn: (filters: TFilters) => T[] | Promise<T[]>,
  countFn: (filters: TFilters) => number | Promise<number>,
  filtersSchema: z.ZodSchema<TFilters>,
  options: { listAlias?: string | string[]; countAlias?: string | string[] } = {}
): void {
  const log = getLoggingService()

  const listHandler = async (_event: any, filters: unknown) => {
    try {
      const validFilters = validateInput(filtersSchema, filters, `${baseChannel}:list`)
      return await listFn(validFilters)
    } catch (error) {
      log.error('[IPC]', `Error in ${baseChannel}:list:`, error)
      throw error
    }
  }

  const countHandler = async (_event: any, filters: unknown) => {
    try {
      const validFilters = validateInput(filtersSchema, filters, `${baseChannel}:count`)
      return await countFn(validFilters)
    } catch (error) {
      log.error('[IPC]', `Error in ${baseChannel}:count:`, error)
      throw error
    }
  }

  // Register standard channels
  ipcMain.handle(`${baseChannel}:list`, listHandler)
  ipcMain.handle(`${baseChannel}:count`, countHandler)

  // Register aliases if provided
  const registerAliases = (aliases: string | string[] | undefined, handler: any) => {
    if (!aliases) return
    const list = Array.isArray(aliases) ? aliases : [aliases]
    for (const alias of list) {
      ipcMain.handle(alias, handler)
    }
  }

  registerAliases(options.listAlias, listHandler)
  registerAliases(options.countAlias, countHandler)

  log.info('[IPC]', `Registered handlers for ${baseChannel}`)
}
