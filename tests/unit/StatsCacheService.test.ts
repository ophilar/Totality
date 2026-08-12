import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StatsCacheService, getStatsCacheService } from '@main/services/StatsCacheService'
import { BrowserWindow } from 'electron'
import { safeSend } from '@main/ipc/utils/safeSend'

vi.mock('electron', () => {
  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
    }
  }
})

vi.mock('@main/ipc/utils/safeSend', () => ({
  safeSend: vi.fn(),
}))

describe('StatsCacheService', () => {
  let cacheService: StatsCacheService

  beforeEach(() => {
    cacheService = new StatsCacheService()
    vi.clearAllMocks()
  })

  it('should cache series stats', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ total: 10 })

    // First call should execute fetchFn
    const data1 = await cacheService.getSeriesStats(fetchFn)
    expect(data1).toEqual({ total: 10 })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Second call should return cached data
    const data2 = await cacheService.getSeriesStats(fetchFn)
    expect(data2).toEqual({ total: 10 })
    expect(fetchFn).toHaveBeenCalledTimes(1) // Still 1
  })

  it('should cache collection stats', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ total: 20 })

    // First call should execute fetchFn
    const data1 = await cacheService.getCollectionStats(fetchFn)
    expect(data1).toEqual({ total: 20 })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    // Second call should return cached data
    const data2 = await cacheService.getCollectionStats(fetchFn)
    expect(data2).toEqual({ total: 20 })
    expect(fetchFn).toHaveBeenCalledTimes(1) // Still 1
  })

  it('should cache music completeness by key', async () => {
    const fetchFn1 = vi.fn().mockResolvedValue({ total: 30 })
    const fetchFn2 = vi.fn().mockResolvedValue({ total: 40 })

    // Call for key1
    const data1 = await cacheService.getMusicCompleteness('key1', fetchFn1)
    expect(data1).toEqual({ total: 30 })
    expect(fetchFn1).toHaveBeenCalledTimes(1)

    // Second call for key1 should use cache
    const data1b = await cacheService.getMusicCompleteness('key1', fetchFn1)
    expect(data1b).toEqual({ total: 30 })
    expect(fetchFn1).toHaveBeenCalledTimes(1)

    // Call for key2 should execute fetchFn2
    const data2 = await cacheService.getMusicCompleteness('key2', fetchFn2)
    expect(data2).toEqual({ total: 40 })
    expect(fetchFn2).toHaveBeenCalledTimes(1)
  })

  it('should clear cache and notify windows on invalidate', async () => {
    const mockWindow = { id: 1 } as unknown as BrowserWindow
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWindow])

    const fetchSeries = vi.fn().mockResolvedValue({ total: 10 })
    const fetchCollection = vi.fn().mockResolvedValue({ total: 20 })
    const fetchMusic = vi.fn().mockResolvedValue({ total: 30 })

    // Populate cache
    await cacheService.getSeriesStats(fetchSeries)
    await cacheService.getCollectionStats(fetchCollection)
    await cacheService.getMusicCompleteness('key1', fetchMusic)

    // Invalidate
    cacheService.invalidate()

    // Assert cache is cleared
    await cacheService.getSeriesStats(fetchSeries)
    expect(fetchSeries).toHaveBeenCalledTimes(2)

    await cacheService.getCollectionStats(fetchCollection)
    expect(fetchCollection).toHaveBeenCalledTimes(2)

    await cacheService.getMusicCompleteness('key1', fetchMusic)
    expect(fetchMusic).toHaveBeenCalledTimes(2)

    // Assert notification sent
    expect(BrowserWindow.getAllWindows).toHaveBeenCalledTimes(1)
    expect(safeSend).toHaveBeenCalledWith(mockWindow, 'library:updated', { type: 'stats-cache-invalidated' })
  })

  it('should return singleton instance via getStatsCacheService', () => {
    const instance1 = getStatsCacheService()
    const instance2 = getStatsCacheService()
    expect(instance1).toBe(instance2)
    expect(instance1).toBeInstanceOf(StatsCacheService)
  })
})
