
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
  options: { listAlias?: string; countAlias?: string } = {}
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
  if (options.listAlias) ipcMain.handle(options.listAlias, listHandler)
  if (options.countAlias) ipcMain.handle(options.countAlias, countHandler)

  log.info('[IPC]', `Registered handlers for ${baseChannel}${options.listAlias ? ` (aliases: ${options.listAlias}, ${options.countAlias})` : ''}`)
}
