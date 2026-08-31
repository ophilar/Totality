/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, _vi } from 'vitest'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { ProviderType } from '@main/types/database'

import { IPC_CHANNELS } from '@main/constants/ipcChannels'

describe('IPC Refactor Verification (Real Integrated Bridge)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let handlers: ReturnType<typeof setupRealIntegratedBridge>['handlers']

  beforeEach(async () => {
    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    handlers = bridge.handlers
  })

  afterEach(async () => {
    await cleanupTestDb()
  })

  it('should successfully add and list sources via real IPC handlers', async () => {
    const addHandler = handlers.get(IPC_CHANNELS.SOURCES.ADD)!
    const listHandler = handlers.get(IPC_CHANNELS.SOURCES.LIST)!
    
    const config = {
      sourceType: ProviderType.Local,
      displayName: 'Real IPC Test',
      connectionConfig: { folderPath: 'C:\\Real\\Path' }
    }

    const source = await addHandler({}, config)
    expect(source).toBeDefined()
    expect(source.display_name).toBe('Real IPC Test')

    const list = await listHandler({})
    expect(list).toHaveLength(1)
    expect(list[0].source_id).toBe(source.source_id)
  })

  it('should correctly handle settings via refactored IPC handlers', async () => {
    const setHandler = handlers.get(IPC_CHANNELS.DATABASE.SET_SETTING)!
    const getHandler = handlers.get(IPC_CHANNELS.DATABASE.GET_SETTING)!
    
    await setHandler({}, 'test_key', 'test_value')
    
    // Check real DB
    const stored = await db.config.getSetting('test_key')
    expect(stored).toBe('test_value')

    const fromApi = await getHandler({}, 'test_key')
    expect(fromApi).toBe('test_value')
  })

  it('should reject invalid input via Zod validation in the wrapper', async () => {
    const addHandler = handlers.get(IPC_CHANNELS.SOURCES.ADD)!
    
    const invalidConfig = {
      sourceType: 'not-a-provider',
      displayName: 'Fail'
    }

    // The wrapper should throw because the schema validation fails
    await expect(addHandler({}, invalidConfig)).rejects.toThrow()
  })
})
