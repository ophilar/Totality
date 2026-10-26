/**
 * TaskQueuePanel - Slide-out panel for task queue management.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  DndContext,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  X,
  Pause,
  Play,
  XCircle,
  Clock,
  Loader2,
  ListTodo,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { SortableQueueItem } from './SortableQueueItem'
import type { QueueState, QueuedTask } from '@main/types/taskQueue'

interface TaskQueuePanelProps {
  isOpen: boolean
  onClose: () => void
}

export function TaskQueuePanel({ isOpen, onClose }: TaskQueuePanelProps) {
  const [queueState, setQueueState] = useState<QueueState>({
    currentTask: null, queue: [], isPaused: false, completedTasks: [],
  })
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const pendingCount = queueState.queue.length + (queueState.currentTask ? 1 : 0)

  // Auto-focus close button when panel opens
  useEffect(() => {
    if (isOpen) setTimeout(() => closeButtonRef.current?.focus(), 100)
  }, [isOpen])

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.((state) => {
      setQueueState(state)
    })
    window.electronAPI.taskQueueGetState?.().then(setQueueState)
    return () => unsubscribe?.()
  }, [])

  const handlePauseResume = useCallback(() => {
    if (queueState.isPaused) window.electronAPI.taskQueueResume?.()
    else window.electronAPI.taskQueuePause?.()
  }, [queueState.isPaused])

  const handleCancelCurrent = useCallback(() => { window.electronAPI.taskQueueCancelCurrent?.() }, [])
  const handleRemoveTask = useCallback((taskId: string) => { window.electronAPI.taskQueueRemoveTask?.(taskId) }, [])
  const handleClearQueue = useCallback(() => { window.electronAPI.taskQueueClearQueue?.() }, [])
  const handleOpenPreflight = useCallback((task: QueuedTask) => {
    const options = task.options as { requestId?: string; mediaType?: string; request?: { seriesTitle?: string; seriesIdentityKey?: string; sourceId?: string; libraryId?: string; mediaItemId?: number; seasonNumber?: number } } | undefined
    const request = options?.request
    if (task.type !== 'optimization-preflight' || options?.mediaType === 'movie' || !options?.requestId || !request?.sourceId || !request.libraryId) return
    window.dispatchEvent(new CustomEvent('tvOptimization:returnToPreflight', {
      detail: {
        requestId: options.requestId,
        entity: {
          seriesTitle: request.seriesTitle,
          seriesIdentityKey: request.seriesIdentityKey,
          sourceId: request.sourceId,
          libraryId: request.libraryId,
          mediaItemId: request.mediaItemId,
          seasonNumber: request.seasonNumber,
        },
      },
    }))
    onClose()
  }, [onClose])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setQueueState((prev) => {
        const oldIndex = prev.queue.findIndex((t) => t.id === active.id)
        const newIndex = prev.queue.findIndex((t) => t.id === over.id)
        const newQueue = arrayMove(prev.queue, oldIndex, newIndex)
        window.electronAPI.taskQueueReorderQueue?.(newQueue.map((t) => t.id))
        return { ...prev, queue: newQueue }
      })
    }
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }, [onClose])

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 z-[45] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-[76px] bottom-4 right-4 w-80 bg-sidebar-gradient rounded-2xl shadow-xl z-[46] slide-panel flex flex-col overflow-hidden transition-opacity duration-200 ease-out ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onKeyDown={handleKeyDown}
        role="complementary"
        aria-label="Task Queue"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <ListTodo className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Task Queue</h2>
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded-full">
                {pendingCount}
              </span>
            )}
            {queueState.isPaused && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded-full">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handlePauseResume}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary"
              title={queueState.isPaused ? 'Resume queue' : 'Pause queue'}>
              {queueState.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button ref={closeButtonRef} onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary"
              aria-label="Close task queue panel" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Current Task */}
        {queueState.currentTask && (
          <div className="p-4 border-b border-border/30 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium">{queueState.currentTask.label}</span>
                {queueState.currentTask.status === 'cancelling' && <span className="text-xs text-muted-foreground">Cancelling…</span>}
              </div>
              <button onClick={handleCancelCurrent} disabled={queueState.currentTask.status === 'cancelling'}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400 disabled:opacity-50" title={queueState.currentTask.status === 'cancelling' ? 'Cancellation requested' : 'Cancel'}>
                <XCircle className="w-4 h-4" />
              </button>
            </div>
            {queueState.currentTask.type === 'optimization-preflight' && (queueState.currentTask.options as { mediaType?: string } | undefined)?.mediaType !== 'movie' && <button onClick={() => { if (queueState.currentTask) handleOpenPreflight(queueState.currentTask) }} className="mb-2 text-xs text-primary hover:underline">Open preflight</button>}
            {queueState.currentTask.progress && (
              <>
                <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5">
                  <div className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${queueState.currentTask.progress.percentage}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{queueState.currentTask.progress.currentItem || queueState.currentTask.progress.phase}</span>
                  <span>{Math.round(queueState.currentTask.progress.percentage)}%</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Queue */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/20 shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Queued {queueState.queue.length > 0 && `(${queueState.queue.length})`}
              </span>
            </div>
            {queueState.queue.length > 0 && (
              <button onClick={handleClearQueue} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Clear</button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {queueState.queue.length === 0 ? (
              <div className="py-8 text-center">
                <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Queue empty</p>
                <p className="text-xs text-muted-foreground/50 mt-1">Tasks will appear here when queued</p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
                <SortableContext items={queueState.queue.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className="divide-y divide-border/10">
                    {queueState.queue.map((task) => (
                      <SortableQueueItem key={task.id} task={task} onRemove={handleRemoveTask} onOpenPreflight={handleOpenPreflight} />
                    ))}
                  </div>
                  <p className="px-4 py-1.5 text-xs text-muted-foreground/60 italic border-t border-border/20">Drag to reorder</p>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* Recent completed tasks */}
        {queueState.completedTasks.length > 0 && (
          <div className="border-t border-border/30 max-h-40 overflow-y-auto">
            <div className="px-4 py-2 bg-muted/20">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent</span>
            </div>
            <div className="divide-y divide-border/10">
              {queueState.completedTasks.slice(0, 5).map((task) => (
                <div key={task.id} title={task.result?.errors?.join('\n')} className="flex items-center gap-2 px-4 py-2 text-muted-foreground/60">
                  {task.status === 'partial'
                    ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                    : <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${task.status === 'failed' ? 'text-red-400' : 'text-green-400'}`} />}
                  <span className="text-xs flex-1 truncate">{task.label}</span>
                  {task.status === 'failed' && <span className="text-[10px] text-red-400">Failed</span>}
                  {task.status === 'partial' && <span className="text-[10px] text-amber-400">{task.result?.failedCount} item failures</span>}
                  {task.type === 'optimization-preflight' && typeof task.result?.preflightId === 'string' && (
                    <button
                      className="text-xs text-primary hover:text-primary/80"
                      onClick={() => {
                        if (task.result?.mediaType === 'movie' && typeof task.result.mediaItemId === 'number') {
                          window.dispatchEvent(new CustomEvent('optimization:requestMovieReview', { detail: { preflightId: task.result.preflightId, mediaItemId: task.result.mediaItemId } }))
                        } else {
                          window.dispatchEvent(new CustomEvent('tvOptimization:requestReview', { detail: { preflightId: task.result?.preflightId } }))
                        }
                      }}
                    >Review</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
