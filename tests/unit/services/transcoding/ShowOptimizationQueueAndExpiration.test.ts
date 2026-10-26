import { describe, expect, it, vi, beforeEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getTranscodingService } from '../../../../src/main/services/TranscodingService'
import { PreflightShowTranscodeSchema } from '../../../../src/main/validation/schemas'
import { MEASUREMENT_VERSION } from '../../../../src/main/services/MeasuredOptimizationPolicy'

vi.mock('@main/database/getDatabase')
vi.mock('@main/services/LoggingService', () => ({
  getLoggingService: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })
}))

const mockAddTasks = vi.fn()
vi.mock('../../../../src/main/services/TaskQueueService', () => ({
  getTaskQueueService: () => ({
    getTasks: vi.fn().mockResolvedValue([]),
    addTasks: mockAddTasks,
  })
}))

describe('ShowOptimizationQueueAndPersistence', () => {
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

  it('retains a saved show preflight after its legacy expiration timestamp', async () => {
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

    await expect(transcodingService.getShowPreflight(preflightId)).resolves.toMatchObject({ result: { preflightId, expiresAt: expiredTime } })
    expect(mockDb.config.deleteSetting).not.toHaveBeenCalled()
    expect(mockAddTasks).not.toHaveBeenCalled()
  })

  it('throws when show preflight is not found', async () => {
    const transcodingService = getTranscodingService()
    mockDb.config.getSetting.mockResolvedValue(null)

    await expect(transcodingService.queueShowTranscode('nonexistent')).rejects.toThrow(
      'Show transcode preflight was not found'
    )
    expect(mockAddTasks).not.toHaveBeenCalled()
  })

  it('requires new measurement before approving or queuing plans from an older measurement method', async () => {
    const service = getTranscodingService()
    mockDb.config.getSetting.mockResolvedValue(JSON.stringify({
      request: { sourceId: 'src1', libraryId: 'lib1', options: { optimizationMode: 'transcode' } },
      result: {
        preflightId: 'old-measurement', batchId: 'batch-old', measurementVersion: MEASUREMENT_VERSION - 1,
        episodes: [{ mediaItemId: 101, decisionStatus: 'sample_required', compatible: true, params: { measuredCandidate: { encoder: 'qsv_h265', quality: 14, preset: 'medium', outputBytes: 100, sampledDurationSeconds: 30, vmafMean: 96, vmafP5: 93, cambiMean: 1 } } }],
      },
    }))
    await expect(service.approveShowTranscode('old-measurement')).rejects.toThrow('Measurement method changed')
    await expect(service.queueShowTranscode('old-measurement')).rejects.toThrow('Measurement method changed')
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

  it('accepts an explicit no-target optimization without consulting the saved default', async () => {
    const transcodingService = getTranscodingService()
    mockDb.config.getSetting.mockResolvedValue('saved-default')
    mockDb.media.getItemById.mockResolvedValue({
      id: 101,
      title: 'Movie',
      source_id: 'src1',
    })
    const request = {
      requestId: 'request-no-target',
      mediaItemId: 101,
      sourceId: 'src1',
      options: { targetProfileId: null },
    }

    expect(PreflightShowTranscodeSchema.safeParse([request]).success).toBe(true)
    const result = await transcodingService.preflightShowTranscode(request)

    expect(result.episodes[0].reason).toContain('no local source identity')
    expect(mockDb.config.getSetting).not.toHaveBeenCalledWith('optimization_default_target_profile_id')
    expect(mockDb.playbackTargetProfiles.get).not.toHaveBeenCalled()
  })

  it('queues authorized episodes in sequence when preflight is valid', async () => {
    const transcodingService = getTranscodingService()
    const preflightId = 'valid_preflight_1'
    const sourcePath = path.resolve('src/main/services/TranscodingService.ts')
    const sourceStat = await fs.stat(sourcePath)
    mockDb.media.getItemById.mockImplementation(async (id: number) => ({
      id, title: `Show S01E0${id - 100}`, source_id: 'src1', file_path: sourcePath,
    }))
    mockDb.sources.getSourceById.mockResolvedValue({ connection_config: JSON.stringify({ folderPath: path.dirname(sourcePath) }) })
    mockAddTasks.mockImplementation((tasks: unknown[]) => tasks.map((_, index) => `task-${index}`))

    mockDb.config.getSetting.mockResolvedValue(JSON.stringify({
      request: { sourceId: 'src1', libraryId: 'lib1' },
      result: {
        preflightId,
        batchId: 'batch_valid',
        userApproved: false,
        episodes: [
          {
            mediaItemId: 101,
            label: 'Show S01E01 Title',
            compatible: true,
            decisionStatus: 'actionable',
            sourceSize: sourceStat.size,
            sourceMtimeMs: sourceStat.mtimeMs,
            sourceSha256: 'a'.repeat(64),
            options: { crf: 20 },
            targetProfile: { id: 'prof-1', name: 'Profile 1' },
          },
          {
            mediaItemId: 102,
            label: 'Show S01E02 Title',
            compatible: true,
            decisionStatus: 'actionable',
            sourceSize: sourceStat.size,
            sourceMtimeMs: sourceStat.mtimeMs,
            sourceSha256: 'a'.repeat(64),
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

    expect(mockDb.config.setSetting).toHaveBeenCalledWith(`transcoding.preflight.${preflightId}`, expect.stringContaining('queuedAt'))
  })
})
