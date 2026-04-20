import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskQueueService } from '../../src/main/services/TaskQueueService'

describe('TaskQueue Music Scan Targeting', () => {
  let service: TaskQueueService
  let scanLibraryCalled = false
  let capturedLibraryId: string | null = null

  beforeEach(() => {
    scanLibraryCalled = false
    capturedLibraryId = null

    // Real-ish configuration but with captured methods
    const mockDb = {
      getSetting: vi.fn(),
      setSetting: vi.fn(),
      createNotification: vi.fn(),
    }

    const mockLogging = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      verbose: vi.fn(),
    }

    const mockSourceManager = {
      scanLibrary: async (sourceId: string, libraryId: string) => {
        scanLibraryCalled = true
        capturedLibraryId = libraryId
        return { success: true, itemsScanned: 0, errors: [] }
      },
      getSources: () => [],
      getProvider: () => null
    }

    service = new TaskQueueService({
      db: mockDb as any,
      logging: mockLogging as any,
      sourceManager: mockSourceManager as any
    })
  })

  it('should pass the correct library ID to scanLibrary for music scans', async () => {
    // Add a music-scan task with a specific libraryId (e.g. '5' for music)
    service.addTask({
      type: 'music-scan',
      label: 'Scan Music',
      sourceId: 'src-123',
      libraryId: '5'
    })

    // Start the queue and wait for the task to process
    service.resumeQueue()

    // Give it a moment to pick up the task and execute it
    let attempts = 0
    while (!scanLibraryCalled && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 50))
      attempts++
    }

    expect(scanLibraryCalled).toBe(true)
    expect(capturedLibraryId).toBe('5')
  })

  it('should correctly handle library-scan tasks with their specific libraryId', async () => {
    service.addTask({
      type: 'library-scan',
      label: 'Scan Movies',
      sourceId: 'src-123',
      libraryId: '1'
    })

    service.resumeQueue()

    let attempts = 0
    while (!scanLibraryCalled && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 50))
      attempts++
    }

    expect(scanLibraryCalled).toBe(true)
    expect(capturedLibraryId).toBe('1')
  })
})
