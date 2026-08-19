import { TaskType } from '@main/types/database'
import type { QueuedTask, TaskQueueState } from '@main/types/database'
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
  Bell,
  X,
  Pause,
  Play,
  GripVertical,
  XCircle,
  Clock,
  Loader2,
  Scaling,
  Activity,
  Zap,
  Gauge
} from 'lucide-react'

// ============================================================================
// Component
// ============================================================================

// Default and min/max dimensions for resizable panel
const DEFAULT_WIDTH = 450
const DEFAULT_HEIGHT = 500
const MIN_WIDTH = 350
const MIN_HEIGHT = 300
const MAX_WIDTH = 700
const MAX_HEIGHT = 800

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

interface AppNotification {
  id: number
  type: string
  title: string
  message: string
  reference_id?: string
  is_read: boolean
  created_at: string
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
  const [unreadCount, setUnreadCount] = useState(0)
  const [showTelemetry, setShowTelemetry] = useState(true)

  // Configure dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Resize state
  const [panelSize, setPanelSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef({ x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })

  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Calculate total pending tasks (queue + current)
  const pendingCount = queueState.queue.length + (queueState.currentTask ? 1 : 0)

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

  // Load notifications
  const loadNotifications = useCallback(async () => {
    try {
      const [items, counts] = await Promise.all([
        window.electronAPI.notificationsGetAll({ limit: 50 }),
        window.electronAPI.notificationsGetCount(),
      ])
        setNotifications(items)
      setUnreadCount(counts.unread)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    // Wrap in Promise.resolve().then() to avoid "set-state-in-effect" cascading render warning
    void Promise.resolve().then(() => {
      loadNotifications()
    })

    // Refresh notifications periodically when panel is open
    if (isOpen) {
      const interval = setInterval(loadNotifications, 10000)
      return () => clearInterval(interval)
    }
  }, [isOpen, loadNotifications])

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

  // Resize handlers - using requestAnimationFrame for smooth updates
  useEffect(() => {
    if (!isResizing) return

    let animationFrameId: number

    const handleMouseMove = (e: MouseEvent) => {
      // Cancel any pending animation frame
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }

      // Use requestAnimationFrame for smooth updates
      animationFrameId = requestAnimationFrame(() => {
        const deltaX = resizeStartRef.current.x - e.clientX // Inverted for bottom-left resize
        const deltaY = e.clientY - resizeStartRef.current.y

        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartRef.current.width + deltaX))
        const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartRef.current.height + deltaY))

        setPanelSize({ width: newWidth, height: newHeight })
      })
    }

    const handleMouseUp = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
    }
    setIsResizing(true)
  }, [panelSize])

  // ============================================================================
  // Handlers
  // ============================================================================

  const handlePauseResume = useCallback(() => {
    if (queueState.isPaused) {
      window.electronAPI.taskQueueResume?.()
    } else {
      window.electronAPI.taskQueuePause?.()
    }
  }, [queueState.isPaused])

  const handleCancelCurrent = useCallback(() => {
    window.electronAPI.taskQueueCancelCurrent?.()
  }, [])

  const handleRemoveTask = useCallback((taskId: string) => {
    window.electronAPI.taskQueueRemoveTask?.(taskId)
  }, [])

  const handleClearQueue = useCallback(() => {
    window.electronAPI.taskQueueClearQueue?.()
  }, [])

  const handleMarkAllRead = useCallback(async () => {
    await window.electronAPI.notificationsMarkAllRead()
    loadNotifications()
  }, [loadNotifications])

  const handleMarkRead = useCallback(async (id: number) => {
    await window.electronAPI.notificationsMarkRead([id])
    loadNotifications()
  }, [loadNotifications])

  const handleClearNotifications = useCallback(async () => {
    await window.electronAPI.notificationsClear()
    loadNotifications()
  }, [loadNotifications])

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
  // Helpers
  // ============================================================================

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'scan_complete': return '✓'
      case 'source_change': return '↻'
      case 'error': return '!'
      default: return 'i'
    }
  }

  const getNotificationIconColor = (type: string) => {
    switch (type) {
      case 'scan_complete': return 'bg-green-500/20 text-green-400'
      case 'source_change': return 'bg-blue-500/20 text-blue-400'
      case 'error': return 'bg-red-500/20 text-red-400'
      default: return 'bg-muted text-muted-foreground'
    }
  }

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

      {/* Activity Panel Dropdown */}
      <div
        ref={dropdownRef}
        className={`${getActiveTheme()} absolute right-0 top-full mt-2 bg-card rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden ${
          isResizing ? 'select-none' : 'transition-all duration-300 ease-out'
        } ${
          isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'
        }`}
        style={{
          width: panelSize.width,
          height: panelSize.height,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 12px 24px -8px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Resize Handle - Bottom Left Corner */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-2.5 left-2.5 cursor-sw-resize z-10 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <Scaling className="w-4 h-4 rotate-180" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Activity</h3>
            {queueState.isPaused && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded-full">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handlePauseResume}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title={queueState.isPaused ? 'Resume queue' : 'Pause queue'}
            >
              {queueState.isPaused ? (
                <Play className="w-4 h-4" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Current Task */}
        {queueState.currentTask && (() => {
          const isTranscodeTask = queueState.currentTask.type === TaskType.Transcode || 
            queueState.currentTask.label.toLowerCase().includes('transcode') || 
            queueState.currentTask.label.toLowerCase().includes('optimize') ||
            queueState.currentTask.progress?.fps !== undefined

          return (
            <div className="p-4 border-b border-border/30 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  <span className="text-sm font-medium truncate">{queueState.currentTask.label}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isTranscodeTask && (
                    <button
                      onClick={() => setShowTelemetry(!showTelemetry)}
                      className={`p-1.5 rounded transition-colors ${
                        showTelemetry ? 'bg-primary/20 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                      title={showTelemetry ? 'Hide Live Telemetry' : 'Show Live Telemetry'}
                      aria-label="Toggle Live Telemetry"
                    >
                      <Activity className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={handleCancelCurrent}
                    className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400"
                    title="Cancel Task"
                    aria-label="Cancel Task"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {queueState.currentTask.progress && (
                <>
                  <div className="h-2 bg-muted rounded-full overflow-hidden mb-1.5">
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

                  {/* Live Transcoding Telemetry expansion */}
                  {showTelemetry && isTranscodeTask && (
                    <div className="mt-3 pt-3 border-t border-border/20 grid grid-cols-3 gap-2 text-center animate-in fade-in duration-200">
                      <div className="bg-background/80 p-2 rounded-xl border border-border/30">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-center gap-1">
                          <Gauge className="w-3 h-3 text-primary" /> Framerate
                        </div>
                        <div className="text-xs font-bold text-primary mt-0.5">
                          {queueState.currentTask.progress.fps ? `${queueState.currentTask.progress.fps} FPS` : 'Encoding'}
                        </div>
                      </div>
                      <div className="bg-background/80 p-2 rounded-xl border border-border/30">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-center gap-1">
                          <Zap className="w-3 h-3 text-yellow-400" /> Speed
                        </div>
                        <div className="text-xs font-bold text-foreground mt-0.5">
                          {queueState.currentTask.progress.fps ? `${(queueState.currentTask.progress.fps / 24).toFixed(1)}x` : '1.0x'}
                        </div>
                      </div>
                      <div className="bg-background/80 p-2 rounded-xl border border-border/30">
                        <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-center gap-1">
                          <Clock className="w-3 h-3 text-blue-400" /> ETA
                        </div>
                        <div className="text-xs font-bold text-foreground mt-0.5 truncate">
                          {queueState.currentTask.progress.eta || 'Calculating...'}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })()}

        {/* Queue - grows with panel resize */}
        <div className="flex-1 min-h-0 flex flex-col border-b border-border/30">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/20 shrink-0">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Queue {queueState.queue.length > 0 && `(${queueState.queue.length})`}
              </span>
            </div>
            {queueState.queue.length > 0 && (
              <button
                onClick={handleClearQueue}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {queueState.queue.length === 0 ? (
              <div className="py-6 text-center">
                <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Queue empty</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Tasks will appear here when queued
                </p>
              </div>
            ) : (
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
                  <p className="px-4 py-1.5 text-xs text-muted-foreground/60 italic border-t border-border/20">
                    Drag to reorder
                  </p>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        {/* Notifications Section */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/20 shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Notifications {unreadCount > 0 && `(${unreadCount})`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={handleClearNotifications}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pb-6 p-2">
            {notifications.length === 0 ? (
              <div className="py-6 text-center">
                <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No notifications</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Scan completions and library changes will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`py-2 px-2 rounded-lg cursor-pointer transition-colors ${
                      n.is_read ? 'opacity-60 hover:opacity-80' : 'hover:bg-muted/30'
                    }`}
                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${getNotificationIconColor(n.type)}`}>
                        {getNotificationIcon(n.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{n.title}</span>
                          {!n.is_read && <span className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <span className="text-[10px] text-muted-foreground/50 mt-0.5 block">
                            {new Date(n.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
