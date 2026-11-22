import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DeduplicationService } from '../../../src/main/services/DeduplicationService'
import * as fs from 'fs/promises'

vi.mock('@main/database/getDatabase')
vi.mock('@main/services/LoggingService', () => ({
  getLoggingService: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })
}))
vi.mock('fs/promises')

describe('DeduplicationService', () => {
  let service: DeduplicationService
  let mockDb: any

  beforeEach(async () => {
    vi.clearAllMocks()
    service = new DeduplicationService()
    mockDb = {
      getMediaItems: vi.fn().mockReturnValue([]),
      getMediaItem: vi.fn(),
      upsertDuplicate: vi.fn(),
      getDuplicateById: vi.fn(),
      resolveDuplicate: vi.fn(),
      deleteMediaItem: vi.fn(),
      getSetting: vi.fn().mockImplementation(async (key: string) => {
        if (key === 'dup_policy_auto_delete') return 'true'
        if (key === 'dup_policy_highest_res') return 'true'
        if (key === 'dup_policy_orig_lang') return 'true'
        return null
      })
    }

    const { getDatabase } = await import('@main/database/getDatabase')
    vi.mocked(getDatabase).mockReturnValue(mockDb)
  })

  describe('scanForDuplicates', () => {
    it('groups duplicate movies by TMDB ID and registers duplicates', async () => {
      mockDb.getMediaItems.mockImplementation(({ type }: { type: string }) => {
        if (type === 'movie') {
          return [
            { id: 1, source_id: 'src1', tmdb_id: '100', title: 'Movie 1080p' },
            { id: 2, source_id: 'src1', tmdb_id: '100', title: 'Movie 4K' },
            { id: 3, source_id: 'src1', tmdb_id: '200', title: 'Movie Distinct' },
          ]
        }
        return []
      })

      const count = await service.scanForDuplicates('src1')
      expect(count).toBe(1)
      expect(mockDb.upsertDuplicate).toHaveBeenCalledWith({
        source_id: 'src1',
        external_id: '100',
        external_type: 'tmdb_movie',
        media_item_ids: JSON.stringify([1, 2]),
        status: 'pending',
      })
    })

    it('groups duplicate episodes by title, season, and episode number', async () => {
      mockDb.getMediaItems.mockImplementation(({ type }: { type: string }) => {
        if (type === 'episode') {
          return [
            { id: 10, source_id: 'src1', series_title: 'Show', season_number: 1, episode_number: 1, title: 'Ep 1 (720p)' },
            { id: 11, source_id: 'src1', series_title: 'Show', season_number: 1, episode_number: 1, title: 'Ep 1 (1080p)' },
          ]
        }
        return []
      })

      const count = await service.scanForDuplicates('src1')
      expect(count).toBe(1)
      expect(mockDb.upsertDuplicate).toHaveBeenCalledWith({
        source_id: 'src1',
        external_id: 'title:show:S1E1',
        external_type: 'tmdb_series',
        media_item_ids: JSON.stringify([10, 11]),
        status: 'pending',
      })
    })

    it('honors abort signal before committing duplicates', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(service.scanForDuplicates(undefined, controller.signal)).rejects.toThrow()
      expect(mockDb.upsertDuplicate).not.toHaveBeenCalled()
    })
  })

  describe('recommendRetention', () => {
    it('scores higher resolution and original language matching higher', async () => {
      mockDb.getMediaItem.mockImplementation((id: number) => {
        if (id === 1) {
          return {
            id: 1,
            height: 1080,
            original_language: 'en',
            audio_language: 'en',
            video_bitrate_kbps: 5000000,
          }
        }
        if (id === 2) {
          return {
            id: 2,
            height: 720,
            original_language: 'en',
            audio_language: 'es',
            video_bitrate_kbps: 2000000,
          }
        }
        return null
      })

      const rec = await service.recommendRetention([1, 2])
      expect(rec.keep).toBe(1)
      expect(rec.discard).toEqual([2])
    })
  })

  describe('resolveDuplicate', () => {
    it('resolves duplicate as kept_canonical when deleteOthers is false', async () => {
      mockDb.getDuplicateById.mockReturnValue({
        id: 42,
        media_item_ids: JSON.stringify([1, 2]),
      })

      const outcome = await service.resolveDuplicate(42, 1, false)
      expect(outcome.status).toBe('kept')
      expect(mockDb.resolveDuplicate).toHaveBeenCalledWith(42, 'kept_canonical')
      expect(fs.unlink).not.toHaveBeenCalled()
    })

    it('blocks deletion when autoDelete policy is disabled', async () => {
      mockDb.getSetting.mockImplementation(async (key: string) => {
        if (key === 'dup_policy_auto_delete') return 'false'
        return null
      })
      mockDb.getDuplicateById.mockReturnValue({
        id: 42,
        media_item_ids: JSON.stringify([1, 2]),
      })

      const outcome = await service.resolveDuplicate(42, 1, true)
      expect(outcome.status).toBe('policy-blocked')
      expect(fs.unlink).not.toHaveBeenCalled()
    })

    it('deletes discarded items from disk and database when autoDelete is true', async () => {
      mockDb.getDuplicateById.mockReturnValue({
        id: 42,
        media_item_ids: JSON.stringify([1, 2]),
      })
      mockDb.getMediaItem.mockImplementation((id: number) => {
        if (id === 2) {
          return { id: 2, file_path: 'C:/media/dup.mkv' }
        }
        return null
      })

      const outcome = await service.resolveDuplicate(42, 1, true)
      expect(outcome.status).toBe('deleted')
      expect(outcome.committedCount).toBe(1)
      expect(fs.unlink).toHaveBeenCalledWith('C:/media/dup.mkv')
      expect(mockDb.deleteMediaItem).toHaveBeenCalledWith(2)
      expect(mockDb.resolveDuplicate).toHaveBeenCalledWith(42, 'deleted')
    })

    it('returns failed when discarded media record is missing from database', async () => {
      mockDb.getDuplicateById.mockReturnValue({
        id: 42,
        media_item_ids: JSON.stringify([1, 2]),
      })
      mockDb.getMediaItem.mockReturnValue(null)

      const outcome = await service.resolveDuplicate(42, 1, true)
      expect(outcome.status).toBe('failed')
      expect(outcome.errors.length).toBeGreaterThan(0)
      expect(fs.unlink).not.toHaveBeenCalled()
    })
  })
})
