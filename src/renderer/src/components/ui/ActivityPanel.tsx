import { TaskType, type QueuedTask, type TaskQueueState } from '@main/types/database'
import type { ActivityOperation } from '@main/ipc/utils/OperationRequestRegistry'
import { useState, useRef, useEffect, useCallback } from 'react'
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  TowerControl,
  X,
  GripVertical,
  Loader2,
} from 'lucide-react'

interface AppNotification {
  id: number
  type: string
  title: string
  message: string
  is_read: boolean
  created_at: string
}

// ============================================================================
// Component
// ============================================================================

// Activity panel dimensions
const DEFAULT_WIDTH = 450
const DEFAULT_HEIGHT = 500

// ============================================================================
// Sortable Queue Item Component
// ============================================================================

function SortableQueueItem({
  task,
  onRemove,
}: {
  task: QueuedTask
  onRemove: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-4 py-2.5 ${isDragging ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
      {...attributes}
    >
      <GripVertical
        className={`w-4 h-4 shrink-0 cursor-grab active:cursor-grabbing transition-colors ${
          isDragging ? 'text-primary' : 'text-muted-foreground/50'
        }`}
        {...listeners}
      />
      <span className="text-sm flex-1 truncate">{task.label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove(task.id)
        }}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400 shrink-0"
        title="Remove"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function ActivityPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [queueState, setTaskQueueState] = useState<TaskQueueState>({
    currentTask: null,
    queue: [],
    isPaused: false,
    completedTasks: [],
  })
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [notificationError, setNotificationError] = useState<string | null>(null)
  const [doneActionError, setDoneActionError] = useState<string | null>(null)
  const [operations, setOperations] = useState<ActivityOperation[]>([])
  const [cancellationRequests, setCancellationRequests] = useState<Set<string>>(new Set())
  const [operationError, setOperationError] = useState<string | null>(null)
  const [resultText, setResultText] = useState<string | null>(null)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  const operationRevision = useRef(-1)
  // Configure dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Calculate total pending tasks (queue + current)
  const pendingCount = queueState.queue.length + (queueState.currentTask ? 1 : 0) + operations.filter(operation => ['running', 'cancelling', 'finishing'].includes(operation.state)).length

  // Get the active theme from the document root so the dropdown can override
  // the top bar's forced dark scoping and follow the user's chosen theme
  const getActiveTheme = () => {
    const themes = [
      'frost',
      'slate-light', 'ember-light', 'midnight-light',
      'velvet-light', 'emerald-light', 'cobalt-light', 'carbon-light',
      'slate', 'ember', 'midnight', 'oled', 'velvet', 'emerald', 'cobalt', 'carbon', 'dark',
    ]
    for (const theme of themes) {
      if (document.documentElement.classList.contains(theme)) return theme
    }
    return 'dark'
  }

  // ============================================================================
  // Effects
  // ============================================================================

  // Subscribe to task queue updates
  useEffect(() => {
    const unsubscribeQueue = window.electronAPI.onTaskQueueUpdated?.((state) => {
      setTaskQueueState(state as unknown as TaskQueueState)
    })

    window.electronAPI.taskQueueGetState?.().then(setTaskQueueState)

    return () => {
      unsubscribeQueue?.()
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      return () => document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleCancelCurrent = useCallback(async () => {
    const task = queueState.currentTask
    if (!task) return
    setTaskActionError(null)
    try {
      await window.electronAPI.taskQueueCancelTask?.(task.id)
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : String(error))
    }
  }, [queueState.currentTask])

  const handleRemoveTask = useCallback((taskId: string) => {
    window.electronAPI.taskQueueRemoveTask?.(taskId)
  }, [])

  const handleClearQueue = useCallback(async () => {
    setTaskActionError(null)
    try {
      await window.electronAPI.taskQueueClearQueue(undefined, false)
    } catch (error) {
      setTaskActionError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await window.electronAPI.notificationsGetAll({ limit: 50 }))
      setNotificationError(null)
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void loadNotifications()
    if (!isOpen) return
    const interval = setInterval(loadNotifications, 10000)
    return () => clearInterval(interval)
  }, [isOpen, loadNotifications])

  const handleClearPast = useCallback(async () => {
    setDoneActionError(null)
    try {
      await Promise.all([
        window.electronAPI.notificationsClear(),
        window.electronAPI.taskQueueClearTaskHistory(),
      ])
      await loadNotifications()
    } catch (error) {
      setDoneActionError(error instanceof Error ? error.message : String(error))
    }
  }, [loadNotifications])

  useEffect(() => {
    const applySnapshot = (snapshot: { revision: number; operations: ActivityOperation[] }) => {
      if (snapshot.revision <= operationRevision.current) return
      operationRevision.current = snapshot.revision
      setOperations(snapshot.operations)
      setCancellationRequests(previous => new Set([...previous].filter(requestId =>
        snapshot.operations.some(operation => operation.requestId === requestId && operation.state === 'cancelling')
      )))
      setOperationError(null)
    }
    const unsubscribe = window.electronAPI.onOperationsUpdated(applySnapshot)
    void window.electronAPI.operationsGetActivity().then(applySnapshot).catch(error => {
      setOperationError(error instanceof Error ? error.message : String(error))
    })
    const openActivity = () => setIsOpen(true)
    window.addEventListener('operations:openActivity', openActivity)
    return () => {
      unsubscribe()
      window.removeEventListener('operations:openActivity', openActivity)
    }
  }, [])

  // dnd-kit drag handler
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setTaskQueueState((prev) => {
        const oldIndex = prev.queue.findIndex((t) => t.id === active.id)
        const newIndex = prev.queue.findIndex((t) => t.id === over.id)
        const newQueue = arrayMove(prev.queue, oldIndex, newIndex)

        // Commit to service
        window.electronAPI.taskQueueReorderQueue?.(newQueue.map((t) => t.id))

        return { ...prev, queue: newQueue }
      })
    }
  }, [])

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="relative">
      {/* Activity Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-md transition-colors shrink-0 focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-black ${
          isOpen
            ? 'bg-primary text-primary-foreground'
            : 'text-white hover:bg-white/10'
        }`}
        aria-label="Activity Panel"
        aria-expanded={isOpen}
      >
        {queueState.currentTask ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <TowerControl className="w-5 h-5" />
        )}
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>

      {/* Activity Panel */}
      <div
        ref={dropdownRef}
        className={`${getActiveTheme()} absolute right-0 top-full mt-2 bg-card rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden transition-all duration-300 ease-out ${
          isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        }`}
        style={{
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 12px 24px -8px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <h3 className="text-sm font-semibold">Activity</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
        <section className="shrink-0 border-b border-border/30">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">In progress</h4>
            {queueState.currentTask && queueState.currentTask.status !== 'cancelling' && <button type="button" onClick={handleCancelCurrent} className="text-xs text-muted-foreground hover:text-destructive">Cancel</button>}
          </div>

        {queueState.currentTask && <div className="px-4 py-3" role="status" aria-live="polite" aria-label="Current task progress">
              <div className="mb-2 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <span className="text-sm font-medium truncate">{queueState.currentTask.status === 'cancelling' ? 'Cancelling…' : `${queueState.currentTask.label}${queueState.currentTask.type === TaskType.Analysis && queueState.currentTask.progress?.phase ? ` · ${queueState.currentTask.progress.phase}` : ''}`}</span>
              </div>
              {queueState.currentTask.progress && (
                <>
                  <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5" role="progressbar" aria-label={`${queueState.currentTask.label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(queueState.currentTask.progress.percentage)}>
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${queueState.currentTask.progress.percentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate max-w-[280px]">
                      {queueState.currentTask.progress.currentItem ||
                        queueState.currentTask.progress.phase}
                    </span>
                    <span className="font-medium shrink-0">{Math.round(queueState.currentTask.progress.percentage)}%</span>
                  </div>

                </>
              )}
            </div>}
        {!queueState.currentTask && operations.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">Nothing in progress</p>}
        {operations.map(operation => <div key={operation.requestId} className="border-t border-border/20 px-4 py-3 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{operation.label}</p>
                {operation.context && <p className="text-xs text-muted-foreground">{operation.context}</p>}
                <p className="text-xs text-muted-foreground" role="status">
                  {operation.state === 'cancelling' || cancellationRequests.has(operation.requestId) ? 'Cancelling…' : operation.state === 'finishing' ? 'Finishing…' : operation.outcome?.message ?? operation.phase ?? 'In progress'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {operation.outcome?.hasResult && <button type="button" onClick={async () => {
                  try {
                    const result = await window.electronAPI.operationsGetResult(operation.requestId)
                    setResultText(typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? '')
                    setOperationError(null)
                  } catch (error) {
                    setOperationError(error instanceof Error ? error.message : String(error))
                  }
                }} className="text-xs text-primary hover:underline">View result</button>}
                {operation.state === 'running' && !cancellationRequests.has(operation.requestId) && <button type="button" onClick={async () => {
                  setCancellationRequests(previous => new Set(previous).add(operation.requestId))
                  try {
                    const result = await window.electronAPI.dbCancelOperation(operation.requestId)
                    if (result.status !== 'cancelling') {
                      setCancellationRequests(previous => {
                        const next = new Set(previous)
                        next.delete(operation.requestId)
                        return next
                      })
                    }
                    setOperationError(null)
                  } catch (error) {
                    setCancellationRequests(previous => {
                      const next = new Set(previous)
                      next.delete(operation.requestId)
                      return next
                    })
                    setOperationError(error instanceof Error ? error.message : String(error))
                  }
                }} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                  {operation.kind === 'sonarr-wait' ? 'Stop waiting' : 'Cancel'}
                </button>}
                {operation.outcome && <button type="button" onClick={async () => {
                  try {
                    await window.electronAPI.operationsDismiss(operation.requestId)
                    setOperationError(null)
                  } catch (error) {
                    setOperationError(error instanceof Error ? error.message : String(error))
                  }
                }} title="Dismiss" aria-label={`Dismiss ${operation.label}`} className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
              </div>
            </div>
            {operation.kind === 'sonarr-wait' && operation.state === 'running' && <p className="text-[11px] text-muted-foreground">The accepted command continues on Sonarr.</p>}
            {operation.progress && <>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${operation.progress.percentage}%` }} /></div>
              <p className="text-right text-[11px] text-muted-foreground">{Math.round(operation.progress.percentage)}% {operation.progress.currentItem}</p>
            </>}
          </div>)}
        {operationError && <p className="border-b border-border/30 px-4 py-2 text-xs text-destructive" role="alert">Could not load background activity: {operationError}</p>}
        {taskActionError && <p className="px-4 py-2 text-xs text-destructive" role="alert">Could not update tasks: {taskActionError}</p>}
        </section>
        {resultText !== null && <div className="absolute inset-10 z-20 flex min-h-0 flex-col rounded-lg border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm font-medium"><span>Operation result</span><button type="button" onClick={() => setResultText(null)} aria-label="Close result"><X className="h-4 w-4" /></button></div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-xs">{resultText}</pre>
        </div>}

        <section className="shrink-0 border-b border-border/30">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Up next</h4>
            {queueState.queue.length > 0 && <button type="button" onClick={() => void handleClearQueue()} className="text-xs text-muted-foreground hover:text-destructive">Cancel all</button>}
          </div>
          {queueState.queue.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={queueState.queue.map((t: QueuedTask) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="divide-y divide-border/10">
                    {queueState.queue.map((task: QueuedTask) => (
                      <SortableQueueItem
                        key={task.id}
                        task={task}
                        onRemove={handleRemoveTask}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
          ) : <p className="px-4 py-3 text-sm text-muted-foreground">Nothing queued</p>}
        </section>

        <section className="shrink-0">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/20">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Done</h4>
            <button type="button" onClick={() => void handleClearPast()} className="text-xs text-muted-foreground hover:text-foreground">Clear all</button>
          </div>
          {doneActionError && <p className="px-4 py-2 text-xs text-destructive" role="alert">Could not clear completed activity: {doneActionError}</p>}
          {notificationError ? <div className="px-4 py-3 text-sm text-destructive" role="alert">
            <span>Could not load completed activity: {notificationError}</span>
            <button type="button" onClick={() => void loadNotifications()} className="ml-2 underline">Retry</button>
          </div> : notifications.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Nothing completed yet</p> : <div className="divide-y divide-border/20">
            {notifications.map(notification => <div key={notification.id} className="flex items-start gap-2 px-4 py-2.5">
              <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${notification.type === 'scan_complete' ? 'bg-green-500/20 text-green-400' : notification.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-muted text-muted-foreground'}`}>
                {notification.type === 'scan_complete' ? '✓' : notification.type === 'error' ? '!' : '·'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{notification.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{notification.message}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/60">{new Date(notification.created_at).toLocaleString()}</p>
              </div>
            </div>)}
          </div>}
        </section>
        </div>
      </div>
    </div>
  )
}
