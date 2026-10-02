import { useState, useCallback, useEffect } from 'react'
import type { AnalysisProgress, TVShowSummary } from '@/components/library/types'
import type { AnalysisScope } from '@/components/library/analysisScope'

type AnalysisType = 'series' | 'collections' | 'music'

interface UseAnalysisManagerReturn {
  taskQueueState: import('@main/types/database').TaskQueueState | null
  isAnalyzing: boolean
  setIsAnalyzing: (analyzing: boolean) => void
  analysisProgress: AnalysisProgress | null
  setAnalysisProgress: (progress: AnalysisProgress | null) => void
  analysisType: AnalysisType | null
  setAnalysisType: (type: AnalysisType | null) => void
  tmdbApiKeySet: boolean
  setTmdbApiKeySet: (set: boolean) => void
  handleAnalyzeAll: () => Promise<void>
  handleAnalyzeSingleSeries: (show: TVShowSummary) => Promise<void>
  analyze: (scope: AnalysisScope) => Promise<{ taskId: string; scope: AnalysisScope }>
  handleCancelAnalysis: (taskId: string) => Promise<void>
  checkTmdbApiKey: () => Promise<void>
}

/**
 * Hook to manage completeness analysis tasks
 *
 * Handles running series, collection, and music completeness analysis
 * via the task queue, with progress tracking and cancellation support.
 */
export function useAnalysisManager(): UseAnalysisManagerReturn {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analysisType, setAnalysisType] = useState<AnalysisType | null>(null)
  const [tmdbApiKeySet, setTmdbApiKeySet] = useState(false)
  const [taskQueueState, setTaskQueueState] = useState<import('@main/types/database').TaskQueueState | null>(null)

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.(state => setTaskQueueState(state as unknown as import('@main/types/database').TaskQueueState))
    window.electronAPI.taskQueueGetState?.().then(state => setTaskQueueState(state as unknown as import('@main/types/database').TaskQueueState))
    return () => { unsubscribe?.() }
  }, [])

  // Check if TMDB API key is configured
  const checkTmdbApiKey = useCallback(async () => {
    try {
      const key = await window.electronAPI.getSetting('tmdb_api_key')
      setTmdbApiKeySet(!!key && key.length > 0)
    } catch (err) {
      window.electronAPI.log.warn('[useAnalysisManager]', 'Failed to check TMDB API key:', err)
    }
  }, [])

  const handleAnalyzeAll = useCallback(async () => {
    await window.electronAPI.mediaAnalyze({ kind: 'all-libraries' })
  }, [])

  const handleAnalyzeSingleSeries = useCallback(
    async (show: TVShowSummary) => {
      try {
        window.electronAPI.log.info('[useAnalysisManager]', `Analyzing series: ${show.series_title}`)
        if (!show.source_id || !show.library_id || !show.series_identity_key) throw new Error('Show has no complete persisted identity')
        await window.electronAPI.mediaAnalyze({
          kind: 'show',
          sourceId: show.source_id,
          libraryId: show.library_id,
          seriesIdentityKey: show.series_identity_key,
          title: show.series_title,
        })
      } catch (err) {
        window.electronAPI.log.error('[useAnalysisManager]', 'Single series analysis failed:', err)
      }
    },
    []
  )

  const analyze = useCallback(async (scope: AnalysisScope) => {
    return window.electronAPI.mediaAnalyze(scope)
  }, [])

  // Cancel current analysis
  const handleCancelAnalysis = useCallback(async (taskId: string) => {
    try {
      await window.electronAPI.taskQueueCancelTask(taskId)
    } catch (err) {
      window.electronAPI.log.error('[useAnalysisManager]', 'Failed to cancel analysis:', err)
    }
  }, [])

  return {
    taskQueueState,
    isAnalyzing,
    setIsAnalyzing,
    analysisProgress,
    setAnalysisProgress,
    analysisType,
    setAnalysisType,
    tmdbApiKeySet,
    setTmdbApiKeySet,
    handleAnalyzeAll,
    handleAnalyzeSingleSeries,
    analyze,
    handleCancelAnalysis,
    checkTmdbApiKey,
  }
}
