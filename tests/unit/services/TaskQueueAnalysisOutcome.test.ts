import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TaskQueueService } from '@main/services/TaskQueueService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TaskType, TaskStatus } from '@main/types/database'
import type { AnalysisOutcome } from '@main/types/database'
import type { SeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import type { MusicBrainzService } from '@main/services/MusicBrainzService'

describe('TaskQueue Analysis Outcome & Consolidated Notifications', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('attaches AnalysisOutcome and dispatches a single notification on series completeness completion', async () => {
    const mockOutcome: AnalysisOutcome = {
      status: 'completed',
      processedCount: 15,
      totalCount: 15,
      deferredCount: 0,
      diagnostics: []
    }

    const mockSeriesService = {
      analyzeAllSeries: vi.fn().mockResolvedValue(mockOutcome)
    } as unknown as SeriesCompletenessService

    const queueService = new TaskQueueService({
      db,
      seriesCompleteness: mockSeriesService
    })

    const taskId = await queueService.addTask({
      type: TaskType.SeriesCompleteness,
      label: 'Analyze Series',
      sourceId: 'src-1',
      libraryId: 'lib-1'
    })

    await queueService.resumeQueue()

    // Poll for task completion
    let completedTask
    for (let i = 0; i < 50; i++) {
      const state = queueService.getState()
      completedTask = state.completedTasks.find(t => t.id === taskId)
      if (completedTask) break
      await new Promise(r => setTimeout(r, 50))
    }

    expect(completedTask).toBeDefined()
    expect(completedTask?.status, completedTask?.error).toBe(TaskStatus.Completed)
    expect(completedTask?.result?.outcome).toEqual(mockOutcome)

    // Verify exactly one notification was added
    const notifications = await db.notifications.getNotifications()
    expect(notifications.length).toBe(1)
    expect(notifications[0].title).toBe('Series analysis completed')
    expect(notifications[0].message).toContain('15 analyzed')
  })

  it('handles partial series outcome with warning/info notification and outcome attached', async () => {
    const mockOutcome: AnalysisOutcome = {
      status: 'partial',
      processedCount: 8,
      totalCount: 10,
      deferredCount: 0,
      diagnostics: [
        {
          itemType: 'series',
          itemName: 'Star Trek: Unresolved',
          category: 'identity',
          code: 'UNRESOLVED_IDENTITY',
          message: 'Could not resolve identity for series'
        }
      ]
    }

    const mockSeriesService = {
      analyzeAllSeries: vi.fn().mockResolvedValue(mockOutcome)
    } as unknown as SeriesCompletenessService

    const queueService = new TaskQueueService({
      db,
      seriesCompleteness: mockSeriesService
    })

    const taskId = await queueService.addTask({
      type: TaskType.SeriesCompleteness,
      label: 'Analyze Series Partial',
      sourceId: 'src-1',
      libraryId: 'lib-1'
    })

    await queueService.resumeQueue()

    let completedTask
    for (let i = 0; i < 50; i++) {
      const state = queueService.getState()
      completedTask = state.completedTasks.find(t => t.id === taskId)
      if (completedTask) break
      await new Promise(r => setTimeout(r, 50))
    }

    expect(completedTask).toBeDefined()
    expect(completedTask?.status).toBe(TaskStatus.Completed)
    expect(completedTask?.result?.outcome).toEqual(mockOutcome)

    const notifications = await db.notifications.getNotifications()
    expect(notifications.length).toBe(1)
    expect(notifications[0].title).toBe('Series analysis partially completed')
    expect(notifications[0].message).toContain('8/10 analyzed')
    expect(notifications[0].message).toContain('1 failed')
  })

  it('attaches AnalysisOutcome on music analysis completion', async () => {
    const mockOutcome: AnalysisOutcome = {
      status: 'deferred',
      processedCount: 20,
      totalCount: 30,
      deferredCount: 10,
      diagnostics: []
    }

    const mockMusicService = {
      analyzeAllMusic: vi.fn().mockResolvedValue(mockOutcome)
    } as unknown as MusicBrainzService

    const queueService = new TaskQueueService({
      db,
      musicBrainz: mockMusicService
    })

    const taskId = await queueService.addTask({
      type: TaskType.MusicCompleteness,
      label: 'Analyze Music',
      sourceId: 'src-music'
    })

    await queueService.resumeQueue()

    let completedTask
    for (let i = 0; i < 50; i++) {
      const state = queueService.getState()
      completedTask = state.completedTasks.find(t => t.id === taskId)
      if (completedTask) break
      await new Promise(r => setTimeout(r, 50))
    }

    expect(completedTask).toBeDefined()
    expect(completedTask?.status).toBe(TaskStatus.Completed)
    expect(completedTask?.result?.outcome).toEqual(mockOutcome)

    const notifications = await db.notifications.getNotifications()
    expect(notifications.length).toBe(1)
    expect(notifications[0].title).toBe('Music analysis deferred')
    expect(notifications[0].message).toContain('10 deferred')
  })
})
