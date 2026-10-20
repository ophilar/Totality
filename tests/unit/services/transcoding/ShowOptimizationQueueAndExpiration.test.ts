import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getTranscodingService } from '../../../../src/main/services/TranscodingService'

vi.mock('@main/database/getDatabase')
vi.mock('@main/services/LoggingService', () => ({
  getLoggingService: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })
}))

const mockAddTasks = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../../src/main/services/TaskQueueService', () => ({
  getTaskQueueService: () => ({
    getTasks: vi.fn().mockResolvedValue([]),
    addTasks: mockAddTasks,
  })
}))

describe('ShowOptimizationQueueAndExpiration', () => {
  let mockDb: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockDb = {
      config: {
        getSetting: vi.fn(),
        setSetting: vi.fn(),
        deleteSetting: vi.fn(),
      },
      playbackTargetProfiles: {
        get: vi.fn().mockResolvedValue({ id: 'prof-1', name: 'Profile 1' }),
      },
      media: {
        getItemById: vi.fn(),
      },
      sources: {
        getSourceById: vi.fn(),
      },
    }

    const { getDatabase } = await import('@main/database/getDatabase')
    vi.mocked(getDatabase).mockReturnValue(mockDb)
  })

  it('rejects expired show preflight and discards stored state', async () => {
    const transcodingService = getTranscodingService()
    const preflightId = 'expired_preflight_1'
    const expiredTime = new Date(Date.now() - 60000).toISOString()

    mockDb.config.getSetting.mockResolvedValue(JSON.stringify({
      request: { sourceId: 'src1', libraryId: 'lib1' },
      result: {
        preflightId,
        batchId: 'batch_1',
        expiresAt: expiredTime,
        userApproved: false,
        episodes: [
          {
            mediaItemId: 101,
            label: 'Show S01E01',
            compatible: true,
            decisionStatus: 'actionable',
          }
        ]
      }
    }))

    await expect(transcodingService.queueShowTranscode(preflightId)).rejects.toThrow(
      'Show transcode preflight has expired; run preflight again'
    )
    expect(mockDb.config.deleteSetting).toHaveBeenCalledWith(`transcoding.preflight.${preflightId}`)
    expect(mockAddTasks).not.toHaveBeenCalled()
  })

  it('throws when show preflight is not found', async () => {
    const transcodingService = getTranscodingService()
    mockDb.config.getSetting.mockResolvedValue(null)

    await expect(transcodingService.queueShowTranscode('nonexistent')).rejects.toThrow(
      'Show transcode preflight was not found or has expired'
    )
    expect(mockAddTasks).not.toHaveBeenCalled()
  })

  it('preflights a single movie without requiring a series identity', async () => {
    const transcodingService = getTranscodingService()
    mockDb.media.getItemById.mockResolvedValue({
      id: 101,
      title: 'Movie',
      source_id: 'src1',
      series_identity_key: null,
    })

    const result = await transcodingService.preflightShowTranscode({
      mediaItemId: 101,
      sourceId: 'src1',
      options: { targetProfileId: 'prof-1' },
    })

    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0].compatible).toBe(false)
    expect(result.episodes[0].reason).toContain('no local source identity')
  })

  it('queues authorized episodes in sequence when preflight is valid', async () => {
    const transcodingService = getTranscodingService()
    const preflightId = 'valid_preflight_1'
    const futureTime = new Date(Date.now() + 600000).toISOString()

    mockDb.config.getSetting.mockResolvedValue(JSON.stringify({
      request: { sourceId: 'src1', libraryId: 'lib1' },
      result: {
        preflightId,
        batchId: 'batch_valid',
        expiresAt: futureTime,
        userApproved: false,
        episodes: [
          {
            mediaItemId: 101,
            label: 'Show S01E01 Title',
            compatible: true,
            decisionStatus: 'actionable',
            options: { crf: 20 },
            targetProfile: { id: 'prof-1', name: 'Profile 1' },
          },
          {
            mediaItemId: 102,
            label: 'Show S01E02 Title',
            compatible: true,
            decisionStatus: 'actionable',
            options: { crf: 20 },
            targetProfile: { id: 'prof-1', name: 'Profile 1' },
          }
        ]
      }
    }))

    const result = await transcodingService.queueShowTranscode(preflightId)
    expect(result.batchId).toBe('batch_valid')
    expect(result.queuedMediaItemIds).toEqual([101, 102])

    expect(mockAddTasks).toHaveBeenCalledTimes(1)
    const queuedTasks = mockAddTasks.mock.calls[0][0]
    expect(queuedTasks).toHaveLength(2)
    expect(queuedTasks[0].mediaItemId).toBe(101)
    expect(queuedTasks[0].label).toBe('Show S01E01 Title')
    expect(queuedTasks[1].mediaItemId).toBe(102)
    expect(queuedTasks[1].label).toBe('Show S01E02 Title')

    expect(mockDb.config.deleteSetting).toHaveBeenCalledWith(`transcoding.preflight.${preflightId}`)
  })
})
