/**
 * IPC Handler Wrapper Utility
 *
 * Provides a consistent pattern for creating IPC handlers with:
 * - Error handling and logging
 * - Type safety
 * - Reduced boilerplate
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { getErrorMessage, isNodeError } from '@main/services/utils/errorUtils'
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

// Re-export error utilities for consumers
export { getErrorMessage, isNodeError }

/**
 * Create a type-safe IPC handler with consistent validation and error handling.
 * 
 * If the schema is a ZodTuple, it validates the entire arguments array.
 * Otherwise, it validates the first argument (args[0]).
 */
export function createValidatedIpcHandler<TSchema extends z.ZodSchema<any>, TReturn>(
  channel: string,
  schema: TSchema,
  handler: z.infer<TSchema> extends any[] 
    ? (...args: z.infer<TSchema>) => Promise<TReturn>
    : (arg: z.infer<TSchema>) => Promise<TReturn>,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      if (options.logCalls) {
        getLoggingService().info('[IPC]', `${channel} called`)
      }

      const isTuple = schema instanceof z.ZodTuple
      const validated = isTuple 
        ? validateInput(schema, args, channel)
        : validateInput(schema, args[0], channel)

      if (isTuple && Array.isArray(validated)) {
        return await (handler as any)(...validated)
      } else {
        return await (handler as any)(validated)
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
export function createValidatedIpcHandlerWithEvent<TSchema extends z.ZodSchema<any>, TReturn>(
  channel: string,
  schema: TSchema,
  handler: z.infer<TSchema> extends any[] 
    ? (event: IpcMainInvokeEvent, ...args: z.infer<TSchema>) => Promise<TReturn>
    : (event: IpcMainInvokeEvent, arg: z.infer<TSchema>) => Promise<TReturn>,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      if (options.logCalls) {
        getLoggingService().info('[IPC]', `${channel} called`)
      }

      const isTuple = schema instanceof z.ZodTuple
      const validated = isTuple 
        ? validateInput(schema, args, channel)
        : validateInput(schema, args[0], channel)

      if (isTuple && Array.isArray(validated)) {
        return await (handler as any)(event, ...validated)
      } else {
        return await (handler as any)(event, validated)
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
  ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
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
  ipcMain.handle(channel, (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
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
