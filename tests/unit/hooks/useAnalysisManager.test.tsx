/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAnalysisManager } from '@/components/library/hooks/useAnalysisManager'
import type { MediaSource, AnalysisProgress, TVShowSummary } from '@/components/library/types'

describe('useAnalysisManager', () => {
  const mockGetSetting = vi.fn()
  const mockTaskQueueAddTask = vi.fn()
  const mockSeriesAnalyzeByIdentity = vi.fn()
  const mockTaskQueueCancelCurrent = vi.fn()
  const mockLogWarn = vi.fn()
  const mockLogError = vi.fn()
  const mockLogInfo = vi.fn()
  const mockLoadCompletenessData = vi.fn()

  const defaultSources: MediaSource[] = [
    { source_id: 'src-1', display_name: 'Plex Server', type: 'plex', path: '/media' },
    { source_id: 'src-2', display_name: 'Jellyfin Server', type: 'jellyfin', path: '/media2' }
  ]

  const defaultLibraries = [
    { id: 'lib-1', name: 'TV Shows', type: 'show' },
    { id: 'lib-2', name: 'Movies', type: 'movie' }
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    Object.assign(window, {
      electronAPI: {
        getSetting: mockGetSetting,
        taskQueueAddTask: mockTaskQueueAddTask,
        seriesAnalyzeByIdentity: mockSeriesAnalyzeByIdentity,
        taskQueueCancelCurrent: mockTaskQueueCancelCurrent,
        log: {
          warn: mockLogWarn,
          error: mockLogError,
          info: mockLogInfo,
        },
      },
    })
  })

  it('initializes default state and supports state setters', () => {
    const { result } = renderHook(() =>
      useAnalysisManager({
        sources: defaultSources,
        activeSourceId: null,
        activeSourceLibraries: defaultLibraries,
        loadCompletenessData: mockLoadCompletenessData,
      })
    )

    expect(result.current.isAnalyzing).toBe(false)
    expect(result.current.analysisProgress).toBeNull()
    expect(result.current.analysisType).toBeNull()
    expect(result.current.tmdbApiKeySet).toBe(false)

    act(() => {
      result.current.setIsAnalyzing(true)
      result.current.setAnalysisType('series')
      result.current.setTmdbApiKeySet(true)
      const progress: AnalysisProgress = { current: 5, total: 10, item: 'Show A' }
      result.current.setAnalysisProgress(progress)
    })

    expect(result.current.isAnalyzing).toBe(true)
    expect(result.current.analysisType).toBe('series')
    expect(result.current.tmdbApiKeySet).toBe(true)
    expect(result.current.analysisProgress).toEqual({ current: 5, total: 10, item: 'Show A' })
  })

  describe('checkTmdbApiKey', () => {
    it('sets tmdbApiKeySet to true when API key is present and non-empty', async () => {
      mockGetSetting.mockResolvedValue('valid-key-123')

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.checkTmdbApiKey()
      })

      expect(mockGetSetting).toHaveBeenCalledWith('tmdb_api_key')
      expect(result.current.tmdbApiKeySet).toBe(true)
    })

    it('sets tmdbApiKeySet to false when API key is empty or null', async () => {
      mockGetSetting.mockResolvedValue('')

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.checkTmdbApiKey()
      })

      expect(result.current.tmdbApiKeySet).toBe(false)
    })

    it('logs warning when checkTmdbApiKey fails', async () => {
      const error = new Error('Storage error')
      mockGetSetting.mockRejectedValue(error)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.checkTmdbApiKey()
      })

      expect(mockLogWarn).toHaveBeenCalledWith(
        '[useAnalysisManager]',
        'Failed to check TMDB API key:',
        error
      )
    })
  })

  describe('handleAnalyzeSeries', () => {
    it('queues series analysis task with default source when activeSourceId is null', async () => {
      mockTaskQueueAddTask.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeSeries()
      })

      expect(mockTaskQueueAddTask).toHaveBeenCalledWith({
        type: 'series-completeness',
        label: 'Analyze TV Series (All Sources)',
        sourceId: undefined,
        libraryId: undefined,
      })
    })

    it('queues series analysis task with source name and library name when provided', async () => {
      mockTaskQueueAddTask.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: 'src-1',
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeSeries('lib-1')
      })

      expect(mockTaskQueueAddTask).toHaveBeenCalledWith({
        type: 'series-completeness',
        label: 'Analyze TV Series (Plex Server - TV Shows)',
        sourceId: 'src-1',
        libraryId: 'lib-1',
      })
    })

    it('logs error if handleAnalyzeSeries fails', async () => {
      const error = new Error('Queue failed')
      mockTaskQueueAddTask.mockRejectedValue(error)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: 'src-1',
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeSeries()
      })

      expect(mockLogError).toHaveBeenCalledWith(
        '[useAnalysisManager]',
        'Failed to queue series analysis:',
        error
      )
    })
  })

  describe('handleAnalyzeCollections', () => {
    it('queues collection analysis task with formatted label', async () => {
      mockTaskQueueAddTask.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: 'src-2',
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeCollections('lib-2')
      })

      expect(mockTaskQueueAddTask).toHaveBeenCalledWith({
        type: 'collection-completeness',
        label: 'Analyze Collections (Jellyfin Server - Movies)',
        sourceId: 'src-2',
        libraryId: 'lib-2',
      })
    })

    it('logs error if handleAnalyzeCollections fails', async () => {
      const error = new Error('Queue failed')
      mockTaskQueueAddTask.mockRejectedValue(error)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeCollections()
      })

      expect(mockLogError).toHaveBeenCalledWith(
        '[useAnalysisManager]',
        'Failed to queue collections analysis:',
        error
      )
    })
  })

  describe('handleAnalyzeMusic', () => {
    it('queues music analysis task', async () => {
      mockTaskQueueAddTask.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: 'src-1',
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeMusic()
      })

      expect(mockTaskQueueAddTask).toHaveBeenCalledWith({
        type: 'music-completeness',
        label: 'Analyze Music (Plex Server)',
        sourceId: 'src-1',
      })
    })

    it('logs error if handleAnalyzeMusic fails', async () => {
      const error = new Error('Queue failed')
      mockTaskQueueAddTask.mockRejectedValue(error)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeMusic()
      })

      expect(mockLogError).toHaveBeenCalledWith(
        '[useAnalysisManager]',
        'Failed to queue music analysis:',
        error
      )
    })
  })

  describe('handleAnalyzeQuality', () => {
    it('queues quality analysis task', async () => {
      mockTaskQueueAddTask.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeQuality()
      })

      expect(mockTaskQueueAddTask).toHaveBeenCalledWith({
        type: 'quality-analysis',
        label: 'Recalculate Media Quality (All Sources)',
        sourceId: undefined,
      })
    })
  })

  describe('handleAnalyzeAll', () => {
    it('triggers quality and requested category analysis tasks', async () => {
      mockTaskQueueAddTask.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: 'src-1',
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeAll(true, true, true)
      })

      expect(mockTaskQueueAddTask).toHaveBeenCalledTimes(4)
      expect(mockTaskQueueAddTask).toHaveBeenNthCalledWith(1, {
        type: 'quality-analysis',
        label: 'Recalculate Media Quality (Plex Server)',
        sourceId: 'src-1',
      })
      expect(mockTaskQueueAddTask).toHaveBeenNthCalledWith(2, {
        type: 'series-completeness',
        label: 'Analyze TV Series (Plex Server)',
        sourceId: 'src-1',
        libraryId: undefined,
      })
      expect(mockTaskQueueAddTask).toHaveBeenNthCalledWith(3, {
        type: 'collection-completeness',
        label: 'Analyze Collections (Plex Server)',
        sourceId: 'src-1',
        libraryId: undefined,
      })
      expect(mockTaskQueueAddTask).toHaveBeenNthCalledWith(4, {
        type: 'music-completeness',
        label: 'Analyze Music (Plex Server)',
        sourceId: 'src-1',
      })
    })

    it('only triggers quality analysis if flags are false', async () => {
      mockTaskQueueAddTask.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeAll(false, false, false)
      })

      expect(mockTaskQueueAddTask).toHaveBeenCalledTimes(1)
      expect(mockTaskQueueAddTask).toHaveBeenCalledWith({
        type: 'quality-analysis',
        label: 'Recalculate Media Quality (All Sources)',
        sourceId: undefined,
      })
    })
  })

  describe('handleAnalyzeSingleSeries', () => {
    const showSummary: TVShowSummary = {
      series_title: 'Breaking Bad',
      source_id: 'src-1',
      series_identity_key: 'tmdb:1396',
      library_id: 'lib-1',
      total_seasons: 5,
      total_episodes: 62,
      episodes_on_disk: 62,
      completion_percentage: 100,
    }

    it('calls seriesAnalyzeByIdentity and reloads completeness data on success', async () => {
      mockSeriesAnalyzeByIdentity.mockResolvedValue(undefined)
      mockLoadCompletenessData.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: 'src-1',
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeSingleSeries(showSummary)
      })

      expect(mockLogInfo).toHaveBeenCalledWith(
        '[useAnalysisManager]',
        'Analyzing series: Breaking Bad'
      )
      expect(mockSeriesAnalyzeByIdentity).toHaveBeenCalledWith(
        'Breaking Bad',
        'src-1',
        'tmdb:1396',
        'lib-1'
      )
      expect(mockLoadCompletenessData).toHaveBeenCalledTimes(1)
    })

    it('logs error if handleAnalyzeSingleSeries fails', async () => {
      const error = new Error('Single series analysis failed')
      mockSeriesAnalyzeByIdentity.mockRejectedValue(error)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: 'src-1',
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleAnalyzeSingleSeries(showSummary)
      })

      expect(mockLogError).toHaveBeenCalledWith(
        '[useAnalysisManager]',
        'Single series analysis failed:',
        error
      )
      expect(mockLoadCompletenessData).not.toHaveBeenCalled()
    })
  })

  describe('handleCancelAnalysis', () => {
    it('calls taskQueueCancelCurrent', async () => {
      mockTaskQueueCancelCurrent.mockResolvedValue(undefined)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleCancelAnalysis('series')
      })

      expect(mockTaskQueueCancelCurrent).toHaveBeenCalledTimes(1)
    })

    it('logs error if taskQueueCancelCurrent fails', async () => {
      const error = new Error('Cancellation failed')
      mockTaskQueueCancelCurrent.mockRejectedValue(error)

      const { result } = renderHook(() =>
        useAnalysisManager({
          sources: defaultSources,
          activeSourceId: null,
          activeSourceLibraries: defaultLibraries,
          loadCompletenessData: mockLoadCompletenessData,
        })
      )

      await act(async () => {
        await result.current.handleCancelAnalysis('series')
      })

      expect(mockLogError).toHaveBeenCalledWith(
        '[useAnalysisManager]',
        'Failed to cancel analysis:',
        error
      )
    })
  })
})
