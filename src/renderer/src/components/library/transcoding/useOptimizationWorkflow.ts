import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueState, QueuedTask } from '@main/types/taskQueue'
import type { SavedShowPreflight, ShowTranscodePreflight } from './types'
import { summarizeOptimizationBatch } from '../tv/batchOutcomeSummary'

export type OptimizationWorkflowStage = 'options' | 'review' | 'results'
export type ReviewPreparationProgress = { percentage?: number; phase?: string; currentItem?: string }
export type ReviewPreparationState = 'queued' | 'running' | 'pausing' | 'paused' | 'finishing' | null
export type ReviewPreparationTermination = 'cancelling' | 'finishing' | null

interface PreparationObserver {
  enabled: boolean
  requestId?: string | null
  matchesScope: (task: QueuedTask) => boolean
  fallbackPhase: string
  onReviewLoaded: (saved: SavedShowPreflight) => void
  onFailure: (message: string) => void
  onActivity: (active: boolean) => void
}

export function useOptimizationWorkflow(onQueueError: (error: unknown) => void) {
  const [queueState, setQueueState] = useState<QueueState>({ currentTask: null, queue: [], isPaused: false, completedTasks: [] })
  const [stage, setStage] = useState<OptimizationWorkflowStage>('options')
  const [review, setReview] = useState<ShowTranscodePreflight | null>(null)
  const [reviewedOptions, setReviewedOptions] = useState<string | null>(null)
  const [reviewedSampleGroups, setReviewedSampleGroups] = useState<string[]>([])
  const [batchId, setBatchId] = useState<string>()
  const [submittedMediaItemIds, setSubmittedMediaItemIds] = useState<number[]>([])
  const [submittedTaskIds, setSubmittedTaskIds] = useState<string[]>([])
  const [queueControlState, setQueueControlState] = useState<'pausing' | 'resuming' | null>(null)
  const [preparationTermination, setPreparationTermination] = useState<ReviewPreparationTermination>(null)
  const [preparationProgress, setPreparationProgress] = useState<ReviewPreparationProgress | null>(null)
  const [preparationState, setPreparationState] = useState<ReviewPreparationState>(null)
  const activePreparationRequestId = useRef<string | null>(null)
  const activePreparationTaskId = useRef<string | null>(null)
  const rejectPreparation = useRef<((error: Error) => void) | null>(null)
  const preparationMovedToBackground = useRef(false)
  const preparationStartedHere = useRef(false)
  const processedPreparationTaskId = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.(setQueueState)
    void window.electronAPI.taskQueueGetState?.().then(setQueueState).catch(onQueueError)
    return () => unsubscribe?.()
  }, [onQueueError])

  const reconcilePreparationQueue = useCallback((state: QueueState, observer: PreparationObserver, isMounted: () => boolean) => {
    if (!observer.enabled) return
    const tasks = [state.currentTask, ...state.queue, ...state.completedTasks]
      .filter((task): task is QueuedTask => task !== null)
    const task = observer.requestId
      ? tasks.find(candidate => (candidate.options as { requestId?: string } | undefined)?.requestId === observer.requestId)
      : activePreparationTaskId.current
        ? tasks.find(candidate => candidate.id === activePreparationTaskId.current)
        : preparationStartedHere.current ? undefined : tasks
          .filter(candidate => observer.matchesScope(candidate) && ['queued', 'running'].includes(candidate.status))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

    if (!task) return
    if (['completed', 'failed', 'cancelled'].includes(task.status) && processedPreparationTaskId.current === task.id) return

    activePreparationTaskId.current = task.id
    activePreparationRequestId.current = (task.options as { requestId?: string } | undefined)?.requestId ?? null
    preparationMovedToBackground.current = false
    if (task.status === 'queued' || task.status === 'running') {
      observer.onActivity(true)
      setPreparationState(state.isPaused ? 'paused' : task.status === 'queued' ? 'queued' : 'running')
      setPreparationProgress({
        percentage: task.progress?.percentage,
        phase: state.isPaused ? 'Review preparation paused' : task.progress?.phase ?? (task.status === 'queued' ? 'Waiting in task queue' : observer.fallbackPhase),
        currentItem: task.progress?.currentItem ?? task.label,
      })
      return
    }

    processedPreparationTaskId.current = task.id
    activePreparationRequestId.current = null
    activePreparationTaskId.current = null
    void (async () => {
      try {
        if (task.status === 'completed' && typeof task.result?.preflightId === 'string') {
          const saved = await window.electronAPI.getShowPreflight(task.result.preflightId) as SavedShowPreflight | undefined
          if (!saved) throw new Error('The saved optimization review could not be found')
          if (isMounted()) observer.onReviewLoaded(saved)
        } else if (isMounted()) {
          observer.onFailure(task.error ?? (task.status === 'cancelled' ? 'Review preparation was cancelled' : 'Optimization preflight failed'))
        }
      } catch (error) {
        if (isMounted()) observer.onFailure(error instanceof Error ? error.message : String(error))
      } finally {
        if (isMounted()) {
          observer.onActivity(false)
          setPreparationProgress(null)
          setPreparationState(null)
        }
      }
    })()
  }, [])

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
    queueState,
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
    preparationTermination,
    setPreparationTermination,
    preparationProgress,
    setPreparationProgress,
    preparationState,
    setPreparationState,
    activePreparationRequestId,
    activePreparationTaskId,
    rejectPreparation,
    preparationMovedToBackground,
    preparationStartedHere,
    batchSummary,
    reviewMatches,
    replaceReview,
    clearReview,
    submitBatch,
    appendSubmittedTasks,
    toggleQueuePause,
    retryFailedTasks,
    reconcilePreparationQueue,
  }), [stage, setStage, queueState, review, setReview, reviewedOptions, reviewedSampleGroups, batchId, submittedMediaItemIds, submittedTaskIds, queueControlState, preparationTermination, preparationProgress, preparationState, batchSummary, reviewMatches, replaceReview, clearReview, submitBatch, appendSubmittedTasks, toggleQueuePause, retryFailedTasks, reconcilePreparationQueue])
}
