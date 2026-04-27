import { useState, useEffect, useCallback, memo, useRef } from 'react'
import { MoreVertical, EyeOff } from 'lucide-react'
import { EpisodePlaceholder } from '@/components/ui/MediaPlaceholders'
import { useMenuClose } from '@/hooks/useMenuClose'
import type { MissingEpisode } from '@/components/library/types'

export const MissingEpisodeRowWithArtwork = memo(({
  episode,
  tmdbId,
  fallbackPosterUrl,
  onClick,
  onDismiss
}: {
  episode: MissingEpisode
  tmdbId?: string
  fallbackPosterUrl?: string
  onClick: () => void
  onDismiss?: () => void
}) => {
  const [stillUrl, setStillUrl] = useState<string | undefined>(fallbackPosterUrl)
  const [showMenu, setShowMenu] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  useEffect(() => {
    if (tmdbId) {
      window.electronAPI.seriesGetEpisodeStill(tmdbId, episode.season_number, episode.episode_number)
        .then((url) => {
          if (url) setStillUrl(url)
        })
        .catch((err) => {
          window.electronAPI.log.warn('[TVShowsView]', `Failed to fetch episode still for S${episode.season_number}E${episode.episode_number}:`, err)
        })
    }
  }, [tmdbId, episode.season_number, episode.episode_number])

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="group flex gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {/* Missing Episode Thumbnail - 16:9 aspect ratio with shadow */}
      <div className="w-44 aspect-video bg-muted shrink-0 overflow-hidden rounded-md shadow-md shadow-black/20">
        {stillUrl ? (
          <img
            src={stillUrl}
            alt={episode.title || `Episode ${episode.episode_number}`}
            loading="lazy"
            className="w-full h-full object-cover grayscale opacity-50"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50">
            <EpisodePlaceholder className="w-10 h-10 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground shrink-0">
            E{episode.episode_number}
          </span>
          <h4 className="font-semibold truncate text-muted-foreground">
            {episode.title || 'Unknown Title'}
          </h4>
        </div>
        {episode.air_date && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Aired: {new Date(episode.air_date).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* 3-dot menu */}
      {onDismiss && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px] z-20">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDismiss() }}
                className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
              >
                <EyeOff className="w-3.5 h-3.5" />
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
