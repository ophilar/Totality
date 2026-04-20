import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, cleanupTestDb, createTempDir } from '../TestUtils'
import { SourceManager } from '../../src/main/services/SourceManager'
import { getLiveMonitoringService } from '../../src/main/services/LiveMonitoringService'
import { getTaskQueueService } from '../../src/main/services/TaskQueueService'
import * as fs from 'fs'
import * as path from 'path'

describe('Real-Time Update and Event Integrity (No Mocks)', () => {
  let db: any
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('real-time-integrity')
  })

  afterEach(() => {
    cleanupTestDb()
    tempDir.cleanup()
  })

  it('should propagate library:updated events from SourceManager to Renderer through LiveMonitoringService', async () => {
    // 1. Create real media files
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(path.join(tempDir.path, `Movie_${i}.mkv`), 'dummy content')
    }

    // 2. Setup Services
    const monitoring = getLiveMonitoringService()
    const manager = new SourceManager({ db, liveMonitoring: monitoring })
    
    // Captured events collector
    const capturedEvents: { channel: string, data: any }[] = []
    const rendererInterface = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, data: any) => {
          capturedEvents.push({ channel, data })
        }
      }
    }
    monitoring.setMainWindow(rendererInterface as any)

    // 3. Add source and initiate scan
    await manager.addSource({
      sourceType: 'local',
      displayName: 'Integrity Source',
      connectionConfig: { folderPath: tempDir.path },
      isEnabled: true
    })

    const source = (await manager.getSources())[0]
    
    // 4. Run the scan
    await manager.scanLibrary(source.source_id, 'movie')

    // 5. Verify Signal Integrity
    const libraryUpdates = capturedEvents.filter(e => e.channel === 'library:updated')
    
    // We expect at least 2: one from the progress throttle (first item) and one from the finally block.
    expect(libraryUpdates.length).toBeGreaterThanOrEqual(2)
  })

  it('should emit taskQueue:taskComplete when background analysis finishes', async () => {
     const tq = getTaskQueueService()
     
     // Setup capture
     const capturedEvents: { channel: string, data: any }[] = []
     const rendererInterface = {
       isDestroyed: () => false,
       webContents: {
         isDestroyed: () => false,
         send: (channel: string, data: any) => {
           capturedEvents.push({ channel, data })
         }
       }
     }
     tq.setMainWindow(rendererInterface as any)
     
     // Manually add a simple task to the queue and wait for it
     const taskId = tq.addTask({
       type: 'collection-completeness',
       label: 'Integrity Analysis',
       sourceId: 's1'
     })
     
     // Wait for queue to process (it's async in background)
     let attempts = 0
     while (attempts < 50) {
       const state = tq.getState()
       if (state.completedTasks.some(t => t.id === taskId)) break
       await new Promise(resolve => setTimeout(resolve, 100))
       attempts++
     }
     
     // Verify the event was sent to the renderer
     const completionEvent = capturedEvents.find(e => e.channel === 'taskQueue:taskComplete')
     expect(completionEvent).toBeDefined()
     expect(completionEvent?.data.id).toBe(taskId)
  })
})
