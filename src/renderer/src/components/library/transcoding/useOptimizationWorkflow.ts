import { useCallback, useMemo, useState } from 'react'
import type { QueueState } from '@main/types/taskQueue'
import type { ShowTranscodePreflight } from './types'
import { summarizeOptimizationBatch } from '../tv/batchOutcomeSummary'

export type OptimizationWorkflowStage = 'options' | 'review' | 'results'

export function useOptimizationWorkflow(queueState: QueueState) {
  const [stage, setStage] = useState<OptimizationWorkflowStage>('options')
  const [review, setReview] = useState<ShowTranscodePreflight | null>(null)
  const [reviewedOptions, setReviewedOptions] = useState<string | null>(null)
  const [reviewedSampleGroups, setReviewedSampleGroups] = useState<string[]>([])
  const [batchId, setBatchId] = useState<string>()
  const [submittedMediaItemIds, setSubmittedMediaItemIds] = useState<number[]>([])
  const [submittedTaskIds, setSubmittedTaskIds] = useState<string[]>([])
  const [queueControlState, setQueueControlState] = useState<'pausing' | 'resuming' | null>(null)

  const batchSummary = useMemo(
    () => batchId ? summarizeOptimizationBatch(queueState, batchId, submittedMediaItemIds, submittedTaskIds) : null,
    [queueState, batchId, submittedMediaItemIds, submittedTaskIds],
  )

  const reviewMatches = useCallback((effectiveOptions: unknown) => Boolean(review && reviewedOptions === JSON.stringify(effectiveOptions)), [review, reviewedOptions])

  const replaceReview = useCallback((nextReview: ShowTranscodePreflight, effectiveOptions: unknown) => {
    setReview(nextReview)
    setReviewedOptions(JSON.stringify(effectiveOptions))
    setReviewedSampleGroups([])
  }, [])

  const clearReview = useCallback(() => {
    setReview(null)
    setReviewedOptions(null)
    setReviewedSampleGroups([])
  }, [])

  const submitBatch = useCallback((nextBatchId: string, mediaItemIds: number[], taskIds: string[]) => {
    setBatchId(nextBatchId)
    setSubmittedMediaItemIds(mediaItemIds)
    setSubmittedTaskIds(taskIds)
  }, [])

  const appendSubmittedTasks = useCallback((mediaItemIds: number[], taskIds: string[]) => {
    setSubmittedMediaItemIds(ids => [...new Set([...ids, ...mediaItemIds])])
    setSubmittedTaskIds(ids => [...new Set([...ids, ...taskIds])])
  }, [])

  const toggleQueuePause = useCallback(async (onError: (error: unknown, resuming: boolean) => void) => {
    const resuming = queueState.isPaused
    setQueueControlState(resuming ? 'resuming' : 'pausing')
    try {
      if (resuming) await window.electronAPI.taskQueueResume()
      else await window.electronAPI.taskQueuePause()
    } catch (error) {
      onError(error, resuming)
    } finally {
      setQueueControlState(null)
    }
  }, [queueState.isPaused])

  const retryFailedTasks = useCallback(async (
    onQueued: (mediaItemCount: number) => void,
    onError: (error: unknown) => void,
  ) => {
    if (!review || !batchSummary || batchSummary.activeCount > 0 || batchSummary.failedMediaItemIds.length + batchSummary.cancelledMediaItemIds.length === 0) return
    try {
      const queued = await window.electronAPI.queueShow(review.preflightId)
      appendSubmittedTasks(queued.queuedMediaItemIds, queued.queuedTaskIds)
      onQueued(queued.queuedMediaItemIds.length)
    } catch (error) {
      onError(error)
    }
  }, [review, batchSummary, appendSubmittedTasks])

  return useMemo(() => ({
    stage,
    setStage,
    review,
    setReview,
    reviewedOptions,
    reviewedSampleGroups,
    setReviewedSampleGroups,
    batchId,
    submittedMediaItemIds,
    submittedTaskIds,
    queueControlState,
    batchSummary,
    reviewMatches,
    replaceReview,
    clearReview,
    submitBatch,
    appendSubmittedTasks,
    toggleQueuePause,
    retryFailedTasks,
  }), [stage, setStage, review, setReview, reviewedOptions, reviewedSampleGroups, batchId, submittedMediaItemIds, submittedTaskIds, queueControlState, batchSummary, reviewMatches, replaceReview, clearReview, submitBatch, appendSubmittedTasks, toggleQueuePause, retryFailedTasks])
}
