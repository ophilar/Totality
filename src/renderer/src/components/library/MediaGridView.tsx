
import { forwardRef, ReactNode } from 'react'
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso'
import { RefreshCw } from 'lucide-react'
import { MediaCardSkeleton, Skeleton } from '../ui/Skeleton'

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
  /** Optional scroll parent element */
  scrollElement?: HTMLElement | null
}

/**
 * Generic Grid/List view component with virtual scrolling and infinite loading.
 * Unifies the UI logic for Movies, TV Shows, and Music views.
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
  scrollElement,
}: MediaGridViewProps<T>) {
  
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
    <div className="h-full flex flex-col">
      {statsBar}
      {banner}
      
      {viewType === 'list' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {listHeader}
          <div className="flex-1 min-h-0">
            <Virtuoso
              customScrollParent={scrollElement || undefined}
              data={items}
              endReached={handleEndReached}
              overscan={800}
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
        <div className="flex-1 min-h-0">
          <VirtuosoGrid
            customScrollParent={scrollElement || undefined}
            data={items}
            endReached={handleEndReached}
            overscan={800}
            components={{
              List: forwardRef((props, ref) => (
                <div
                  {...props}
                  ref={ref as any}
                  className="grid gap-8"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${posterMinWidth}px, 1fr))`
                  }}
                />
              )),
              Item: ({ children, ...props }) => (
                <div {...props}>{children}</div>
              ),
              Footer
            }}
            itemContent={(index, item) => renderGridItem(item, index)}
          />
        </div>
      )}
    </div>
  )
}
