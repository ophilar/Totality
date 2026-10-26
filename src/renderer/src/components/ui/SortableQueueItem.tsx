import { ArrowUpRight, GripVertical, X } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { QueuedTask } from '@main/types/taskQueue'

interface SortableQueueItemProps {
  task: QueuedTask
  onRemove: (id: string) => void
  onOpenPreflight?: (task: QueuedTask) => void
}

export function SortableQueueItem({ task, onRemove, onOpenPreflight }: SortableQueueItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`flex items-center gap-2 px-4 py-2.5 ${isDragging ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
      {...attributes}
    >
      <GripVertical
        className={`w-4 h-4 shrink-0 cursor-grab active:cursor-grabbing transition-colors ${isDragging ? 'text-primary' : 'text-muted-foreground/50'}`}
        {...listeners}
      />
      <span className="text-sm flex-1 truncate">{task.label}</span>
      {task.type === 'optimization-preflight' && (task.options as { mediaType?: string } | undefined)?.mediaType !== 'movie' && onOpenPreflight && <button
        onClick={event => { event.stopPropagation(); onOpenPreflight(task) }}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-primary shrink-0"
        title="Open preflight"
      ><ArrowUpRight className="w-3.5 h-3.5" /></button>}
      <button
        onClick={event => {
          event.stopPropagation()
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
