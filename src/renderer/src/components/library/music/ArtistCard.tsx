import React, { useState, useCallback, memo } from 'react'
import { MoreVertical, RefreshCw, Pencil, HardDrive, User } from 'lucide-react'
import { useMenuClose } from '../../../hooks/useMenuClose'
import { providerColors } from '../mediaUtils'
import type { MusicArtist, ArtistCompletenessData } from '../types'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const ArtistCard = memo(({ artist, onClick, showSourceBadge, onFixMatch, onAnalyzeCompleteness, artistCompleteness }: {
  artist: MusicArtist
  onClick: () => void
  showSourceBadge: boolean
  onFixMatch?: (artistId: number) => void
  onAnalyzeCompleteness?: (artistId: number) => void
  artistCompleteness: Map<string, ArtistCompletenessData>
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
      className="group cursor-pointer hover-scale"
      onClick={onClick}
    >
      <div className="relative">
        {/* 3-dot menu button - positioned outside the circular frame */}
        {hasMenuActions && (
          <div ref={menuRef} className="absolute -top-1 -left-1 z-20">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px]">
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
        <div className="aspect-square bg-muted overflow-hidden rounded-full shadow-lg shadow-black/30">
          {showSourceBadge && artist.source_type && (
          <div
            className={`absolute bottom-2 right-2 z-10 ${providerColors[artist.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
          >
            {artist.source_type.charAt(0).toUpperCase()}
          </div>
        )}
        {(() => {
          const comp = artistCompleteness.get(artist.name)
          if (comp?.storage_debt_bytes != null && comp.storage_debt_bytes > 1024 * 1024 * 1024) {
            return (
              <div
                className="absolute bottom-2 left-2 z-10 bg-black/60 p-1 rounded-full shadow-md"
                title={`Significant Storage Debt (${formatBytes(comp.storage_debt_bytes)}). Re-encode to save space.`}
              >
                <HardDrive className="w-4 h-4 text-blue-500" />
              </div>
            )
          }
          return null
        })()}
        {artist.thumb_url ? (
          <img
            src={artist.thumb_url}
            alt={artist.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
        </div>
      </div>
      <div className="pt-3 text-center">
        <h4 className="font-medium text-sm truncate">{artist.name}</h4>
        <p className="text-xs text-muted-foreground">
          {artist.album_count} {artist.album_count === 1 ? 'album' : 'albums'}
        </p>
      </div>
    </div>
  )
})
