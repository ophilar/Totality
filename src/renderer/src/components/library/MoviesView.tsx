import { useState, useMemo, useCallback, memo, useRef, forwardRef } from 'react'
import { Layers, RefreshCw, MoreVertical, Pencil, CircleFadingArrowUp, EyeOff, Trash2, HardDrive, Zap } from 'lucide-react'
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso'
import { QualityBadges } from './QualityBadges'
import { SlimDownBanner } from './SlimDownBanner'
import { ConversionRecommendation } from './ConversionRecommendation'
import { MoviePlaceholder } from '../ui/MediaPlaceholders'
import { useMenuClose } from '../../hooks/useMenuClose'
import { providerColors } from './mediaUtils'
import type { MediaItem, MovieCollectionData } from './types'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Display item type for grouped movies view
type MovieDisplayItem =
  | { type: 'collection'; collection: MovieCollectionData }
  | { type: 'movie'; movie: MediaItem }

export function MoviesView({
  movies,
  sortBy,
  onSortChange,
  slimDown,
  onSelectMovie,
  onSelectCollection,
  viewType,
  gridScale,
  getCollectionForMovie,
  movieCollections,
  showSourceBadge,
  onFixMatch,
  onRescan,
  onDismissUpgrade,
  totalMovieCount,
  moviesLoading,
  onLoadMoreMovies,
  collectionsOnly = false,
  scrollElement
}: {
  movies: MediaItem[]
  sortBy: 'title' | 'efficiency' | 'waste' | 'size'
  onSortChange: (sort: 'title' | 'efficiency' | 'waste' | 'size') => void
  slimDown: boolean
  onSelectMovie: (id: number, movie: MediaItem) => void
  onSelectCollection: (collection: MovieCollectionData) => void
  viewType: 'grid' | 'list'
  gridScale: number
  getCollectionForMovie: (movie: MediaItem) => MovieCollectionData | undefined
  movieCollections: MovieCollectionData[]
  showSourceBadge: boolean
  onFixMatch?: (mediaItemId: number, title: string, year?: number, filePath?: string) => void
  onRescan?: (mediaItemId: number, sourceId: string, libraryId: string | null, filePath: string) => Promise<void>
  onDismissUpgrade?: (movie: MediaItem) => void
  totalMovieCount: number
  moviesLoading: boolean
  onLoadMoreMovies: () => void
  collectionsOnly?: boolean
  scrollElement?: HTMLElement | null
}) {
  const [expandedRecommendations, setExpandedRecommendations] = useState<Set<number>>(new Set())

  const toggleRecommendation = useCallback((id: number) => {
    setExpandedRecommendations(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  // Map scale to minimum poster width (1=smallest, 7=largest)
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120,  // Smallest posters
      2: 140,
      3: 160,
      4: 180,
      5: 200,  // Default
      6: 240,
      7: 300   // Largest posters
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Group movies by collection - show collections as single items
  const displayItems = useMemo<MovieDisplayItem[]>(() => {
    // Build a set of movie IDs that belong to collections
    const moviesInCollections = new Set<number>()
    const collectionMovieMap = new Map<string, MediaItem[]>()

    // Find which movies belong to which collection
    for (const movie of movies) {
      const collection = getCollectionForMovie(movie)
      if (collection) {
        moviesInCollections.add(movie.id)
        const existing = collectionMovieMap.get(collection.tmdb_collection_id) || []
        existing.push(movie)
        collectionMovieMap.set(collection.tmdb_collection_id, existing)
      }
    }

    // Build display items
    const items: MovieDisplayItem[] = []

    // Add collections (only those that have at least one movie in current filtered view)
    const addedCollections = new Set<string>()
    for (const collection of movieCollections) {
      if (collectionMovieMap.has(collection.tmdb_collection_id) && !addedCollections.has(collection.tmdb_collection_id)) {
        items.push({ type: 'collection', collection })
        addedCollections.add(collection.tmdb_collection_id)
      }
    }

    // Add individual movies not in any collection (unless collections-only filter is active)
    if (!collectionsOnly) {
      for (const movie of movies) {
        if (!moviesInCollections.has(movie.id)) {
          items.push({ type: 'movie', movie })
        }
      }
    }

    // Sort all items alphabetically together (collections and movies interleaved)
    items.sort((a, b) => {
      if (sortBy === 'efficiency') {
        const effA = a.type === 'movie' ? (a.movie.efficiency_score ?? 100) : 100
        const effB = b.type === 'movie' ? (b.movie.efficiency_score ?? 100) : 100
        if (effA !== effB) return effA - effB // Low efficiency first
      } else if (sortBy === 'waste') {
        const wasteA = a.type === 'movie' ? (a.movie.storage_debt_bytes ?? 0) : 0
        const wasteB = b.type === 'movie' ? (b.movie.storage_debt_bytes ?? 0) : 0
        if (wasteA !== wasteB) return wasteB - wasteA // High waste first
      } else if (sortBy === 'size') {
        const sizeA = a.type === 'movie' ? (a.movie.file_size ?? 0) : 0
        const sizeB = b.type === 'movie' ? (b.movie.file_size ?? 0) : 0
        if (sizeA !== sizeB) return sizeB - sizeA // Largest first
      }

      const titleA = a.type === 'collection' ? a.collection.collection_name : a.movie.title
      const titleB = b.type === 'collection' ? b.collection.collection_name : b.movie.title
      return titleA.localeCompare(titleB)
    })

    return items
  }, [movies, movieCollections, getCollectionForMovie, collectionsOnly, sortBy])

  if (displayItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <MoviePlaceholder className="w-20 h-20 text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-lg">No movies found</p>
        <p className="text-sm text-muted-foreground mt-2">
          Scan a movie library from the sidebar to get started
        </p>
      </div>
    )
  }

  const statsBar = (
    <div className="flex items-center justify-between pb-4">
      <div className="flex items-center gap-6 text-sm text-muted-foreground">
        <span>{totalMovieCount.toLocaleString()} Movies</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Sort by:</span>
        <div className="flex gap-1">
          <button
            onClick={() => onSortChange('title')}
            className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'title' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
          >
            Title
          </button>
          <button
            onClick={() => onSortChange('efficiency')}
            className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'efficiency' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
          >
            Efficiency
          </button>
          <button
            onClick={() => onSortChange('waste')}
            className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'waste' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
          >
            Waste
          </button>
          <button
            onClick={() => onSortChange('size')}
            className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'size' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
          >
            Size
          </button>
        </div>
      </div>
    </div>
  )

  const Footer = () => (
    <div className="px-4 py-4 text-xs text-muted-foreground flex items-center gap-2">
      {moviesLoading && <RefreshCw className="w-3 h-3 animate-spin" />}
      <span>
        {movies.length === totalMovieCount
          ? `${totalMovieCount.toLocaleString()} movies`
          : `${movies.length.toLocaleString()} of ${totalMovieCount.toLocaleString()} movies`}
      </span>
    </div>
  )

  const isSlimDownActive = slimDown || sortBy === 'efficiency' || sortBy === 'waste' || sortBy === 'size'

  if (viewType === 'list') {
    return (
      <div className="h-full flex flex-col">
        {statsBar}
        {isSlimDownActive && <SlimDownBanner className="mb-4" />}
        <div className="grid grid-cols-[1fr_80px_100px_100px_120px_120px_100px_80px_40px] gap-4 px-4 py-2 mb-2 border-b border-border/50 text-xs font-medium text-muted-foreground bg-muted/10 sticky top-0 z-10">
          <div>Title</div>
          <div className="text-center">Year</div>
          <div>Resolution</div>
          <div>Video Codec</div>
          <div className="text-right">Bitrate</div>
          <div className="text-right">File Size</div>
          <div className="text-center">Efficiency</div>
          <div className="text-right">Debt</div>
          <div className="text-center"></div>
        </div>
        <div className="flex-1 min-h-0">
          <Virtuoso
            customScrollParent={scrollElement || undefined}
            data={displayItems}
            endReached={() => {
              if (!moviesLoading && movies.length < totalMovieCount) {
                onLoadMoreMovies()
              }
            }}
            overscan={800}
            itemContent={(_index, item) => {
              if (item.type === 'collection') {
                return (
                  <div className="pb-2" data-title={item.collection.collection_name}>
                    <CollectionListItem
                      collection={item.collection}
                      onClick={() => onSelectCollection(item.collection)}
                    />
                  </div>
                )
              }
              return (
                <div className="pb-2" data-title={item.movie.title}>
                  <MovieListItem
                    movie={item.movie}
                    onClick={() => onSelectMovie(item.movie.id, item.movie)}
                    showSourceBadge={showSourceBadge}
                    collectionData={getCollectionForMovie(item.movie)}
                    onFixMatch={onFixMatch ? () => onFixMatch(item.movie.id, item.movie.title, item.movie.year, item.movie.file_path) : undefined}
                    onRescan={onRescan && item.movie.source_id && item.movie.file_path ? () => onRescan(item.movie.id, item.movie.source_id!, item.movie.library_id || null, item.movie.file_path!) : undefined}
                    onDismissUpgrade={onDismissUpgrade}
                    isExpanded={expandedRecommendations.has(item.movie.id)}
                    onToggleOptimize={() => toggleRecommendation(item.movie.id)}
                  />
                </div>
              )
            }}
            components={{
              Footer
            }}
          />
        </div>
      </div>
    )
  }

  // Grid view using VirtuosoGrid
  return (
    <div className="h-full flex flex-col">
      {statsBar}
      {isSlimDownActive && <SlimDownBanner className="mb-4" />}
      <div className="flex-1 min-h-0">
        <VirtuosoGrid
          customScrollParent={scrollElement || undefined}
          data={displayItems}
          endReached={() => {
            if (!moviesLoading && movies.length < totalMovieCount) {
              onLoadMoreMovies()
            }
          }}
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
          itemContent={(_index, item) => {
            if (item.type === 'collection') {
              return (
                <div data-title={item.collection.collection_name}>
                  <CollectionCard
                    collection={item.collection}
                    onClick={() => onSelectCollection(item.collection)}
                  />
                </div>
              )
            }
            return (
              <div data-title={item.movie.title}>
                <MovieCard
                  movie={item.movie}
                  onClick={() => onSelectMovie(item.movie.id, item.movie)}
                  collectionData={getCollectionForMovie(item.movie)}
                  showSourceBadge={showSourceBadge}
                  onFixMatch={onFixMatch ? () => onFixMatch(item.movie.id, item.movie.title, item.movie.year, item.movie.file_path) : undefined}
                  onRescan={onRescan && item.movie.source_id && item.movie.file_path ? () => onRescan(item.movie.id, item.movie.source_id!, item.movie.library_id || null, item.movie.file_path!) : undefined}
                  onDismissUpgrade={onDismissUpgrade}
                  isExpanded={expandedRecommendations.has(item.movie.id)}
                  onToggleOptimize={() => toggleRecommendation(item.movie.id)}
                />
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}

// Collection card for grid view
const CollectionCard = memo(({ collection, onClick }: { collection: MovieCollectionData; onClick: () => void }) => {
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only cursor-pointer hover-scale outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster */}
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {collection.poster_url ? (
          <img
            src={collection.poster_url}
            alt={collection.collection_name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl bg-linear-to-br from-purple-500/20 to-blue-500/20">
            <Layers className="w-12 h-12 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Title and badge below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{collection.collection_name}</h4>
          <p className="text-xs text-muted-foreground">
            {collection.owned_movies} of {collection.total_movies} movies
          </p>
        </div>
        {/* Collection completion badge */}
        <div
          className={`shrink-0 text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1 ${
            collection.completeness_percentage === 100
              ? 'bg-green-500 text-white'
              : 'bg-foreground text-background border border-border'
          }`}
          title={`${collection.owned_movies} of ${collection.total_movies} movies owned`}
        >
          <Layers className="w-3 h-3" />
          <span>{collection.owned_movies}/{collection.total_movies}</span>
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.collection.id === nextProps.collection.id &&
         prevProps.collection.owned_movies === nextProps.collection.owned_movies &&
         prevProps.collection.total_movies === nextProps.collection.total_movies &&
         prevProps.collection.poster_url === nextProps.collection.poster_url
})

// Collection list item for list view
function CollectionListItem({ collection, onClick }: { collection: MovieCollectionData; onClick: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group cursor-pointer rounded-md bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster Thumbnail */}
      <div className="w-16 h-24 bg-muted rounded-md overflow-hidden shrink-0 relative shadow-md shadow-black/20">
        {collection.poster_url ? (
          <img
            src={collection.poster_url}
            alt={collection.collection_name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layers className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{collection.collection_name}</h4>
        <div className="flex items-center gap-1 mt-0.5">
          <span
            className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded flex items-center gap-1"
            title={`${collection.owned_movies} of ${collection.total_movies} movies owned`}
          >
            <Layers className="w-3 h-3" />
            {collection.owned_movies}/{collection.total_movies}
          </span>
        </div>
      </div>
    </div>
  )
}

const MovieCard = memo(({ movie, onClick, collectionData, showSourceBadge, onFixMatch, onRescan, onDismissUpgrade, isExpanded, onToggleOptimize }: { movie: MediaItem; onClick: () => void; collectionData?: MovieCollectionData; showSourceBadge?: boolean; onFixMatch?: (mediaItemId: number) => void; onRescan?: (mediaItemId: number) => Promise<void>; onDismissUpgrade?: (movie: MediaItem) => void; isExpanded?: boolean; onToggleOptimize?: () => void }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && movie.id) {
      onFixMatch(movie.id)
    }
  }

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan && movie.id) {
      setIsRescanning(true)
      try {
        await onRescan(movie.id)
      } finally {
        setIsRescanning(false)
      }
    }
  }

  const handleDismissUpgrade = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onDismissUpgrade) {
      onDismissUpgrade(movie)
    }
  }

  const handleToggleOptimize = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onToggleOptimize) onToggleOptimize()
  }

  const needsUpgrade = movie.tier_quality === 'LOW' || !!movie.needs_upgrade
  const showMenuButton = onFixMatch || onRescan || (onDismissUpgrade && needsUpgrade) || onToggleOptimize

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only group cursor-pointer hover-scale outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Poster */}
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {/* 3-dot menu button */}
        {showMenuButton && (
          <div ref={menuRef} className="absolute top-2 left-2 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className={`w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity ${isRescanning || showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              {isRescanning ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <MoreVertical className="w-4 h-4" />
              )}
            </button>

            {/* Dropdown menu */}
            {showMenu && !isRescanning && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px]">
                {onToggleOptimize && (
                  <button
                    onClick={handleToggleOptimize}
                    className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 ${isExpanded ? 'text-primary font-medium' : ''}`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {isExpanded ? 'Hide Optimization' : 'Optimize...'}
                  </button>
                )}
                {onRescan && movie.file_path && (
                  <button
                    onClick={handleRescan}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rescan File
                  </button>
                )}
                {onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Fix Match
                  </button>
                )}
                {onDismissUpgrade && needsUpgrade && (
                  <button
                    onClick={handleDismissUpgrade}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    Dismiss Upgrade
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Version Count Badge */}
        {movie.version_count && movie.version_count > 1 && (
          <div
            className="absolute top-2 right-2 z-10 bg-primary text-primary-foreground text-[0.625rem] font-bold px-1.5 py-0.5 rounded shadow-md"
            title={`${movie.version_count} versions available`}
          >
            {movie.version_count}x
          </div>
        )}

        {/* Source Badge - show which provider this item is from */}
        {showSourceBadge && movie.source_type && (
          <div
            className={`absolute bottom-2 left-2 ${providerColors[movie.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
            title={movie.source_type.charAt(0).toUpperCase() + movie.source_type.slice(1)}
          >
            {movie.source_type.charAt(0).toUpperCase()}
          </div>
        )}

        {movie.poster_url ? (
          <img
            src={movie.poster_url}
            alt={movie.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><MoviePlaceholder className="w-20 h-20 text-muted-foreground" /></div>
        )}
      </div>

      {/* Title and Year below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{movie.title}</h4>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{movie.year}</span>
            {movie.original_language && (
              <>
                <span className="text-muted-foreground/30">•</span>
                <span className="uppercase text-[10px]">{movie.original_language}</span>
              </>
            )}
            {movie.resolution && (
              <>
                <span className="text-muted-foreground/30">•</span>
                <span>{movie.resolution}</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {/* Collection Badge - shown when movie is part of a collection */}
          {collectionData && (
            <div
              className={`text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1 ${
                collectionData.completeness_percentage === 100
                  ? 'bg-green-500 text-white'
                  : 'bg-foreground text-background border border-border'
              }`}
              title={`Part of ${collectionData.collection_name} (${collectionData.owned_movies}/${collectionData.total_movies})`}
            >
              <Layers className="w-3 h-3" />
              <span>{collectionData.owned_movies}/{collectionData.total_movies}</span>
            </div>
          )}
          {/* Quality Upgrade Badge */}
          {(movie.tier_quality === 'LOW' || !!movie.needs_upgrade) && (
            <div title="Quality upgrade recommended">
              <CircleFadingArrowUp className="w-5 h-5 text-red-500" />
            </div>
          )}
          {/* Storage Debt Badge */}
          {movie.storage_debt_bytes != null && movie.storage_debt_bytes > 5 * 1024 * 1024 * 1024 && (
            <div title={`Significant Storage Debt (${formatBytes(movie.storage_debt_bytes)}). Re-encode to save massive space.`}>
              <HardDrive className="w-5 h-5 text-blue-500" />
            </div>
          )}
          {/* Efficiency Trash Badge */}
          {movie.efficiency_score != null && movie.efficiency_score < 60 && (
            <div title={`Low Efficiency (${movie.efficiency_score}%). Upgrade recommended to save space.`}>
              <Trash2 className="w-5 h-5 text-orange-500" />
            </div>
          )}
        </div>
      </div>
      {isExpanded && <div onClick={e => e.stopPropagation()}><ConversionRecommendation item={movie} compact /></div>}
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.movie.id === nextProps.movie.id &&
         prevProps.movie.original_language === nextProps.movie.original_language &&
         prevProps.movie.audio_language === nextProps.movie.audio_language &&
         prevProps.movie.tier_quality === nextProps.movie.tier_quality &&
         prevProps.movie.needs_upgrade === nextProps.movie.needs_upgrade &&
         prevProps.movie.poster_url === nextProps.movie.poster_url &&
         prevProps.movie.quality_tier === nextProps.movie.quality_tier &&
         prevProps.movie.source_type === nextProps.movie.source_type &&
         prevProps.movie.version_count === nextProps.movie.version_count &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.isExpanded === nextProps.isExpanded &&
         prevProps.collectionData?.id === nextProps.collectionData?.id &&
         prevProps.collectionData?.completeness_percentage === nextProps.collectionData?.completeness_percentage
})

const MovieListItem = memo(({
  movie,
  onClick,
  showSourceBadge,
  collectionData,
  onFixMatch,
  onRescan,
  onDismissUpgrade,
  isExpanded,
  onToggleOptimize
}: {
  movie: MediaItem
  onClick: () => void
  showSourceBadge?: boolean
  collectionData?: MovieCollectionData
  onFixMatch?: () => void
  onRescan?: () => Promise<void>
  onDismissUpgrade?: (movie: MediaItem) => void
  isExpanded?: boolean
  onToggleOptimize?: () => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch) onFixMatch()
  }

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan) {
      setIsRescanning(true)
      try {
        await onRescan()
      } finally {
        setIsRescanning(false)
      }
    }
  }

  const handleDismissUpgrade = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onDismissUpgrade) onDismissUpgrade(movie)
  }

  const handleToggleOptimize = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onToggleOptimize) onToggleOptimize()
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatBitrate = (kbps: number) => {
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
    return `${kbps} kbps`
  }

  const needsUpgrade = movie.tier_quality === 'LOW' || !!movie.needs_upgrade
  const showMenuButton = onFixMatch || onRescan || (onDismissUpgrade && needsUpgrade) || onToggleOptimize

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 px-4 py-2 outline-none border-b border-border/10"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="grid grid-cols-[1fr_80px_100px_100px_120px_120px_100px_80px_40px] gap-4 items-center">
        {/* Title & Info */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-14 bg-muted rounded overflow-hidden flex-shrink-0 relative shadow-sm">
            {movie.poster_url ? (
              <img src={movie.poster_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><MoviePlaceholder className="w-4 h-4 text-muted-foreground" /></div>
            )}
            {showSourceBadge && movie.source_type && (
              <div className={`absolute bottom-0 left-0 right-0 ${providerColors[movie.source_type] || 'bg-gray-500'} text-[0.5rem] text-white font-bold text-center leading-tight`}>
                {movie.source_type.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <h4 className="font-medium text-sm truncate">{movie.title}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <QualityBadges item={movie} whiteBg={false} />
              {collectionData && (
                <span className="text-[0.65rem] text-muted-foreground bg-muted/50 px-1 rounded flex items-center gap-1">
                  <Layers className="w-2.5 h-2.5" />
                  {collectionData.owned_movies}/{collectionData.total_movies}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-center text-sm text-muted-foreground">{movie.year || '-'}</div>
        <div className="text-sm text-muted-foreground">{movie.resolution || '-'}</div>
        <div className="text-sm text-muted-foreground uppercase">{(movie as any).video_codec || '-'}</div>
        <div className="text-right text-sm text-muted-foreground font-mono">{formatBitrate((movie as any).video_bitrate || 0)}</div>
        <div className="text-right text-sm text-muted-foreground font-mono">{formatBytes((movie as any).file_size || 0)}</div>

        <div className="text-center">
          <div
            className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block ${
              (movie as any).efficiency_score >= 85 ? 'bg-green-500/20 text-green-500' :
              (movie as any).efficiency_score >= 60 ? 'bg-yellow-500/20 text-yellow-500' :
              'bg-red-500/20 text-red-500'
            }`}
          >
            {(movie as any).efficiency_score || 0}%
          </div>
        </div>

        <div className="text-right">
          <span className={`text-xs font-medium ${(movie as any).storage_debt_bytes > 0 ? 'text-orange-500' : 'text-muted-foreground'}`}>
            {(movie as any).storage_debt_bytes > 0 ? formatBytes((movie as any).storage_debt_bytes) : '-'}
          </span>
        </div>

        {/* Actions */}
        <div className="relative flex justify-center">
          {showMenuButton && (
            <div ref={menuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(!showMenu)
                }}
                className={`w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-all ${showMenu ? 'bg-muted text-foreground' : ''}`}
              >
                {isRescanning ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <MoreVertical className="w-4 h-4" />
                )}
              </button>

              {/* Dropdown menu */}
              {showMenu && !isRescanning && (
                <div className="absolute top-10 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px] z-50">
                  {onToggleOptimize && (
                    <button
                      onClick={handleToggleOptimize}
                      className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 ${isExpanded ? 'text-primary font-medium' : ''}`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {isExpanded ? 'Hide Optimization' : 'Optimize...'}
                    </button>
                  )}
                  {onRescan && movie.file_path && (
                    <button
                      onClick={handleRescan}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Rescan File
                    </button>
                  )}
                  {onFixMatch && (
                    <button
                      onClick={handleFixMatch}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Fix Match
                    </button>
                  )}
                  {onDismissUpgrade && needsUpgrade && (
                    <button
                      onClick={handleDismissUpgrade}
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      Dismiss Upgrade
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {isExpanded && <div onClick={e => e.stopPropagation()} className="ml-13 mt-2"><ConversionRecommendation item={movie} compact /></div>}
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.movie.id === nextProps.movie.id &&
         prevProps.movie.original_language === nextProps.movie.original_language &&
         prevProps.movie.audio_language === nextProps.movie.audio_language &&
         prevProps.movie.tier_quality === nextProps.movie.tier_quality &&
         prevProps.movie.needs_upgrade === nextProps.movie.needs_upgrade &&
         prevProps.collectionData?.id === nextProps.collectionData?.id &&
         prevProps.collectionData?.completeness_percentage === nextProps.collectionData?.completeness_percentage &&
         prevProps.movie.poster_url === nextProps.movie.poster_url &&
         prevProps.movie.quality_tier === nextProps.movie.quality_tier &&
         prevProps.movie.source_type === nextProps.movie.source_type &&
         prevProps.movie.version_count === nextProps.movie.version_count &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.isExpanded === nextProps.isExpanded
})
