import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerListHandlers } from '@main/ipc/utils/genericHandlers'
import { getLoggingService } from '@main/services/LoggingService'
import { z } from 'zod'

// Track registered handlers
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

// Override ipcMain.handle/removeHandler to capture registrations
vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
  if (handlers.has(channel)) {
    throw new Error(`Attempted to register a second handler for '${channel}'`)
  }
  handlers.set(channel, handler)
  return undefined as never
})

vi.mocked(ipcMain.removeHandler).mockImplementation((channel: string) => {
  handlers.delete(channel)
  return undefined as never
})

describe('IPC Handler Registration', () => {
  let db: any

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers.clear()
    db = await setupTestDb()
    getLoggingService().setDatabaseGetter(() => db)
    registerDatabaseHandlers()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('registers expected database handlers', () => {
    const expected = [
      'db:media:list',
      'db:media:count',
      'db:tvshows:list',
      'db:tvshows:count',
      'db:media:getItem',
      'db:getSetting',
      'db:setSetting',
    ]
    for (const channel of expected) {
      expect(handlers.has(channel), `Missing channel: ${channel}`).toBe(true)
    }
  })

  it('db:media:getItem validates input', async () => {
    const handler = handlers.get('db:media:getItem')!
    // @ts-ignore
    await expect(handler({} as any, -1)).rejects.toThrow()
  })

  it('db:getSetting validates input', async () => {
    const handler = handlers.get('db:getSetting')!
    // @ts-ignore
    await expect(handler({} as any, '')).rejects.toThrow()
  })

  it('db:setSetting persists value to real database', async () => {
    const handler = handlers.get('db:setSetting')!
    // @ts-ignore
    await handler({} as any, 'test_setting', 'test_value')

    expect(await db.config.getSetting('test_setting')).toBe('test_value')

  })

  it('registerListHandlers registers standard aliases', () => {
    const base = 'test:resource'
    const schema = z.any()
    
    registerListHandlers(
      base,
      () => [],
      () => 0,
      schema,
      {
        listAlias: ['test:resource:alt'],
        countAlias: ['test:resource:altcount']
      }
    )

    expect(handlers.has('test:resource:alt')).toBe(true)
    expect(handlers.has('test:resource:altcount')).toBe(true)
  })
})



