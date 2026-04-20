import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LiveMonitoringService } from '../../src/main/services/LiveMonitoringService'
import { setupTestDb, cleanupTestDb } from '../TestUtils'
import * as fs from 'fs'

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: (cmd: string, options: any, callback: any) => {
    if (typeof options === 'function') callback = options
    callback(null, { stdout: 'DeviceID DriveType\nC: 3\n' })
  },
  promisify: (fn: any) => {
    return (...args: any[]) => new Promise((resolve) => {
      fn(...args, (err: any, result: any) => resolve(result))
    })
  }
}))

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
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
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    service = new LiveMonitoringService()
    
    // Set mock configuration
    db.config.setSetting('monitoring_enabled', 'true')
    db.config.setSetting('monitoring_start_on_launch', 'false')
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
    db.sources.upsertSource({
      source_id: sourceId,
      source_type: 'local',
      display_name: 'Local Source',
      connection_config: JSON.stringify({ folderPath: '/mock/path' }),
      is_enabled: 1
    })

    await service.initialize()
    service.start()
    
    expect(service.isMonitoringActive()).toBe(true)
    expect(fs.watch).toHaveBeenCalled()
    service.stop()
  })

  it('should stop monitoring', async () => {
    await service.initialize()
    service.start()
    service.stop()
    
    expect(service.isMonitoringActive()).toBe(false)
  })
})
