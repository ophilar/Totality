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
  const mockMediaAnalyze = vi.fn()
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
        mediaAnalyze: mockMediaAnalyze,
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
      useAnalysisManager()
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
        useAnalysisManager()
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
        useAnalysisManager()
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
        useAnalysisManager()
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

  it('dispatches every user-facing analysis scope through one action', async () => {
    mockMediaAnalyze.mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useAnalysisManager()
    )

    const scopes = [
      { kind: 'all-libraries' as const },
      { kind: 'library' as const, sourceId: 'src-1', libraryId: 'lib-1' },
      { kind: 'collection' as const, collectionId: 12 },
      { kind: 'show' as const, sourceId: 'src-1', libraryId: 'lib-1', seriesIdentityKey: 'tmdb:13', title: 'Show' },
      { kind: 'album' as const, albumId: 14 },
      { kind: 'item' as const, mediaId: 15 },
    ]
    for (const scope of scopes) {
      await act(async () => { await result.current.analyze(scope) })
    }

    expect(mockMediaAnalyze).toHaveBeenCalledTimes(scopes.length)
    expect(mockMediaAnalyze.mock.calls.map(([scope]) => scope)).toEqual(scopes)
  })
})
