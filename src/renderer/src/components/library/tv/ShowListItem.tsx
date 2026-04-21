import { useState, useCallback, memo, useRef } from 'react'
import { RefreshCw, MoreVertical, Pencil } from 'lucide-react'
import { TvPlaceholder } from '../../ui/MediaPlaceholders'
import { useMenuClose } from '../../../hooks/useMenuClose'
import { providerColors, getStatusBadge } from '../mediaUtils'
import type { TVShowSummary, SeriesCompletenessData, ProviderType } from '../types'

export const ShowListItem = memo(({ show, onClick, completenessData, showSourceBadge, onAnalyzeSeries, onFixMatch }: {
  show: TVShowSummary
  onClick: () => void
  completenessData?: SeriesCompletenessData
  showSourceBadge?: boolean
  onAnalyzeSeries?: () => Promise<void>
  onFixMatch?: (sourceId: string, folderPath?: string) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const totalEpisodes = show.episode_count
  const seasonCount = show.season_count
  const sourceType = show.source_type as ProviderType | undefined
  const sourceId = show.source_id
  const folderPath: string | undefined = undefined

  const handleAnalyze = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onAnalyzeSeries) {
      setIsAnalyzing(true)
      await onAnalyzeSeries()
      setIsAnalyzing(false)
    }
  }

  const handleFixMatch = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onFixMatch && sourceId) {
      onFixMatch(sourceId, folderPath)
    }
  }

  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

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
        {show.poster_url ? (
          <img
            src={show.poster_url}
            alt={show.series_title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><TvPlaceholder className="w-8 h-8 text-muted-foreground" /></div>
        )}
        {/* Source badge */}
        {showSourceBadge && sourceType && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-xs font-bold px-1 py-0.5 rounded`}
          >
            {sourceType.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{show.series_title}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">
          {seasonCount} {seasonCount === 1 ? 'Season' : 'Seasons'} • {totalEpisodes} Episodes
          {completenessData?.status && ` • ${getStatusBadge(completenessData.status)?.text || completenessData.status}`}
        </p>
        {completenessData && (
          <div className="mt-2">
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
              {completenessData.owned_episodes}/{completenessData.total_episodes}
            </span>
          </div>
        )}
      </div>

      {/* 3-dot menu */}
      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {isAnalyzing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <MoreVertical className="w-4 h-4" />
          )}
        </button>

        {/* Dropdown menu */}
        {showMenu && (
          <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px] z-20">
            <button
              onClick={handleAnalyze}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Analyze Series
            </button>
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
    </div>
  )
})
