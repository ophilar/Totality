/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLibraryEventListeners } from '@/components/library/hooks/useLibraryEventListeners'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'

describe('useLibraryEventListeners', () => {
  let listeners: Record<string, Function>

  const createOptions = (overrides = {}) => ({
    activeSourceId: 'src-1',
    loadMedia: vi.fn().mockResolvedValue(undefined),
    loadStats: vi.fn().mockResolvedValue(undefined),
    loadCompletenessData: vi.fn().mockResolvedValue(undefined),
    loadMusicData: vi.fn().mockResolvedValue(undefined),
    loadMusicCompletenessData: vi.fn().mockResolvedValue(undefined),
    loadActiveSourceLibraries: vi.fn().mockResolvedValue(undefined),
    loadEpSingleSettings: vi.fn().mockResolvedValue(undefined),
    setIsAnalyzing: vi.fn(),
    setAnalysisType: vi.fn(),
    setAnalysisProgress: vi.fn(),
    setTmdbApiKeySet: vi.fn(),
    setIsAutoRefreshing: vi.fn(),
    setActiveSource: vi.fn(),
    markLibraryAsNew: vi.fn(),
    addToast: vi.fn(),
    ...overrides,
  })

  beforeEach(async () => {
    await setupTestDb()
    vi.useFakeTimers()
    listeners = {}

    // Setup electronAPI listeners capture mock
    const mockElectronAPI = {
      onSeriesProgress: vi.fn((cb) => { listeners.onSeriesProgress = cb; return vi.fn() }),
      onCollectionsProgress: vi.fn((cb) => { listeners.onCollectionsProgress = cb; return vi.fn() }),
      onMusicAnalysisProgress: vi.fn((cb) => { listeners.onMusicAnalysisProgress = cb; return vi.fn() }),
      onLibraryUpdated: vi.fn((cb) => { listeners.onLibraryUpdated = cb; return vi.fn() }),
      onAutoRefreshStarted: vi.fn((cb) => { listeners.onAutoRefreshStarted = cb; return vi.fn() }),
      onAutoRefreshComplete: vi.fn((cb) => { listeners.onAutoRefreshComplete = cb; return vi.fn() }),
      onTaskQueueTaskComplete: vi.fn((cb) => { listeners.onTaskQueueTaskComplete = cb; return vi.fn() }),
      onTaskQueueUpdated: vi.fn((cb) => { listeners.onTaskQueueUpdated = cb; return vi.fn() }),
      onSettingsChanged: vi.fn((cb) => { listeners.onSettingsChanged = cb; return vi.fn() }),
      onWishlistAutoCompleted: vi.fn((cb) => { listeners.onWishlistAutoCompleted = cb; return vi.fn() }),
      onScanCompleted: vi.fn((cb) => { listeners.onScanCompleted = cb; return vi.fn() }),
      getSetting: vi.fn().mockImplementation((key: string) => {
        if (key === 'completeness_include_eps') return Promise.resolve('true')
        if (key === 'completeness_include_singles') return Promise.resolve('false')
        return Promise.resolve(null)
      }),
    }

    ;(window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanupTestDb()
  })

  it('handles debounced handleLibraryUpdate for active and non-active sources', async () => {
    const options = createOptions({ activeSourceId: 'src-1' })
    renderHook(() => useLibraryEventListeners(options))

    // 1. Update libraryToggle for non-matching sourceId -> Should not call loadActiveSourceLibraries
    act(() => {
      listeners.onLibraryUpdated({ type: 'libraryToggle', sourceId: 'src-2' })
      vi.advanceTimersByTime(1000)
    })
    expect(options.loadActiveSourceLibraries).not.toHaveBeenCalled()

    // 2. Update libraryToggle for matching sourceId -> Should call loadActiveSourceLibraries
    act(() => {
      listeners.onLibraryUpdated({ type: 'libraryToggle', sourceId: 'src-1' })
      vi.advanceTimersByTime(1000)
    })
    expect(options.loadActiveSourceLibraries).toHaveBeenCalledTimes(1)

    // 3. Update media for non-matching sourceId -> Should not call loadMedia/loadStats
    act(() => {
      listeners.onLibraryUpdated({ type: 'media', sourceId: 'src-2' })
      vi.advanceTimersByTime(1000)
    })
    expect(options.loadMedia).not.toHaveBeenCalled()
    expect(options.loadStats).not.toHaveBeenCalled()

    // 4. Update music without sourceId -> Should update active source
    act(() => {
      listeners.onLibraryUpdated({ type: 'music' })
      vi.advanceTimersByTime(1000)
    })
    expect(options.loadMedia).toHaveBeenCalledTimes(1)
    expect(options.loadStats).toHaveBeenCalledWith(undefined)
  })

  it('handles series, collections, and music analysis progress events', () => {
    const options = createOptions()
    renderHook(() => useLibraryEventListeners(options))

    const sampleProgress = { current: 5, total: 10, percent: 50 }

    act(() => {
      listeners.onSeriesProgress(sampleProgress)
    })
    expect(options.setAnalysisProgress).toHaveBeenCalledWith(sampleProgress)

    act(() => {
      listeners.onCollectionsProgress(sampleProgress)
    })
    expect(options.setAnalysisProgress).toHaveBeenCalledWith(sampleProgress)

    act(() => {
      listeners.onMusicAnalysisProgress(sampleProgress)
    })
    expect(options.setAnalysisProgress).toHaveBeenCalledWith(sampleProgress)
  })

  it('handles auto refresh start and complete events', () => {
    const options = createOptions()
    renderHook(() => useLibraryEventListeners(options))

    act(() => {
      listeners.onAutoRefreshStarted()
    })
    expect(options.setIsAutoRefreshing).toHaveBeenCalledWith(true)

    act(() => {
      listeners.onAutoRefreshComplete()
    })
    expect(options.setIsAutoRefreshing).toHaveBeenCalledWith(false)
  })

  it('debounces and flushes completed tasks correctly', async () => {
    const options = createOptions({ activeSourceId: 'src-1' })
    renderHook(() => useLibraryEventListeners(options))

    act(() => {
      listeners.onTaskQueueTaskComplete({ type: 'quality-analysis', status: 'completed' })
      listeners.onTaskQueueTaskComplete({ type: 'series-completeness', status: 'completed' })
      listeners.onTaskQueueTaskComplete({ type: 'music-completeness', status: 'completed' })
      // Ignored non-completed status
      listeners.onTaskQueueTaskComplete({ type: 'collection-completeness', status: 'failed' })
    })

    // Before timer flushes
    expect(options.loadMedia).not.toHaveBeenCalled()

    // Advance 250ms debounce
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    expect(options.loadMedia).toHaveBeenCalledTimes(1)
    expect(options.loadStats).toHaveBeenCalledWith('src-1')
    expect(options.loadCompletenessData).toHaveBeenCalledTimes(1)
    expect(options.loadMusicCompletenessData).toHaveBeenCalledTimes(1)
  })

  it('syncs analyzing state on task queue updates', () => {
    const options = createOptions()
    renderHook(() => useLibraryEventListeners(options))

    const progress = { current: 1, total: 2, percent: 50 }

    // 1. Series completeness task
    act(() => {
      listeners.onTaskQueueUpdated({ currentTask: { type: 'series-completeness', progress } })
    })
    expect(options.setIsAnalyzing).toHaveBeenCalledWith(true)
    expect(options.setAnalysisType).toHaveBeenCalledWith('series')
    expect(options.setAnalysisProgress).toHaveBeenCalledWith(progress)

    // 2. Collection completeness task
    act(() => {
      listeners.onTaskQueueUpdated({ currentTask: { type: 'collection-completeness', progress } })
    })
    expect(options.setIsAnalyzing).toHaveBeenCalledWith(true)
    expect(options.setAnalysisType).toHaveBeenCalledWith('collections')
    expect(options.setAnalysisProgress).toHaveBeenCalledWith(progress)

    // 3. Music completeness task
    act(() => {
      listeners.onTaskQueueUpdated({ currentTask: { type: 'music-completeness', progress } })
    })
    expect(options.setIsAnalyzing).toHaveBeenCalledWith(true)
    expect(options.setAnalysisType).toHaveBeenCalledWith('music')
    expect(options.setAnalysisProgress).toHaveBeenCalledWith(progress)

    // 4. Other non-completeness task
    act(() => {
      listeners.onTaskQueueUpdated({ currentTask: { type: 'quality-analysis' } })
    })
    expect(options.setIsAnalyzing).toHaveBeenCalledWith(false)
    expect(options.setAnalysisType).toHaveBeenCalledWith(null)

    // 5. No current task
    act(() => {
      listeners.onTaskQueueUpdated({ currentTask: null })
    })
    expect(options.setIsAnalyzing).toHaveBeenCalledWith(false)
    expect(options.setAnalysisType).toHaveBeenCalledWith(null)
    expect(options.setAnalysisProgress).toHaveBeenCalledWith(null)
  })

  it('handles settings changes for TMDB key and EP/Singles inclusions', async () => {
    const options = createOptions()
    renderHook(() => useLibraryEventListeners(options))

    // 1. TMDB API Key setting
    act(() => {
      listeners.onSettingsChanged({ key: 'tmdb_api_key', hasValue: true })
    })
    expect(options.setTmdbApiKeySet).toHaveBeenCalledWith(true)

    // 2. Completeness EP settings change
    await act(async () => {
      await listeners.onSettingsChanged({ key: 'completeness_include_eps', hasValue: true })
    })

    expect(options.loadEpSingleSettings).toHaveBeenCalled()
    expect(options.loadMusicData).toHaveBeenCalled()
    expect(options.loadMusicCompletenessData).toHaveBeenCalledWith(true, false)
  })

  it('triggers completeness reloads on window exclusions-changed event', () => {
    const options = createOptions()
    renderHook(() => useLibraryEventListeners(options))

    act(() => {
      window.dispatchEvent(new Event('exclusions-changed'))
    })

    expect(options.loadCompletenessData).toHaveBeenCalledTimes(1)
    expect(options.loadMusicCompletenessData).toHaveBeenCalledTimes(1)
  })

  it('handles wishlist auto-completed notifications', () => {
    const options = createOptions()
    renderHook(() => useLibraryEventListeners(options))

    // Single item completed
    act(() => {
      listeners.onWishlistAutoCompleted([{ title: 'Inception' }])
    })
    expect(options.addToast).toHaveBeenCalledWith({
      type: 'success',
      title: 'Wishlist item completed',
      message: '"Inception" has been fulfilled',
    })

    // Multiple items completed
    act(() => {
      listeners.onWishlistAutoCompleted([{ title: 'Inception' }, { title: 'Interstellar' }])
    })
    expect(options.addToast).toHaveBeenCalledWith({
      type: 'success',
      title: '2 wishlist items completed',
      message: 'Inception, Interstellar',
    })
  })

  it('handles scan completed notifications, toast actions, badges, and first scan navigation', () => {
    const options = createOptions()
    renderHook(() => useLibraryEventListeners(options))

    // 1. Scan completed with changes and first scan
    act(() => {
      listeners.onScanCompleted({
        libraryName: 'Movies',
        sourceId: 'src-1',
        libraryId: 'lib-1',
        itemsScanned: 100,
        itemsAdded: 5,
        itemsUpdated: 2,
        isFirstScan: true,
      })
    })

    expect(options.addToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        title: 'Movies complete',
        message: 'Added 5, updated 2',
      })
    )
    expect(options.markLibraryAsNew).toHaveBeenCalledWith('src-1:lib-1', 5)
    expect(options.setActiveSource).toHaveBeenCalledWith('src-1')

    // Test toast action onClick
    const toastArgs = options.addToast.mock.calls[0][0]
    expect(toastArgs.action?.label).toBe('View Library')
    act(() => {
      toastArgs.action?.onClick()
    })
    expect(options.setActiveSource).toHaveBeenCalledWith('src-1')

    // 2. Scan completed without changes and without sourceId
    options.addToast.mockClear()
    act(() => {
      listeners.onScanCompleted({
        libraryName: 'TV Shows',
        itemsScanned: 50,
        itemsAdded: 0,
        itemsUpdated: 0,
        isFirstScan: false,
      })
    })

    expect(options.addToast).toHaveBeenCalledWith({
      type: 'success',
      title: 'TV Shows complete',
      message: '50 items scanned, no changes',
      action: undefined,
    })
  })

  it('cleans up all listeners and timers on unmount', () => {
    const cleanupSeriesProgress = vi.fn()
    const cleanupCollectionsProgress = vi.fn()
    const cleanupMusicAnalysisProgress = vi.fn()
    const cleanupLibraryUpdated = vi.fn()
    const cleanupAutoRefreshStarted = vi.fn()
    const cleanupAutoRefreshComplete = vi.fn()
    const cleanupTaskComplete = vi.fn()
    const cleanupTaskQueueUpdated = vi.fn()
    const cleanupSettingsChanged = vi.fn()
    const cleanupWishlistAutoCompleted = vi.fn()
    const cleanupScanCompleted = vi.fn()

    const mockElectronAPI = {
      onSeriesProgress: vi.fn(() => cleanupSeriesProgress),
      onCollectionsProgress: vi.fn(() => cleanupCollectionsProgress),
      onMusicAnalysisProgress: vi.fn(() => cleanupMusicAnalysisProgress),
      onLibraryUpdated: vi.fn(() => cleanupLibraryUpdated),
      onAutoRefreshStarted: vi.fn(() => cleanupAutoRefreshStarted),
      onAutoRefreshComplete: vi.fn(() => cleanupAutoRefreshComplete),
      onTaskQueueTaskComplete: vi.fn(() => cleanupTaskComplete),
      onTaskQueueUpdated: vi.fn(() => cleanupTaskQueueUpdated),
      onSettingsChanged: vi.fn(() => cleanupSettingsChanged),
      onWishlistAutoCompleted: vi.fn(() => cleanupWishlistAutoCompleted),
      onScanCompleted: vi.fn(() => cleanupScanCompleted),
      getSetting: vi.fn(),
    }

    ;(window as unknown as { electronAPI: typeof mockElectronAPI }).electronAPI = mockElectronAPI

    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const options = createOptions()
    const { unmount } = renderHook(() => useLibraryEventListeners(options))

    unmount()

    expect(cleanupSeriesProgress).toHaveBeenCalled()
    expect(cleanupCollectionsProgress).toHaveBeenCalled()
    expect(cleanupMusicAnalysisProgress).toHaveBeenCalled()
    expect(cleanupLibraryUpdated).toHaveBeenCalled()
    expect(cleanupAutoRefreshStarted).toHaveBeenCalled()
    expect(cleanupAutoRefreshComplete).toHaveBeenCalled()
    expect(cleanupTaskComplete).toHaveBeenCalled()
    expect(cleanupTaskQueueUpdated).toHaveBeenCalled()
    expect(cleanupSettingsChanged).toHaveBeenCalled()
    expect(cleanupWishlistAutoCompleted).toHaveBeenCalled()
    expect(cleanupScanCompleted).toHaveBeenCalled()
    expect(removeEventListenerSpy).toHaveBeenCalledWith('exclusions-changed', expect.any(Function))
  })
})
