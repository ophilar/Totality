import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskQueueService } from '../../src/main/services/TaskQueueService'
import { SourceManager } from '../../src/main/services/SourceManager'
import { setupTestDb, cleanupTestDb, createTempDir } from '../TestUtils'
import * as fs from 'fs'
import * as path from 'path'

describe('TaskQueue Music Scan Targeting (No Mocks)', () => {
  let service: TaskQueueService
  let manager: SourceManager
  let db: any
  let tempDir: { path: string; cleanup: () => void }

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('task-queue-targeting')
    
    manager = new SourceManager({ db })
    service = new TaskQueueService({ db, sourceManager: manager })
  })

  afterEach(() => {
    cleanupTestDb()
    tempDir.cleanup()
  })

  it('should execute a music scan task correctly targeting the library', async () => {
    // Setup a real local music library
    const musicDir = path.join(tempDir.path, 'Music', 'Artist', 'Album')
    fs.mkdirSync(musicDir, { recursive: true })
    fs.writeFileSync(path.join(musicDir, '01 - Song.mp3'), 'dummy')

    const source = await manager.addSource({
      sourceType: 'local' as any,
      displayName: 'Local Music',
      connectionConfig: { folderPath: tempDir.path, mediaType: 'music' },
    })

    await manager.initialize()

    // Add a music-scan task
    const taskId = service.addTask({
      type: 'music-scan',
      label: 'Scan Music',
      sourceId: source.source_id,
      libraryId: 'music' // LocalProvider music library ID
    })

    expect(taskId).toBeDefined()

    // Resume queue and wait for completion
    service.resumeQueue()

    // Poll for task completion (no mocks!)
    let completed = false
    for (let i = 0; i < 50; i++) {
      const task = service.getTasks().find(t => t.id === taskId)
      if (task?.status === 'completed') {
        completed = true
        break
      }
      if (task?.status === 'failed') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    expect(completed).toBe(true)
    
    // Verify results in real DB
    const artists = db.music.getArtists()
    expect(artists.length).toBeGreaterThan(0)
    expect(artists[0].name).toBe('Artist')
  })
})
