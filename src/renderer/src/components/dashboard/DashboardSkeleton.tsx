import { CircleFadingArrowUp, Film, Tv, Music } from 'lucide-react'
import { DashboardRowSkeleton } from '@/components/ui/Skeleton'

export function DashboardSkeleton({ hasMovies, hasTV, hasMusic }: { hasMovies: boolean, hasTV: boolean, hasMusic: boolean }) {
  const renderSkeletons = (count = 6) => (
    <div className="space-y-1">
      {[...Array(count)].map((_, i) => (
        <DashboardRowSkeleton key={i} />
      ))}
    </div>
  )

  return (
    <div className="flex-1 flex gap-4 px-4 pb-4 overflow-x-auto overflow-y-hidden animate-in fade-in duration-500">
      {/* Upgrades Skeleton */}
      <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden opacity-60">
        <div className="shrink-0 p-4 border-b border-border/30 flex items-center gap-2">
          <CircleFadingArrowUp className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upgrades</h2>
        </div>
        <div className="flex-1 min-h-0 p-2">{renderSkeletons(8)}</div>
      </div>

      {/* Collections Skeleton */}
      {hasMovies && (
        <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden opacity-60">
          <div className="shrink-0 p-4 border-b border-border/30 flex items-center gap-2">
            <Film className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Collections</h2>
          </div>
          <div className="flex-1 min-h-0 p-2">{renderSkeletons(6)}</div>
        </div>
      )}

      {/* Series Skeleton */}
      {hasTV && (
        <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden opacity-60">
          <div className="shrink-0 p-4 border-b border-border/30 flex items-center gap-2">
            <Tv className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">TV Series</h2>
          </div>
          <div className="flex-1 min-h-0 p-2">{renderSkeletons(6)}</div>
        </div>
      )}

      {/* Music Skeleton */}
      {hasMusic && !hasMovies && !hasTV && (
        <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden opacity-60">
          <div className="shrink-0 p-4 border-b border-border/30 flex items-center gap-2">
            <Music className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Music</h2>
          </div>
          <div className="flex-1 min-h-0 p-2">{renderSkeletons(6)}</div>
        </div>
      )}
    </div>
  )
}
