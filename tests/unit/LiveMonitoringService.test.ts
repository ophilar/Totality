import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LiveMonitoringService } from '@main/services/LiveMonitoringService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: vi.fn((_file: string, _args: unknown, options: unknown, callback?: unknown) => {
      const cb = (typeof options === 'function' ? options : callback) as
        | ((error: Error | null, result: { stdout: string }) => void)
        | undefined
      cb?.(null, { stdout: 'Z:\n' })
    }),
  }
})

describe('LiveMonitoringService', () => {
  let service: LiveMonitoringService
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let sourceDir: string

  beforeEach(async () => {
    db = await setupTestDb()
    service = new LiveMonitoringService()
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totality-monitoring-'))
    
    // Set mock configuration
    await db.config.setSetting('monitoring_enabled', 'true')
    await db.config.setSetting('monitoring_start_on_launch', 'false')
  })

  afterEach(() => {
    service.stop()
    cleanupTestDb()
    fs.rmSync(sourceDir, { recursive: true, force: true })
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
      connection_config: JSON.stringify({ folderPath: sourceDir }),
      is_enabled: 1
    })

    await service.initialize()
    await service.start()
    
    expect(service.isMonitoringActive()).toBe(true)
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

  it('detects media file changes through the filesystem watcher', async () => {
    await db.sources.upsertSource({
      source_id: 's2',
      source_type: 'local',
      display_name: 'Local Source',
      connection_config: JSON.stringify({ folderPath: sourceDir }),
      is_enabled: 1,
    })

    await service.initialize()
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
    service.setMainWindow(window as never)
    await service.start()
    const mediaFile = path.join(sourceDir, 'episode.mkv')
    fs.writeFileSync(mediaFile, 'media')
    await vi.waitFor(() => {
      expect(window.webContents.send).toHaveBeenCalledWith(
        'monitoring:event',
        expect.objectContaining({ message: expect.stringContaining('episode.mkv') })
      )
    })
    service.stop()
  })
})



