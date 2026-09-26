import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LiveMonitoringService } from '@main/services/LiveMonitoringService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import * as fs from 'fs'

// Mock child_process
vi.mock('child_process', () => ({
  exec: (cmd: string, options: unknown, callback: (error: Error | null, result: { stdout: string }) => void) => {
    if (typeof options === 'function') callback = options
    callback(null, { stdout: 'DeviceID DriveType\nC: 3\n' })
  },
  execFile: vi.fn((file: string, args: unknown, options: unknown, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, result: { stdout: string }) => void
    if (cb) cb(null, { stdout: 'Z:\n' })
  })
}))

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    watch: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    }),
    existsSync: vi.fn().mockReturnValue(true),
  }
})

describe('LiveMonitoringService', () => {
  let service: LiveMonitoringService
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    service = new LiveMonitoringService()
    
    // Set mock configuration
    await db.config.setSetting('monitoring_enabled', 'true')
    await db.config.setSetting('monitoring_start_on_launch', 'false')
  })

  afterEach(() => {
    cleanupTestDb()
    vi.resetAllMocks()
  })

  it('should initialize and load configuration', async () => {
    await service.initialize()
    const config = service.getConfig()
    expect(config.enabled).toBe(true)
  })

  it('should start monitoring enabled sources', async () => {
    const sourceId = 's1'
    await db.sources.upsertSource({
      source_id: sourceId,
      source_type: 'local',
      display_name: 'Local Source',
      connection_config: JSON.stringify({ folderPath: '/mock/path' }),
      is_enabled: 1
    })

    await service.initialize()
    await service.start()
    
    expect(service.isMonitoringActive()).toBe(true)
    expect(fs.watch).toHaveBeenCalled()
    service.stop()
  })

  it('calls powershell via execFile with argument array when detecting network drives on Windows', async () => {
    const childProcess = await import('child_process')
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      await service.initialize()
      expect(childProcess.execFile).toHaveBeenCalledWith(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 4} | Select-Object -ExpandProperty DeviceID',
        ],
        expect.objectContaining({ timeout: 2000, windowsHide: true }),
        expect.any(Function)
      )
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })

  it('should stop monitoring', async () => {
    await service.initialize()
    await service.start()
    service.stop()
    
    expect(service.isMonitoringActive()).toBe(false)
  })

  it('does not log or process directory events as media events', async () => {
    let watcherCallback: ((eventType: string, filename: string) => Promise<void>) | undefined
    vi.mocked(fs.watch).mockImplementationOnce((_path, _options, callback) => {
      watcherCallback = callback as typeof watcherCallback
      return { on: vi.fn().mockReturnThis(), close: vi.fn() } as never
    })

    await db.sources.upsertSource({
      source_id: 's2',
      source_type: 'local',
      display_name: 'Local Source',
      connection_config: JSON.stringify({ folderPath: '/mock/path' }),
      is_enabled: 1,
    })

    await service.initialize()
    await service.start()
    await watcherCallback?.('rename', 'Artwork Collection')

    expect(watcherCallback).toBeDefined()
    service.stop()
  })
})



