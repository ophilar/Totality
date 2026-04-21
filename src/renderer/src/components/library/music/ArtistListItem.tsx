import { useState, useCallback, memo } from 'react'
import { MoreVertical, RefreshCw, Pencil, User } from 'lucide-react'
import { useMenuClose } from '../../../hooks/useMenuClose'
import { providerColors } from '../mediaUtils'
import type { MusicArtist, ArtistCompletenessData } from '../types'

export const ArtistListItem = memo(({ artist, completeness, onClick, showSourceBadge, onFixMatch, onAnalyzeCompleteness }: {
  artist: MusicArtist
  completeness?: ArtistCompletenessData
  onClick: () => void
  showSourceBadge: boolean
  onFixMatch?: (artistId: number) => void
  onAnalyzeCompleteness?: (artistId: number) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  // Show menu if any action is available
  const hasMenuActions = onFixMatch || onAnalyzeCompleteness

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && artist.id) {
      onFixMatch(artist.id)
    }
  }

  const handleAnalyzeCompleteness = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeCompleteness && artist.id) {
      setIsAnalyzing(true)
      try {
        await onAnalyzeCompleteness(artist.id)
      } finally {
        setIsAnalyzing(false)
      }
    }
  }

  return (
    <div
      className="group cursor-pointer rounded-md bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center"
      onClick={onClick}
    >
      {/* Artist Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-full overflow-hidden shrink-0 relative shadow-md shadow-black/20">
        {artist.thumb_url ? (
          <img
            src={artist.thumb_url}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* Source badge */}
        {showSourceBadge && artist.source_type && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[artist.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1 py-0.5 rounded`}
          >
            {artist.source_type.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{artist.name}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {artist.album_count} {artist.album_count === 1 ? 'album' : 'albums'} • {artist.track_count} tracks
        </p>
        {completeness && (
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
              {completeness.owned_albums}/{completeness.total_albums}
            </span>
          </div>
        )}
      </div>

      {/* 3-dot menu */}
      {hasMenuActions && (
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

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px] z-20">
              {onAnalyzeCompleteness && (
                <button
                  onClick={handleAnalyzeCompleteness}
                  disabled={isAnalyzing}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  {isAnalyzing ? 'Analyzing...' : 'Analyze Completeness'}
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
            </div>
          )}
        </div>
      )}
    </div>
  )
})
