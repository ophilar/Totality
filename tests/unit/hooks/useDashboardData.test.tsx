/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDashboardData } from '@/components/dashboard/hooks/useDashboardData'
import type { DashboardSummary, MediaItem, MusicAlbum, MovieCollection, SeriesCompleteness, ArtistCompleteness } from '@main/types/database'

describe('useDashboardData', () => {
  const mockDashboardSummary: DashboardSummary = {
    movieUpgrades: [{ id: 1, title: 'Movie 1', plex_id: 'p1', type: 'movie' } as MediaItem],
    tvUpgrades: [{ id: 2, title: 'TV 1', plex_id: 'p2', type: 'episode' } as MediaItem],
    musicUpgrades: [{ id: 3, title: 'Album 1', artist_name: 'Artist 1' } as MusicAlbum],
    incompleteCollections: [{ tmdb_collection_id: 'c1', collection_name: 'Collection 1' } as MovieCollection],
    incompleteSeries: [{ series_title: 'Series 1' } as SeriesCompleteness],
    incompleteArtists: [{ artist_name: 'Artist 1' } as ArtistCompleteness],
    storageWaste: [],
    settings: {
      includeEps: false,
      includeSingles: false,
      upgradeSort: 'title',
      collectionSort: 'name',
      seriesSort: 'title',
      artistSort: 'name',
      collectionSortOrder: 'asc',
      seriesSortOrder: 'asc',
      artistSortOrder: 'asc'
    }
  }

  let settingsChangedCb: ((data: { key: string }) => void) | null = null
  let scanCompletedCb: (() => void) | null = null
  let taskQueueTaskCompleteCb: (() => void) | null = null
  let libraryUpdatedCb: (() => void) | null = null

  const cleanupSettingsChanged = vi.fn()
  const cleanupScanCompleted = vi.fn()
  const cleanupTaskQueueTaskComplete = vi.fn()
  const cleanupLibraryUpdated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    settingsChangedCb = null
    scanCompletedCb = null
    taskQueueTaskCompleteCb = null
    libraryUpdatedCb = null

    const mockApi = {
      getDashboardSummary: vi.fn().mockResolvedValue(mockDashboardSummary),
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'dashboard_upgrade_sort_order') {
          return Promise.resolve('desc')
        }
        return Promise.resolve(null)
      }),
      setSetting: vi.fn().mockResolvedValue(undefined),
      log: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      },
      onSettingsChanged: vi.fn((cb) => {
        settingsChangedCb = cb
        return cleanupSettingsChanged
      }),
      onScanCompleted: vi.fn((cb) => {
        scanCompletedCb = cb
        return cleanupScanCompleted
      }),
      onTaskQueueTaskComplete: vi.fn((cb) => {
        taskQueueTaskCompleteCb = cb
        return cleanupTaskQueueTaskComplete
      }),
      onLibraryUpdated: vi.fn((cb) => {
        libraryUpdatedCb = cb
        return cleanupLibraryUpdated
      })
    }

    Object.assign(window, { electronAPI: mockApi })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize and load dashboard summary data and settings', async () => {
    const { result } = renderHook(() => useDashboardData(null))

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(window.electronAPI.getDashboardSummary).toHaveBeenCalledWith(undefined)
    expect(window.electronAPI.getSetting).toHaveBeenCalledWith('dashboard_upgrade_sort_order')

    expect(result.current.movieUpgrades).toEqual(mockDashboardSummary.movieUpgrades)
    expect(result.current.tvUpgrades).toEqual(mockDashboardSummary.tvUpgrades)
    expect(result.current.musicUpgrades).toEqual(mockDashboardSummary.musicUpgrades)
    expect(result.current.collections).toEqual(mockDashboardSummary.incompleteCollections)
    expect(result.current.series).toEqual(mockDashboardSummary.incompleteSeries)
    expect(result.current.artists).toEqual(mockDashboardSummary.incompleteArtists)

    expect(result.current.upgradeSortBy).toBe('title')
    expect(result.current.upgradeSortOrder).toBe('desc')
    expect(result.current.collectionSortBy).toBe('name')
    expect(result.current.seriesSortBy).toBe('title')
    expect(result.current.artistSortBy).toBe('name')
    expect(result.current.collectionSortOrder).toBe('asc')
    expect(result.current.seriesSortOrder).toBe('asc')
    expect(result.current.artistSortOrder).toBe('asc')
    expect(result.current.includeEps).toBe(false)
    expect(result.current.includeSingles).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should pass activeSourceId to getDashboardSummary when provided', async () => {
    const { result } = renderHook(() => useDashboardData('source-123'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(window.electronAPI.getDashboardSummary).toHaveBeenCalledWith('source-123')
  })

  it('should set error state and log when getDashboardSummary fails', async () => {
    const error = new Error('Database connection failed')
    vi.mocked(window.electronAPI.getDashboardSummary).mockRejectedValueOnce(error)

    const { result } = renderHook(() => useDashboardData(null))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error).toBe('Failed to load dashboard data. Please try again.')
    expect(window.electronAPI.log.error).toHaveBeenCalledWith(
      'Dashboard',
      'Failed to load dashboard summary:',
      error
    )
  })

  it('should update upgradeSortOrder state and persist setting when setUpgradeSortOrder is called', async () => {
    const { result } = renderHook(() => useDashboardData(null))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      result.current.setUpgradeSortOrder('asc')
    })

    expect(result.current.upgradeSortOrder).toBe('asc')
    expect(window.electronAPI.setSetting).toHaveBeenCalledWith('dashboard_upgrade_sort_order', 'asc')
  })

  it('should reload dashboard data when onSettingsChanged fires for a relevant setting', async () => {
    const { result } = renderHook(() => useDashboardData(null))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const callsCountBefore = vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length

    // Irrelevant key should not trigger reload
    await act(async () => {
      settingsChangedCb?.({ key: 'unrelated_setting' })
    })
    expect(vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length).toBe(callsCountBefore)

    // Relevant key should trigger reload
    await act(async () => {
      settingsChangedCb?.({ key: 'completeness_include_eps' })
    })

    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length).toBe(callsCountBefore + 1)
    })
  })

  it('should reload dashboard data on IPC scan, task queue, and library update events', async () => {
    const { result } = renderHook(() => useDashboardData(null))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const initialCalls = vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length

    await act(async () => {
      scanCompletedCb?.()
    })
    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length).toBe(initialCalls + 1)
    })

    await act(async () => {
      taskQueueTaskCompleteCb?.()
    })
    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length).toBe(initialCalls + 2)
    })

    await act(async () => {
      libraryUpdatedCb?.()
    })
    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length).toBe(initialCalls + 3)
    })
  })

  it('should reload dashboard data when exclusions-changed DOM event is dispatched', async () => {
    const { result } = renderHook(() => useDashboardData(null))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const initialCalls = vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length

    await act(async () => {
      window.dispatchEvent(new Event('exclusions-changed'))
    })

    await waitFor(() => {
      expect(vi.mocked(window.electronAPI.getDashboardSummary).mock.calls.length).toBe(initialCalls + 1)
    })
  })

  it('should clean up all event listeners on unmount', async () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { result, unmount } = renderHook(() => useDashboardData(null))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    unmount()

    expect(cleanupSettingsChanged).toHaveBeenCalled()
    expect(cleanupScanCompleted).toHaveBeenCalled()
    expect(cleanupTaskQueueTaskComplete).toHaveBeenCalled()
    expect(cleanupLibraryUpdated).toHaveBeenCalled()
    expect(removeEventListenerSpy).toHaveBeenCalledWith('exclusions-changed', expect.any(Function))
  })
})
