import { useState, useCallback, memo, useRef } from 'react'
import { RefreshCw, MoreVertical, Pencil, Trash2, HardDrive, Tv as TvPlaceholder } from 'lucide-react'
import { useMenuClose } from '@/hooks/useMenuClose'
import { providerColors } from '@/components/library/mediaUtils'
import type { TVShowSummary, SeriesCompletenessData, ProviderType } from '@/components/library/types'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const ShowCard = memo(({ show, onClick, completenessData, showSourceBadge, onAnalyzeSeries, onFixMatch }: {
  show: TVShowSummary
  onClick: () => void
  completenessData?: SeriesCompletenessData
  showSourceBadge?: boolean
  onAnalyzeSeries?: () => void
  onFixMatch?: (sourceId: string, folderPath?: string) => void
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const totalEpisodes = show.episode_count
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

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only cursor-pointer hover-scale relative group outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {/* 3-dot menu button */}
        <div ref={menuRef} className="absolute top-2 left-2 z-20">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {isAnalyzing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <MoreVertical className="w-4 h-4" />
            )}
          </button>

          {/* Dropdown menu */}
          {showMenu && (
            <div className="absolute top-8 left-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px]">
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

        {/* Source Badge */}
        {showSourceBadge && sourceType && (
          <div
            className={`absolute bottom-2 left-2 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
            title={sourceType.charAt(0).toUpperCase() + sourceType.slice(1)}
          >
            {sourceType.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Efficiency Trash Badge */}
        {completenessData && (completenessData as any).efficiency_score != null && (completenessData as any).efficiency_score < 60 && (
          <div
            className="absolute bottom-2 right-2"
            title={`Low Efficiency (${(completenessData as any).efficiency_score}%). Upgrade recommended to save space.`}
          >
            <Trash2 className="w-6 h-6 text-orange-500 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]" />
          </div>
        )}

        {/* Storage Debt Badge */}
        {completenessData && (completenessData as any).storage_debt_bytes != null && (completenessData as any).storage_debt_bytes > 10 * 1024 * 1024 * 1024 && (
          <div
            className="absolute bottom-2 right-10"
            title={`Significant Storage Debt (${formatBytes((completenessData as any).storage_debt_bytes)}). Re-encode to save massive space.`}
          >
            <HardDrive className="w-6 h-6 text-blue-500 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]" />
          </div>
        )}

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
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><TvPlaceholder className="w-20 h-20 text-muted-foreground" /></div>
        )}

        {/* Analyzing Overlay */}
        {completenessData && (completenessData as any).efficiency_score === null && (
          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center backdrop-blur-[1px] animate-in fade-in duration-500">
            <RefreshCw className="w-8 h-8 text-primary animate-spin mb-2" />
            <span className="text-[10px] font-bold text-white uppercase tracking-widest shadow-sm">Analyzing</span>
          </div>
        )}
      </div>

      {/* Title and info below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{show.series_title}</h4>
          <p className="text-xs text-muted-foreground">
            {show.season_count} {show.season_count === 1 ? 'Season' : 'Seasons'} • {totalEpisodes} Episodes
          </p>
        </div>
        {completenessData && (
          <div
            className="shrink-0"
            title={`${completenessData.owned_episodes} of ${completenessData.total_episodes} episodes`}
          >
            {completenessData.completeness_percentage === 100 ? (
              <div className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                100%
              </div>
            ) : (
              <div className="bg-foreground text-background text-xs font-bold px-2 py-1 rounded shadow-md border border-border">
                {Math.round(completenessData.completeness_percentage)}%
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.show.series_title === nextProps.show.series_title &&
         prevProps.show.poster_url === nextProps.show.poster_url &&
         prevProps.show.episode_count === nextProps.show.episode_count &&
         prevProps.show.season_count === nextProps.show.season_count &&
         prevProps.showSourceBadge === nextProps.showSourceBadge &&
         prevProps.completenessData?.id === nextProps.completenessData?.id &&
         prevProps.completenessData?.completeness_percentage === nextProps.completenessData?.completeness_percentage &&
         prevProps.onAnalyzeSeries === nextProps.onAnalyzeSeries
})
