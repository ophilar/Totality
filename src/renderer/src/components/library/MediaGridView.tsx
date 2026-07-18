import { forwardRef, ReactNode, useRef, useCallback, useLayoutEffect } from 'react'
import { Virtuoso, VirtuosoGrid, VirtuosoHandle, VirtuosoGridHandle } from 'react-virtuoso'
import { RefreshCw } from 'lucide-react'
import { MediaCardSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { useScrollMemory } from '@/contexts/ScrollMemoryContext'

interface MediaGridViewProps<T> {
  /** The data to display */
  items: T[]
  /** Total number of items available (for infinite scroll) */
  totalCount: number
  /** Whether data is currently loading */
  loading?: boolean
  /** Callback to load more items */
  onLoadMore?: () => void
  /** 'grid' or 'list' layout */
  viewType: 'grid' | 'list'
  /** Minimum width of items in grid view (poster size) */
  posterMinWidth?: number
  /** Function to render an item in grid view */
  renderGridItem: (item: T, index: number) => ReactNode
  /** Function to render an item in list view */
  renderListItem: (item: T, index: number) => ReactNode
  /** Optional header row for list view */
  listHeader?: ReactNode
  /** Optional bar for stats and sorting */
  statsBar?: ReactNode
  /** UI to show when no items are found */
  emptyState: ReactNode
  /** Optional banner below the stats bar */
  banner?: ReactNode
  /** Unique key to persist scroll position */
  scrollKey?: string
}

/**
 * Generic Grid/List view component with virtual scrolling and infinite loading.
 * Unifies the UI logic for Movies, TV Shows, and Music views.
 * Handles its own scrolling via React Virtuoso for best performance.
 */
export function MediaGridView<T>({
  items,
  totalCount,
  loading,
  onLoadMore,
  viewType,
  posterMinWidth = 180,
  renderGridItem,
  renderListItem,
  listHeader,
  statsBar,
  emptyState,
  banner,
  scrollKey,
}: MediaGridViewProps<T>) {
  const { getScrollState, saveScrollState } = useScrollMemory()
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const virtuosoGridRef = useRef<VirtuosoGridHandle>(null)

  const restoredState = scrollKey ? getScrollState(scrollKey) : undefined

  // Persist scroll position for list view on unmount (Virtuoso has getState)
  useLayoutEffect(() => {
    return () => {
      if (scrollKey && viewType === 'list') {
        virtuosoRef.current?.getState(state => saveScrollState(scrollKey, state))
      }
    }
  }, [scrollKey, viewType, saveScrollState])

  // VirtuosoGrid uses the stateChanged prop for state capture
  const handleGridStateChanged = useCallback((state: any) => {
    if (scrollKey && viewType === 'grid') {
      saveScrollState(scrollKey, state)
    }
  }, [scrollKey, viewType, saveScrollState])

  if (items.length === 0) {
    if (loading) {
      return (
        <div className="h-full flex flex-col">
          {statsBar}
          <div className="flex-1 min-h-0 overflow-hidden">
            {viewType === 'list' ? (
              <div className="space-y-2 p-4">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 py-2 border-b border-border/10">
                    <Skeleton className="w-10 h-14 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/4" />
                      <Skeleton className="h-3 w-1/6" />
                    </div>
                    <Skeleton className="w-20 h-4" />
                    <Skeleton className="w-20 h-4" />
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="grid gap-8 p-4"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${posterMinWidth}px, 1fr))`
                }}
              >
                {[...Array(12)].map((_, i) => (
                  <MediaCardSkeleton key={i} />
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="h-full flex flex-col">
        {statsBar}
        {banner}
        <div className="flex-1 flex items-center justify-center">
          {emptyState}
        </div>
      </div>
    )
  }

  const Footer = () => (
    <div className="px-4 py-4 text-xs text-muted-foreground flex items-center gap-2">
      {loading && <RefreshCw className="w-3 h-3 animate-spin" />}
      <span>
        {items.length === totalCount
          ? `${totalCount.toLocaleString()} items`
          : `${items.length.toLocaleString()} of ${totalCount.toLocaleString()} items`}
      </span>
    </div>
  )

  const handleEndReached = () => {
    if (!loading && items.length < totalCount && onLoadMore) {
      onLoadMore()
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {statsBar}
      {banner}
      
      {viewType === 'list' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {listHeader}
          <div className="flex-1 min-h-0 relative">
            <Virtuoso
              ref={virtuosoRef}
              restoreStateFrom={restoredState}
              data={items}
              endReached={handleEndReached}
              overscan={1200}
              style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0 }}
              itemContent={(index, item) => (
                <div className="pb-2">
                  {renderListItem(item, index)}
                </div>
              )}
              components={{ Footer }}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <VirtuosoGrid
            ref={virtuosoGridRef}
            restoreStateFrom={restoredState as any}
            stateChanged={handleGridStateChanged}
            data={items}
            endReached={handleEndReached}
            overscan={1500}
            style={{ height: '100%', width: '100%', position: 'absolute', top: 0, left: 0 }}
            components={{
              List: forwardRef<HTMLDivElement, any>((props, ref) => (
                <div
                  {...props}
                  ref={ref}
                  className="grid gap-8 pb-4"
                  style={{
                    ...props.style,
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fill, minmax(${posterMinWidth}px, 1fr))`
                  }}
                />
              )),
              Footer
            }}
            itemContent={(index, item) => renderGridItem(item, index)}
          />
        </div>
      )}
    </div>
  )
}
