/**
 * IPC Handler Wrapper Utility
 *
 * Provides a consistent pattern for creating IPC handlers with:
 * - Error handling and logging
 * - Type safety
 * - Reduced boilerplate
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { getErrorMessage, isNodeError } from '../../services/utils/errorUtils'
import { z } from 'zod'
import { validateInput } from '../../validation/schemas'

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
 * Create a type-safe IPC handler with consistent error handling
 *
 * @param channel - The IPC channel name (e.g., 'sources:add')
 * @param handler - The async handler function
 * @param options - Optional configuration
 *
 * @example
 * // Simple handler
 * createIpcHandler('sources:list', async () => {
 *   return db.getSources()
 * })
 *
 * @example
 * // Handler with arguments
 * createIpcHandler('sources:add', async (config: SourceConfig) => {
 *   return await sourceManager.addSource(config)
 * })
 *
 * @example
 * // Handler that uses event
 * createIpcHandlerWithEvent('dialog:showSave', async (event, options) => {
 *   const win = BrowserWindow.fromWebContents(event.sender)
 *   return await dialog.showSaveDialog(win!, options)
 * })
 */
export function createIpcHandler<TArgs extends unknown[], TReturn>(
  channel: string,
  handler: (...args: TArgs) => Promise<TReturn>,
  options: HandlerOptions = {}
): void {
  ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      if (options.logCalls) {
        console.log(`[IPC] ${channel} called`)
      }
      return await handler(...(args as TArgs))
    } catch (error) {
      const message = getErrorMessage(error)
      console.error(`[IPC] Error in ${channel}:`, message)

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
        console.log(`[IPC] ${channel} called`)
      }
      return await handler(event, ...(args as TArgs))
    } catch (error) {
      const message = getErrorMessage(error)
      console.error(`[IPC] Error in ${channel}:`, message)

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
        console.log(`[IPC] ${channel} called (sync)`)
      }
      return handler(...(args as TArgs))
    } catch (error) {
      const message = getErrorMessage(error)
      console.error(`[IPC] Error in ${channel}:`, message)

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

type ValidatedArgs<TSchema extends z.ZodType> = TSchema extends z.ZodTuple
  ? Extract<z.output<TSchema>, unknown[]>
  : [z.output<TSchema>]

export function createValidatedIpcHandler<TSchema extends z.ZodType, TReturn>(
  channel: string, schema: TSchema, handler: (...args: ValidatedArgs<TSchema>) => Promise<TReturn>
): void {
  createIpcHandler(channel, async (...args: unknown[]) => {
    const value = validateInput(schema, schema instanceof z.ZodTuple ? args : args[0], channel)
    return handler(...((schema instanceof z.ZodTuple ? value as unknown[] : [value]) as ValidatedArgs<TSchema>))
  })
}
export function createValidatedIpcHandlerWithEvent<TSchema extends z.ZodType, TReturn>(
  channel: string, schema: TSchema,
  handler: (event: IpcMainInvokeEvent, ...args: ValidatedArgs<TSchema>) => Promise<TReturn>
): void {
  createIpcHandlerWithEvent(channel, async (event, ...args: unknown[]) => {
    const value = validateInput(schema, schema instanceof z.ZodTuple ? args : args[0], channel)
    return handler(event, ...((schema instanceof z.ZodTuple ? value as unknown[] : [value]) as ValidatedArgs<TSchema>))
  })
}
