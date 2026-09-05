/**
 * IPC Handler Wrapper Utility
 *
 * Provides a consistent pattern for creating IPC handlers with:
 * - Error handling and logging
 * - Type safety
 * - Reduced boilerplate
 */

import { ipcMain, IpcMainInvokeEvent, app } from 'electron'
import { getErrorMessage } from '@main/services/utils/errorUtils'
import { getLoggingService } from '@main/services/LoggingService'
import { z } from 'zod'
import { validateInput } from '@main/validation/schemas'

/**
 * Options for creating an IPC handler
 */
export interface HandlerOptions {
  /** Whether to log the channel name on each call (for debugging) */
  logCalls?: boolean
  /** Custom error handler (default: logs error and rethrows) */
  onError?: (channel: string, error: unknown) => void
}

/**
 * Validates that an incoming IPC message originates from an authorized local frame.
 * Enforces fail-closed security: missing events, missing sender frames, or missing URLs are rejected.
 */
export function validateSenderFrame(event: IpcMainInvokeEvent, channel: string): void {
  // Vitest / testing environment passes mock events without real Electron webContents
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    if (event?.senderFrame?.url) {
      const frameUrl = event.senderFrame.url
      const isAllowedDev = frameUrl.startsWith('http://localhost:') || frameUrl.startsWith('http://127.0.0.1:')
      const isAllowedApp = frameUrl.startsWith('file://') || frameUrl.startsWith('app://') || frameUrl.startsWith('local-artwork://')
      if (!isAllowedDev && !isAllowedApp) {
        getLoggingService().error('[IPC Security]', `Rejected unauthorized IPC request on ${channel} from frame URL: ${frameUrl}`)
        throw new Error(`Unauthorized IPC sender frame for ${channel}: ${frameUrl}`)
      }
    }
    return
  }

  if (!event || !event.senderFrame) {
    getLoggingService().error('[IPC Security]', `Rejected unauthorized IPC request on ${channel}: missing event or senderFrame`)
    throw new Error(`Unauthorized IPC request on ${channel}: missing sender frame`)
  }

  const frameUrl = event.senderFrame.url
  if (!frameUrl) {
    getLoggingService().error('[IPC Security]', `Rejected unauthorized IPC request on ${channel}: missing frame URL`)
    throw new Error(`Unauthorized IPC request on ${channel}: missing frame URL`)
  }

  const isDev = !app?.isPackaged || process.env.NODE_ENV === 'development'
  const isAllowedDev = isDev && (frameUrl.startsWith('http://localhost:') || frameUrl.startsWith('http://127.0.0.1:'))
  const isAllowedApp = frameUrl.startsWith('file://') || frameUrl.startsWith('app://') || frameUrl.startsWith('local-artwork://')

  if (!isAllowedDev && !isAllowedApp) {
    getLoggingService().error('[IPC Security]', `Rejected unauthorized IPC request on ${channel} from frame URL: ${frameUrl}`)
    throw new Error(`Unauthorized IPC sender frame for ${channel}: ${frameUrl}`)
  }
}

/**
 * Create a type-safe IPC handler with consistent validation and error handling.
 * 
 * If the schema is a ZodTuple, it validates the entire arguments array.
 * Otherwise, it validates the first argument (args[0]).
 */
export function createValidatedIpcHandler<TSchema extends z.ZodSchema<unknown>, TReturn>(
  channel: string,
  schema: TSchema,
  handler: z.infer<TSchema> extends unknown[]
    ? (number extends z.infer<TSchema>['length']
        ? (arg: z.infer<TSchema>) => Promise<TReturn>
        : (...args: Extract<z.infer<TSchema>, unknown[]>) => Promise<TReturn>)
    : (arg: z.infer<TSchema>) => Promise<TReturn>,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      validateSenderFrame(event, channel)
      if (options.logCalls) {
        getLoggingService().info('[IPC]', `${channel} called`)
      }

      const isTuple = schema instanceof z.ZodTuple
      const validated = isTuple 
        ? validateInput(schema, args, channel)
        : validateInput(schema, args[0], channel)

      if (isTuple && Array.isArray(validated)) {
        return await (handler as unknown as (...args: unknown[]) => Promise<TReturn>)(...validated)
      } else {
        return await (handler as unknown as (arg: unknown) => Promise<TReturn>)(validated)
      }
    } catch (error) {
      const message = getErrorMessage(error)
      getLoggingService().error('[IPC]', `Error in ${channel}:`, message)

      if (options.onError) {
        options.onError(channel, error)
      }

      throw error
    }
  })
}

/**
 * Same as createValidatedIpcHandler but passes the Electron IpcMainInvokeEvent as the first argument.
 */
export function createValidatedIpcHandlerWithEvent<TSchema extends z.ZodSchema<unknown>, TReturn>(
  channel: string,
  schema: TSchema,
  handler: z.infer<TSchema> extends unknown[]
    ? (number extends z.infer<TSchema>['length']
        ? (event: IpcMainInvokeEvent, arg: z.infer<TSchema>) => Promise<TReturn>
        : (event: IpcMainInvokeEvent, ...args: Extract<z.infer<TSchema>, unknown[]>) => Promise<TReturn>)
    : (event: IpcMainInvokeEvent, arg: z.infer<TSchema>) => Promise<TReturn>,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      validateSenderFrame(event, channel)
      if (options.logCalls) {
        getLoggingService().info('[IPC]', `${channel} called`)
      }

      const isTuple = schema instanceof z.ZodTuple
      const validated = isTuple 
        ? validateInput(schema, args, channel)
        : validateInput(schema, args[0], channel)

      if (isTuple && Array.isArray(validated)) {
        return await (handler as unknown as (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<TReturn>)(event, ...validated)
      } else {
        return await (handler as unknown as (event: IpcMainInvokeEvent, arg: unknown) => Promise<TReturn>)(event, validated)
      }
    } catch (error) {
      const message = getErrorMessage(error)
      getLoggingService().error('[IPC]', `Error in ${channel}:`, message)

      if (options.onError) {
        options.onError(channel, error)
      }

      throw error
    }
  })
}

/**
 * Create a type-safe IPC handler with consistent error handling
 */
export function createIpcHandler<TArgs extends unknown[], TReturn>(
  channel: string,
  handler: (...args: TArgs) => Promise<TReturn>,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      validateSenderFrame(event, channel)
      if (options.logCalls) {
        getLoggingService().info('[IPC]', `${channel} called`)
      }
      return await handler(...(args as TArgs))
    } catch (error) {
      const message = getErrorMessage(error)
      getLoggingService().error('[IPC]', `Error in ${channel}:`, message)

      if (options.onError) {
        options.onError(channel, error)
      }

      throw error
    }
  })
}

/**
 * Create a type-safe IPC handler that receives the event object
 * Use this when you need access to the IpcMainInvokeEvent (e.g., to get the sender window)
 *
 * @example
 * createIpcHandlerWithEvent('dialog:open', async (event, options) => {
 *   const win = BrowserWindow.fromWebContents(event.sender)
 *   return await dialog.showOpenDialog(win!, options)
 * })
 */
export function createIpcHandlerWithEvent<TArgs extends unknown[], TReturn>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TReturn>,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      validateSenderFrame(event, channel)
      if (options.logCalls) {
        getLoggingService().info('[IPC]', `${channel} called`)
      }
      return await handler(event, ...(args as TArgs))
    } catch (error) {
      const message = getErrorMessage(error)
      getLoggingService().error('[IPC]', `Error in ${channel}:`, message)

      if (options.onError) {
        options.onError(channel, error)
      }

      throw error
    }
  })
}

/**
 * Create a synchronous IPC handler (for quick, non-blocking operations)
 * Use sparingly - prefer async handlers in most cases
 */
export function createSyncHandler<TArgs extends unknown[], TReturn>(
  channel: string,
  handler: (...args: TArgs) => TReturn,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      validateSenderFrame(event, channel)
      if (options.logCalls) {
        getLoggingService().info('[IPC]', `${channel} called (sync)`)
      }
      return handler(...(args as TArgs))
    } catch (error) {
      const message = getErrorMessage(error)
      getLoggingService().error('[IPC]', `Error in ${channel}:`, message)

      if (options.onError) {
        options.onError(channel, error)
      }

      throw error
    }
  })
}

/**
 * Register multiple handlers at once from a handler map
 *
 * @example
 * registerHandlers({
 *   'sources:list': async () => db.getSources(),
 *   'sources:get': async (id: string) => db.getSource(id),
 *   'sources:add': async (config: SourceConfig) => sourceManager.addSource(config),
 * })
 */
export function registerHandlers(
  handlers: Record<string, (...args: unknown[]) => Promise<unknown>>,
  options: HandlerOptions = {}
): void {
  for (const [channel, handler] of Object.entries(handlers)) {
    createIpcHandler(channel, handler, options)
  }
}

/**
 * Register standard list and count IPC handlers for a resource with schema validation.
 */
export function registerListHandlers<T, TFilters>(
  baseChannel: string,
  listFn: (filters: TFilters) => T[] | Promise<T[]>,
  countFn: (filters: TFilters) => number | Promise<number>,
  filtersSchema: z.ZodSchema<TFilters>,
  options: HandlerOptions = {}
): void {
  createValidatedIpcHandler(`${baseChannel}:list`, filtersSchema, async (filters: TFilters) => listFn(filters), options)
  createValidatedIpcHandler(`${baseChannel}:count`, filtersSchema, async (filters: TFilters) => countFn(filters), options)
}
