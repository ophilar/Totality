import { useState, useCallback, memo } from 'react'
import { MoreVertical, RefreshCw, Pencil, HardDrive, Disc3 } from 'lucide-react'
import { useMenuClose } from '../../../hooks/useMenuClose'
import { providerColors } from '../mediaUtils'
import type { MusicAlbum, AlbumCompletenessData } from '../types'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const AlbumCard = memo(({ album, onClick, showArtist = true, showSourceBadge, onAnalyze, onFixMatch, completeness }: {
  album: MusicAlbum
  onClick: () => void
  showArtist?: boolean
  showSourceBadge: boolean
  onAnalyze?: (albumId: number) => void
  onFixMatch?: () => void
  completeness?: AlbumCompletenessData
}) => {
  const hasCompleteness = !!completeness
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (!album.id || !onAnalyze) return

    setIsAnalyzing(true)
    try {
      await onAnalyze(album.id)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    onFixMatch?.()
  }

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(!showMenu)
  }

  return (
    <div
      className="cursor-pointer hover-scale group relative"
      onClick={onClick}
    >
      <div className="aspect-square bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {/* 3-dot menu button - appears on hover */}
        {onAnalyze && (
          <div ref={menuRef} className="absolute top-2 left-2 z-20">
            <button
              onClick={handleMenuClick}
              className={`w-7 h-7 rounded-full bg-black/60 flex items-center justify-center text-white transition-opacity ${
                showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              } hover:bg-black/80`}
            >
              {isAnalyzing ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <MoreVertical className="w-4 h-4" />
              )}
            </button>

            {/* Dropdown menu */}
            {showMenu && (
              <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px] z-30">
                <button
                  onClick={handleAnalyze}
                  disabled={isAnalyzing}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  {isAnalyzing ? 'Analyzing...' : 'Analyze for missing tracks'}
                </button>
                {onFixMatch && (
                  <button
                    onClick={handleFixMatch}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-4 h-4" />
                    Fix Match
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Quality badges */}
        {(() => {
          const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
          const codec = (album.best_audio_codec || '').toLowerCase()
          const isLossless = losslessCodecs.some(c => codec.includes(c))
          const isHiRes = isLossless && ((album.best_bit_depth || 0) > 16 || (album.best_sample_rate || 0) > 48000)
          if (!isLossless && !isHiRes) return null
          return (
            <div className="absolute top-2 right-2 z-10 flex flex-col gap-1 items-end">
              {isHiRes && (
                <span className="px-1.5 py-0.5 text-xs font-bold bg-purple-600 text-white rounded shadow-sm">Hi-Res</span>
              )}
              {isLossless && !isHiRes && (
                <span className="px-1.5 py-0.5 text-xs font-bold bg-green-600 text-white rounded shadow-sm">Lossless</span>
              )}
            </div>
          )
        })()}

        {showSourceBadge && album.source_type && (
          <div
            className={`absolute bottom-2 left-2 z-10 ${providerColors[album.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
          >
            {album.source_type.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Completeness badge - bottom right */}
        {hasCompleteness && (
          <div className="absolute bottom-2 right-2 z-10 flex flex-col gap-1 items-end">
            <div className="bg-foreground text-background text-xs font-bold px-1.5 py-0.5 rounded shadow-md">
              {completeness!.owned_tracks}/{completeness!.total_tracks}
            </div>
            {completeness!.storage_debt_bytes != null && completeness!.storage_debt_bytes > 500 * 1024 * 1024 && (
              <div
                title={`Significant Storage Debt (${formatBytes(completeness!.storage_debt_bytes)}). Re-encode to save space.`}
                className="bg-black/60 p-1 rounded-full"
              >
                <HardDrive className="w-3.5 h-3.5 text-blue-500" />
              </div>
            )}
          </div>
        )}

        {album.thumb_url ? (
          <img
            src={album.thumb_url}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="pt-2">
        <h4 className="font-medium text-sm truncate">{album.title}</h4>
        {showArtist && (
          <p className="text-xs text-muted-foreground truncate">{album.artist_name}</p>
        )}
        {album.year && (
          <p className="text-xs text-muted-foreground">{album.year}</p>
        )}
      </div>
    </div>
  )
})
