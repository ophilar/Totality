import { useState, useEffect, useRef, memo } from 'react'
import { Trash2, Film, Tv, Music, Disc, CheckCircle2, RotateCcw } from 'lucide-react'
import { StarRating } from './StarRating'
import { StoreLinksMenu } from './StoreLinksMenu'
import type { WishlistItem, StoreLink, WishlistPriority } from '../../contexts/WishlistContext'
import { useWishlist } from '../../contexts/WishlistContext'

interface WishlistItemCardProps {
  item: WishlistItem
  onRemove: (id: number) => void
  onUpdatePriority: (id: number, priority: WishlistPriority) => void
  onMarkCompleted: (id: number) => void
  onMarkActive: (id: number) => void
  isMobile?: boolean
}

// Media type icons
const mediaTypeIcons = {
  movie: Film,
  episode: Tv,
  season: Tv,
  album: Disc,
  track: Music
}


export const WishlistItemCard = memo(function WishlistItemCard({
  item,
  onRemove,
  onUpdatePriority,
  onMarkCompleted,
  onMarkActive,
  isMobile = false
}: WishlistItemCardProps) {
  const { getStoreLinks, openStoreLink } = useWishlist()
  const [storeLinks, setStoreLinks] = useState<StoreLink[]>([])
  const [isLoadingLinks, setIsLoadingLinks] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)

  // Load store links on mount
  useEffect(() => {
    loadStoreLinks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  const loadStoreLinks = async () => {
    setIsLoadingLinks(true)
    try {
      const links = await getStoreLinks(item)
      setStoreLinks(links)
    } catch (err) {
      console.error('Error loading store links:', err)
    } finally {
      setIsLoadingLinks(false)
    }
  }

  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up delete confirmation timer on unmount
  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
    }
  }, [])

  const handleRemove = () => {
    if (showConfirmDelete) {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current)
      onRemove(item.id)
    } else {
      setShowConfirmDelete(true)
      deleteTimerRef.current = setTimeout(() => {
        setShowConfirmDelete(false)
        deleteTimerRef.current = null
      }, 3000)
    }
  }

  // Get subtitle based on type
  const getSubtitle = () => {
    if (item.media_type === 'episode') {
      const parts = []
      if (item.series_title) parts.push(item.series_title)
      if (item.season_number !== undefined) parts.push(`S${item.season_number}`)
      if (item.episode_number !== undefined) parts.push(`E${item.episode_number}`)
      return parts.join(' ')
    }
    if (item.media_type === 'season' && item.series_title) {
      return `${item.series_title} Season ${item.season_number || 1}`
    }
    if (item.media_type === 'album' || item.media_type === 'track') {
      return item.artist_name || ''
    }
    if (item.year) {
      return item.year.toString()
    }
    return item.subtitle || ''
  }

  const MediaIcon = mediaTypeIcons[item.media_type]
  const subtitle = getSubtitle()
  const isMusic = item.media_type === 'album' || item.media_type === 'track'
  const isCompleted = item.status === 'completed'

  // Format completion date
  const getCompletedDate = () => {
    if (!item.completed_at) return null
    const date = new Date(item.completed_at)
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (isMobile) {
    // ── Mobile layout ──
    // Row 1: poster + title/subtitle + action buttons (vertically centered)
    // Row 2: star rating (full width below)
    return (
      <div className="relative p-3 rounded-lg transition-colors group hover:bg-muted/30">
        {/* Completed badge */}
        {isCompleted && (
          <div className="absolute top-2 right-2 z-10">
            <CheckCircle2 className="w-5 h-5 text-foreground" />
          </div>
        )}

        {/* Main row: poster + info + actions */}
        <div className="flex items-center gap-3">
          {/* Poster */}
          <div className={`w-14 ${isMusic ? 'h-14' : 'h-[84px]'} bg-muted rounded-lg overflow-hidden shrink-0`}>
            {item.poster_url ? (
              <img
                src={item.poster_url}
                alt={item.title}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-muted/50 text-muted-foreground">
                <MediaIcon className="w-6 h-6" />
              </div>
            )}
          </div>

          {/* Title + subtitle + stars */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <MediaIcon className="w-4 h-4 text-muted-foreground shrink-0" />
              <h4 className="font-medium text-body truncate">{item.title}</h4>
            </div>
            {subtitle && (
              <p className="text-label text-muted-foreground truncate mt-0.5">{subtitle}</p>
            )}
            {!isCompleted && (
              <div className="mt-1 -ml-1">
                <StarRating
                  rating={item.priority}
                  onChange={(rating) => onUpdatePriority(item.id, rating)}
                  size="sm"
                  isMobile
                />
              </div>
            )}
            {isCompleted && item.completed_at && (
              <p className="text-caption text-muted-foreground mt-0.5">
                Completed {getCompletedDate()}
              </p>
            )}
          </div>

          {/* Action buttons — vertically centered with content */}
          <div className="flex items-center gap-1 shrink-0">
            {isCompleted ? (
              <>
                <button
                  onClick={() => onMarkActive(item.id)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                  title="Move back to active"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
                <button
                  onClick={handleRemove}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${showConfirmDelete ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
                  title={showConfirmDelete ? 'Click again to confirm' : 'Remove'}
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onMarkCompleted(item.id)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                  title="Mark as completed"
                >
                  <CheckCircle2 className="w-5 h-5" />
                </button>
                <button
                  onClick={handleRemove}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${showConfirmDelete ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
                  title={showConfirmDelete ? 'Click again to confirm' : 'Remove'}
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Desktop layout ──
  return (
    <div className="relative flex gap-3 p-2 rounded-lg transition-colors group hover:bg-muted/30">
      {/* Completed checkmark - top right */}
      {isCompleted && (
        <div className="absolute top-1.5 right-1.5 z-10">
          <CheckCircle2 className="w-5 h-5 text-foreground" />
        </div>
      )}

      {/* Poster/Album Art */}
      <div className={`w-10 ${isMusic ? 'h-10' : 'h-[60px]'} bg-muted rounded overflow-hidden shrink-0`}>
        {item.poster_url ? (
          <img
            src={item.poster_url}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50 text-muted-foreground">
            <MediaIcon className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Title row with type icon */}
        <div className="flex items-start gap-1.5">
          <MediaIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 pr-5">
            <h4 className="font-medium text-label truncate leading-tight">{item.title}</h4>
            {subtitle && (
              <p className="text-caption text-muted-foreground truncate">{subtitle}</p>
            )}
          </div>
        </div>


        {/* Completed items: date on left, actions on right */}
        {isCompleted && (
          <div className="flex items-center justify-between mt-1">
            {item.completed_at && (
              <span className="text-caption text-muted-foreground">
                Completed {getCompletedDate()}
              </span>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => onMarkActive(item.id)}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Move back to active"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={handleRemove}
                className={`p-1.5 rounded-lg transition-colors ${showConfirmDelete ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
                title={showConfirmDelete ? 'Click again to confirm' : 'Remove from wishlist'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Active items: rating and actions */}
        {!isCompleted && (
          <div className="flex items-center justify-between mt-auto pt-1">
            <StarRating
              rating={item.priority}
              onChange={(rating) => onUpdatePriority(item.id, rating)}
              size="sm"
            />
            <div className="flex items-center gap-1">
              <StoreLinksMenu
                storeLinks={storeLinks}
                onOpenLink={openStoreLink}
                isLoading={isLoadingLinks}
                compact
              />
              <button
                onClick={() => onMarkCompleted(item.id)}
                className="p-1 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
                title="Mark as completed"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRemove}
                className={`p-1 rounded-lg transition-colors ${showConfirmDelete ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
                title={showConfirmDelete ? 'Click again to confirm' : 'Remove from wishlist'}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
