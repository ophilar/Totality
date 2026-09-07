import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskQueueService } from '@main/services/TaskQueueService'
import { MusicBrainzService } from '@main/services/MusicBrainzService'
import { getLoggingService } from '@main/services/LoggingService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { TaskType } from '@main/types/database'

describe('music completeness regressions', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let logging: ReturnType<typeof getLoggingService>

  beforeEach(async () => {
    vi.clearAllMocks()
    db = await setupTestDb()
    logging = getLoggingService()
    logging.setDatabaseGetter(() => db)
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanupTestDb()
  })

  it('reports canonical music outcome counts instead of undefined totals', async () => {
    const musicBrainz = {
      analyzeAllMusic: vi.fn().mockResolvedValue({
        status: 'partial',
        completedCount: 3,
        deferredCount: 2,
        failedCount: 1,
        diagnostics: [{
          itemType: 'album',
          itemName: 'Unavailable Album',
          category: 'provider',
          code: 'PROVIDER_NETWORK_ERROR',
          message: 'provider unavailable',
          retryable: true,
        }],
        artistsAnalyzed: 1,
        albumsAnalyzed: 2,
        skipped: 4,
        deferred: 2,
        completed: false,
        errors: ['provider unavailable'],
      }),
    }

    const service = new TaskQueueService({
      db,
      logging,
      musicBrainz: musicBrainz as never,
    })

    await service.pauseQueue()
    await service.addTask({
      type: TaskType.MusicCompleteness,
      label: 'Analyze Music',
      sourceId: 'src',
    })
    await service.resumeQueue()

    await vi.waitFor(() => {
      expect(service.getQueueState().completedTasks).toHaveLength(1)
    })

    const completed = service.getQueueState().completedTasks[0]
    expect(completed.status, completed.error).toBe('completed')
    expect(completed.result?.itemsScanned).toBe(3)

    const notifications = await db.notifications.getNotifications()
    expect(notifications[0]).toMatchObject({
      type: 'info',
      title: 'Music analysis partial',
      message: 'Music analysis partial: 3/10 analyzed; 2 deferred; 1 issues',
    })
  })

  it('logs each MusicBrainz retry once at warning level', async () => {
    vi.useFakeTimers()
    const service = new MusicBrainzService()

    ;(service as any).rateLimiter = {
      waitForSlot: vi.fn().mockResolvedValue(undefined),
      recordSuccess: vi.fn(),
      recordError: vi.fn(),
      setDelay: vi.fn(),
    }
    ;(service as any).MAX_RETRIES = 1

    const warn = vi.spyOn(logging, 'warn')
    const verbose = vi.spyOn(logging, 'verbose')

    const request = (service as any).requestWithRetry(
      async () => { throw new Error('503 provider unavailable') },
      'retry-contract'
    )
    const rejection = request.catch((error: unknown) => error)

    await vi.runAllTimersAsync()
    await rejection

    const retryWarnings = warn.mock.calls.filter(([, message]) =>
      String(message).includes('retry-contract')
    )
    const retryVerbose = verbose.mock.calls.filter(([, message]) =>
      String(message).includes('retry-contract')
    )

    expect(retryWarnings).toHaveLength(1)
    expect(retryVerbose).toHaveLength(0)
  })
})
