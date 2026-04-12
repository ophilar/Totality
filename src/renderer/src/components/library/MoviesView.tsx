import { useState, useMemo, useCallback, memo, useRef } from 'react'
import { Layers, RefreshCw, MoreVertical, Pencil, CircleFadingArrowUp, EyeOff, Trash2, HardDrive, Zap } from 'lucide-react'
import { MediaGridView } from './MediaGridView'
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

  // Map scale to minimum poster width
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120, 2: 140, 3: 160, 4: 180, 5: 200, 6: 240, 7: 300
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  // Group movies by collection
  const displayItems = useMemo<MovieDisplayItem[]>(() => {
    const moviesInCollections = new Set<number>()
    const collectionMovieMap = new Map<string, MediaItem[]>()

    for (const movie of movies) {
      const collection = getCollectionForMovie(movie)
      if (collection) {
        moviesInCollections.add(movie.id)
        const existing = collectionMovieMap.get(collection.tmdb_collection_id) || []
        existing.push(movie)
        collectionMovieMap.set(collection.tmdb_collection_id, existing)
      }
    }

    const items: MovieDisplayItem[] = []
    const addedCollections = new Set<string>()
    for (const collection of movieCollections) {
      if (collectionMovieMap.has(collection.tmdb_collection_id) && !addedCollections.has(collection.tmdb_collection_id)) {
        items.push({ type: 'collection', collection })
        addedCollections.add(collection.tmdb_collection_id)
      }
    }

    if (!collectionsOnly) {
      for (const movie of movies) {
        if (!moviesInCollections.has(movie.id)) {
          items.push({ type: 'movie', movie })
        }
      }
    }

    items.sort((a, b) => {
      if (sortBy === 'efficiency') {
        const effA = a.type === 'movie' ? (a.movie.efficiency_score ?? 100) : 100
        const effB = b.type === 'movie' ? (b.movie.efficiency_score ?? 100) : 100
        if (effA !== effB) return effA - effB
      } else if (sortBy === 'waste') {
        const wasteA = a.type === 'movie' ? (a.movie.storage_debt_bytes ?? 0) : 0
        const wasteB = b.type === 'movie' ? (b.movie.storage_debt_bytes ?? 0) : 0
        if (wasteA !== wasteB) return wasteB - wasteA
      } else if (sortBy === 'size') {
        const sizeA = a.type === 'movie' ? (a.movie.file_size ?? 0) : 0
        const sizeB = b.type === 'movie' ? (b.movie.file_size ?? 0) : 0
        if (sizeA !== sizeB) return sizeB - sizeA
      }

      const titleA = a.type === 'collection' ? a.collection.collection_name : a.movie.title
      const titleB = b.type === 'collection' ? b.collection.collection_name : b.movie.title
      return titleA.localeCompare(titleB)
    })

    return items
  }, [movies, movieCollections, getCollectionForMovie, collectionsOnly, sortBy])

  const statsBar = (
    <div className="flex items-center justify-between pb-4 px-1">
      <div className="flex items-center gap-6 text-sm text-muted-foreground font-medium">
        <span>{totalMovieCount.toLocaleString()} Movies</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Sort:</span>
        <div className="flex gap-1 bg-muted/30 p-1 rounded-lg">
          {(['title', 'efficiency', 'waste', 'size'] as const).map(s => (
            <button
              key={s}
              onClick={() => onSortChange(s)}
              className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${sortBy === s ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted/50 text-muted-foreground'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const listHeader = (
    <div className="grid grid-cols-[1fr_80px_100px_100px_120px_120px_100px_80px_40px] gap-4 px-4 py-2 mb-2 border-b border-border/50 text-xs font-bold uppercase tracking-wider text-muted-foreground bg-muted/10 sticky top-0 z-10 rounded-t-lg">
      <div>Title</div>
      <div className="text-center">Year</div>
      <div>Resolution</div>
      <div>Codec</div>
      <div className="text-right">Bitrate</div>
      <div className="text-right">Size</div>
      <div className="text-center">Efficiency</div>
      <div className="text-right">Debt</div>
      <div className="text-center"></div>
    </div>
  )

  const emptyState = (
    <div className="flex flex-col items-center justify-center text-center p-12">
      <MoviePlaceholder className="w-24 h-24 text-muted-foreground/40 mb-6" />
      <p className="text-muted-foreground text-xl font-medium">No movies found</p>
      <p className="text-sm text-muted-foreground/70 mt-2 max-w-xs">
        Scan a movie library from the sidebar to start analyzing your collection
      </p>
    </div>
  )

  const isSlimDownActive = slimDown || sortBy === 'efficiency' || sortBy === 'waste' || sortBy === 'size'

  return (
    <MediaGridView
      items={displayItems}
      totalCount={totalMovieCount}
      loading={moviesLoading}
      onLoadMore={onLoadMoreMovies}
      viewType={viewType}
      posterMinWidth={posterMinWidth}
      statsBar={statsBar}
      listHeader={listHeader}
      emptyState={emptyState}
      banner={isSlimDownActive ? <SlimDownBanner className="mb-4" /> : undefined}
      scrollElement={scrollElement}
      renderGridItem={(item) => (
        item.type === 'collection' ? (
          <div key={`col-${item.collection.tmdb_collection_id}`}>
            <CollectionCard
              collection={item.collection}
              onClick={() => onSelectCollection(item.collection)}
            />
          </div>
        ) : (
          <div key={`mov-${item.movie.id}`}>
            <MovieCard
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
      )}
      renderListItem={(item) => (
        item.type === 'collection' ? (
          <div key={`col-l-${item.collection.tmdb_collection_id}`}>
            <CollectionListItem
              collection={item.collection}
              onClick={() => onSelectCollection(item.collection)}
            />
          </div>
        ) : (
          <div key={`mov-l-${item.movie.id}`}>
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
      )}
    />
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
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 text-4xl">
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
          <div className="w-full h-full flex items-center justify-center bg-linear-to-br from-purple-500/20 to-blue-500/20">
            <Layers className="w-12 h-12 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{collection.collection_name}</h4>
          <p className="text-xs text-muted-foreground">
            {collection.owned_movies} of {collection.total_movies} movies
          </p>
        </div>
        <div
          className={`shrink-0 text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1 ${
            collection.completeness_percentage === 100
              ? 'bg-green-500 text-white'
              : 'bg-foreground text-background border border-border'
          }`}
        >
          <Layers className="w-3 h-3" />
          <span>{collection.owned_movies}/{collection.total_movies}</span>
        </div>
      </div>
    </div>
  )
})

// Collection list item for list view
function CollectionListItem({ collection, onClick }: { collection: MovieCollectionData; onClick: () => void }) {
  return (
    <div
      tabIndex={0}
      className="group cursor-pointer rounded-md bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center outline-hidden"
      onClick={onClick}
    >
      <div className="w-16 h-24 bg-muted rounded-md overflow-hidden shrink-0 relative shadow-md shadow-black/20">
        {collection.poster_url ? (
          <img src={collection.poster_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Layers className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{collection.collection_name}</h4>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded flex items-center gap-1">
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
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && movie.id) onFixMatch(movie.id)
  }

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan && movie.id) {
      setIsRescanning(true)
      try { await onRescan(movie.id) } finally { setIsRescanning(false) }
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

  const needsUpgrade = movie.tier_quality === 'LOW' || !!movie.needs_upgrade
  const showMenuButton = onFixMatch || onRescan || (onDismissUpgrade && needsUpgrade) || onToggleOptimize

  return (
    <div
      tabIndex={0}
      className="focus-poster-only group cursor-pointer hover-scale outline-hidden"
      onClick={onClick}
    >
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {showMenuButton && (
          <div ref={menuRef} className="absolute top-2 left-2 z-20">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
              className={`w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity ${isRescanning || showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              {isRescanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
            </button>
            {showMenu && !isRescanning && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px]">
                {onToggleOptimize && (
                  <button onClick={handleToggleOptimize} className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 ${isExpanded ? 'text-primary font-medium' : ''}`}>
                    <Zap className="w-3.5 h-3.5" /> {isExpanded ? 'Hide Optimization' : 'Optimize...'}
                  </button>
                )}
                {onRescan && movie.file_path && (
                  <button onClick={handleRescan} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5" /> Rescan File
                  </button>
                )}
                {onFixMatch && (
                  <button onClick={handleFixMatch} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2">
                    <Pencil className="w-3.5 h-3.5" /> Fix Match
                  </button>
                )}
                {onDismissUpgrade && needsUpgrade && (
                  <button onClick={handleDismissUpgrade} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2">
                    <EyeOff className="w-3.5 h-3.5" /> Dismiss Upgrade
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {movie.version_count && movie.version_count > 1 && (
          <div className="absolute top-2 right-2 z-10 bg-primary text-primary-foreground text-[0.625rem] font-bold px-1.5 py-0.5 rounded shadow-md">{movie.version_count}x</div>
        )}

        {showSourceBadge && movie.source_type && (
          <div className={`absolute bottom-2 left-2 ${providerColors[movie.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}>
            {movie.source_type.charAt(0).toUpperCase()}
          </div>
        )}

        {movie.poster_url ? (
          <img src={movie.poster_url} alt={movie.title} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><MoviePlaceholder className="w-20 h-20 text-muted-foreground" /></div>
        )}
      </div>

      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{movie.title}</h4>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{movie.year}</span>
            {movie.resolution && <><span className="text-muted-foreground/30">•</span><span>{movie.resolution}</span></>}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {collectionData && (
            <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${collectionData.completeness_percentage === 100 ? 'bg-green-500 text-white' : 'bg-foreground text-background border border-border'}`}>
              <Layers className="w-2.5 h-2.5" /> <span>{collectionData.owned_movies}/{collectionData.total_movies}</span>
            </div>
          )}
          {(movie.tier_quality === 'LOW' || !!movie.needs_upgrade) && <CircleFadingArrowUp className="w-4 h-4 text-red-500" />}
          {movie.storage_debt_bytes != null && movie.storage_debt_bytes > 5 * 1024 * 1024 * 1024 && <HardDrive className="w-4 h-4 text-blue-500" />}
          {movie.efficiency_score != null && movie.efficiency_score < 60 && <Trash2 className="w-4 h-4 text-orange-500" />}
        </div>
      </div>
      {isExpanded && <div onClick={e => e.stopPropagation()}><ConversionRecommendation item={movie} compact /></div>}
    </div>
  )
})

const MovieListItem = memo(({ movie, onClick, showSourceBadge, collectionData, onFixMatch, onRescan, onDismissUpgrade, isExpanded, onToggleOptimize }: { movie: MediaItem; onClick: () => void; showSourceBadge?: boolean; collectionData?: MovieCollectionData; onFixMatch?: () => void; onRescan?: () => Promise<void>; onDismissUpgrade?: (movie: MediaItem) => void; isExpanded?: boolean; onToggleOptimize?: () => void }) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleFixMatch = (e: React.MouseEvent) => { e.stopPropagation(); setShowMenu(false); if (onFixMatch) onFixMatch() }
  const handleRescan = async (e: React.MouseEvent) => { e.stopPropagation(); setShowMenu(false); if (onRescan) { setIsRescanning(true); try { await onRescan() } finally { setIsRescanning(false) } } }
  const handleDismissUpgrade = (e: React.MouseEvent) => { e.stopPropagation(); setShowMenu(false); if (onDismissUpgrade) onDismissUpgrade(movie) }
  const handleToggleOptimize = (e: React.MouseEvent) => { e.stopPropagation(); setShowMenu(false); if (onToggleOptimize) onToggleOptimize() }

  const formatBitrate = (kbps: number) => kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`
  const needsUpgrade = movie.tier_quality === 'LOW' || !!movie.needs_upgrade
  const showMenuButton = onFixMatch || onRescan || (onDismissUpgrade && needsUpgrade) || onToggleOptimize

  return (
    <div tabIndex={0} className="group cursor-pointer rounded-md overflow-hidden bg-muted/20 hover:bg-muted/40 transition-all duration-200 px-4 py-2 outline-none border-b border-border/10" onClick={onClick}>
      <div className="grid grid-cols-[1fr_80px_100px_100px_120px_120px_100px_80px_40px] gap-4 items-center">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 relative shadow-sm">
            {movie.poster_url ? <img src={movie.poster_url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><MoviePlaceholder className="w-4 h-4 text-muted-foreground" /></div>}
            {showSourceBadge && movie.source_type && <div className={`absolute bottom-0 left-0 right-0 ${providerColors[movie.source_type] || 'bg-gray-500'} text-[0.5rem] text-white font-bold text-center`}>{movie.source_type.toUpperCase()}</div>}
          </div>
          <div className="min-w-0">
            <h4 className="font-medium text-sm truncate">{movie.title}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <QualityBadges item={movie} whiteBg={false} />
              {collectionData && <span className="text-[0.65rem] text-muted-foreground bg-muted/50 px-1 rounded flex items-center gap-1"><Layers className="w-2.5 h-2.5" />{collectionData.owned_movies}/{collectionData.total_movies}</span>}
            </div>
          </div>
        </div>
        <div className="text-center text-sm text-muted-foreground">{movie.year || '-'}</div>
        <div className="text-sm text-muted-foreground">{movie.resolution || '-'}</div>
        <div className="text-sm text-muted-foreground uppercase">{movie.video_codec || '-'}</div>
        <div className="text-right text-sm text-muted-foreground font-mono">{formatBitrate(movie.video_bitrate || 0)}</div>
        <div className="text-right text-sm text-muted-foreground font-mono">{formatBytes(movie.file_size || 0)}</div>
        <div className="text-center">
          <div className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block ${movie.efficiency_score >= 85 ? 'bg-green-500/20 text-green-500' : movie.efficiency_score >= 60 ? 'bg-yellow-500/20 text-yellow-500' : 'bg-red-500/20 text-red-500'}`}>
            {movie.efficiency_score || 0}%
          </div>
        </div>
        <div className="text-right"><span className={`text-xs font-medium ${movie.storage_debt_bytes > 0 ? 'text-orange-500' : 'text-muted-foreground'}`}>{movie.storage_debt_bytes > 0 ? formatBytes(movie.storage_debt_bytes) : '-'}</span></div>
        <div className="relative flex justify-center">
          {showMenuButton && (
            <div ref={menuRef}>
              <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }} className={`w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground ${showMenu ? 'bg-muted text-foreground' : ''}`}>
                {isRescanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
              </button>
              {showMenu && !isRescanning && (
                <div className="absolute top-10 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[140px] z-50">
                  {onToggleOptimize && <button onClick={handleToggleOptimize} className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 ${isExpanded ? 'text-primary font-medium' : ''}`}><Zap className="w-3.5 h-3.5" /> {isExpanded ? 'Hide Optimization' : 'Optimize...'}</button>}
                  {onRescan && movie.file_path && <button onClick={handleRescan} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> Rescan File</button>}
                  {onFixMatch && <button onClick={handleFixMatch} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"><Pencil className="w-3.5 h-3.5" /> Fix Match</button>}
                  {onDismissUpgrade && needsUpgrade && <button onClick={handleDismissUpgrade} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"><EyeOff className="w-3.5 h-3.5" /> Dismiss Upgrade</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {isExpanded && <div onClick={e => e.stopPropagation()} className="ml-13 mt-2"><ConversionRecommendation item={movie} compact /></div>}
    </div>
  )
})
