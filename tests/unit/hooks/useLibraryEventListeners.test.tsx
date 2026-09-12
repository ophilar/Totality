/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useLibraryEventListeners } from '@/components/library/hooks/useLibraryEventListeners'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'

describe('useLibraryEventListeners', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('refreshes media and stats when quality analysis completes', async () => {
    const { api } = setupRealIntegratedBridge()
    let taskCompleteListener: Parameters<typeof api.onTaskQueueTaskComplete>[0] | undefined
    api.onTaskQueueTaskComplete = (callback) => {
      taskCompleteListener = callback
      return () => {}
    }

    const loadMedia = vi.fn().mockResolvedValue(undefined)
    const loadStats = vi.fn().mockResolvedValue(undefined)

    renderHook(() => useLibraryEventListeners({
      activeSourceId: 'src-1',
      loadMedia,
      loadStats,
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
    }))

    await act(async () => {
      taskCompleteListener?.({ type: 'quality-analysis', status: 'completed' } as never)
    })

    await waitFor(() => {
      expect(loadMedia).toHaveBeenCalledTimes(1)
      expect(loadStats).toHaveBeenCalledWith('src-1')
    })
  })
})
