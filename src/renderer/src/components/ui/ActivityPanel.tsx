/**
 * ActivityPanel - Task queue and monitoring activity panel
 *
 * Features:
 * - Current task progress display
 * - Queue management (reorder, remove, clear)
 * - Pause/resume queue
 * - Tabbed activity history (Tasks/Monitoring)
 */

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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  Bell,
  X,
  Pause,
  Play,
  XCircle,
  Clock,
  Loader2,
  Scaling,
} from 'lucide-react'
import { SortableQueueItem } from './SortableQueueItem'
import type { QueueState } from '@main/types/taskQueue'
import { getActiveThemeClass } from '../../contexts/ThemeContext'
import { useMenuClose } from '../../hooks/useMenuClose'
import { useNotifications } from '../../hooks/useNotifications'

// ============================================================================
// Types
// ============================================================================

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
// Main Component
// ============================================================================

export function ActivityPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [queueState, setQueueState] = useState<QueueState>({
    currentTask: null,
    queue: [],
    isPaused: false,
    completedTasks: [],
  })
  const { notifications, unreadCount, error: notificationError, markAllRead: handleMarkAllRead, markRead: handleMarkRead, clear: handleClearNotifications } = useNotifications({ limit: 50, isOpen, refreshIntervalMs: 10000 })

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

  const closePanel = useCallback(() => setIsOpen(false), [])
  const panelRef = useMenuClose({ isOpen, onClose: closePanel })
  const scrollRef = useRef<HTMLDivElement>(null)

  // Calculate total pending tasks (queue + current)
  const pendingCount = queueState.queue.length + (queueState.currentTask ? 1 : 0)

  // Get the active theme from the document root so the dropdown can override
  // the top bar's forced dark scoping and follow the user's chosen theme
  // ============================================================================
  // Effects
  // ============================================================================

  // Subscribe to task queue updates
  useEffect(() => {
    const unsubscribeQueue = window.electronAPI.onTaskQueueUpdated?.((state) => {
      setQueueState(state)
    })

    window.electronAPI.taskQueueGetState?.().then(setQueueState)

    return () => {
      unsubscribeQueue?.()
    }
  }, [])

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

  // dnd-kit drag handler
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setQueueState((prev) => {
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
    <div ref={panelRef} className="relative">
      {/* Activity Button */}
      <button
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
          <Bell className="w-5 h-5" />
        )}
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>

      {/* Activity Panel Dropdown */}
      <div
        className={`${getActiveThemeClass()} absolute right-0 top-full mt-2 bg-card rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden ${
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
        {queueState.currentTask && (
          <div className="p-4 border-b border-border/30 bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm font-medium">{queueState.currentTask.label}</span>
              </div>
              <button
                onClick={handleCancelCurrent}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-400"
                title="Cancel"
              >
                <XCircle className="w-4 h-4" />
              </button>
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
                  <span>
                    {queueState.currentTask.progress.currentItem ||
                      queueState.currentTask.progress.phase}
                  </span>
                  <span>{Math.round(queueState.currentTask.progress.percentage)}%</span>
                </div>
              </>
            )}
          </div>
        )}

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
                  items={queueState.queue.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="divide-y divide-border/10">
                    {queueState.queue.map((task) => (
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
            {notificationError && <p role="alert" className="px-2 py-2 text-xs text-destructive">Notification update failed: {notificationError}</p>}
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
                      n.isRead ? 'opacity-60 hover:opacity-80' : 'hover:bg-muted/30'
                    }`}
                    onClick={() => !n.isRead && handleMarkRead(n.id)}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${getNotificationIconColor(n.type)}`}>
                        {getNotificationIcon(n.type)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{n.title}</span>
                          {!n.isRead && <span className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" />}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <span className="text-[10px] text-muted-foreground/50 mt-0.5 block">
                          {new Date(n.createdAt).toLocaleString()}
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
