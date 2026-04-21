import { Plus, Sparkles } from 'lucide-react'

interface EmptyDashboardProps {
  sourcesLength: number
  onAddSource?: () => void
}

export function EmptyDashboard({ sourcesLength, onAddSource }: EmptyDashboardProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
      {sourcesLength === 0 ? (
        <>
          <h2 className="text-xl font-medium mb-2">Add a Media Source</h2>
          <p className="text-muted-foreground max-w-md mb-6">Connect your media library to start tracking quality and completeness.</p>
          {onAddSource && (
            <button onClick={onAddSource} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">
              <Plus className="w-5 h-5" /> Add Source
            </button>
          )}
        </>
      ) : (
        <>
          <Sparkles className="w-16 h-16 text-accent/50 mb-4" />
          <h2 className="text-xl font-medium mb-2">All caught up!</h2>
          <p className="text-muted-foreground max-w-md">Your library is in great shape. No urgent upgrades needed and all your collections and series are complete.</p>
        </>
      )}
    </div>
  )
}
