import { useState, memo, useRef } from 'react'
import { RefreshCw, Pencil, HardDrive, Tv as TvPlaceholder, Link2Off, Zap } from 'lucide-react'
import { ActionMenu, MenuItem } from '@/components/ui/ActionMenu'
import { providerColors } from '@/components/library/mediaUtils'
import type { TVShowSummary, SeriesCompletenessData, ProviderType } from '@/components/library/types'
import { MediaMetricsRow } from '@/components/library/MediaMetricsRow'

export const ShowCard = memo(({ show, onClick, completenessData, showSourceBadge, onAnalyzeSeries, onFixMatch, onOptimizationDryRun, onRequestOptimization, onTranscodeShow, isLibraryAnalyzing }: {
  show: TVShowSummary
  onClick: () => void
  completenessData?: SeriesCompletenessData
  showSourceBadge?: boolean
  onAnalyzeSeries?: () => void
  onFixMatch?: (sourceId: string, folderPath?: string) => void
  onOptimizationDryRun?: () => void
  onRequestOptimization?: () => void
  onTranscodeShow?: () => void
  isLibraryAnalyzing?: boolean
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const sourceType = show.source_type as ProviderType | undefined
  const sourceId = show.source_id
  const folderPath: string | undefined = undefined

  const menuItems: MenuItem[] = []

  if (onAnalyzeSeries) {
    menuItems.push({
      id: 'analyze',
      label: 'Analyze Series',
      icon: RefreshCw,
      onClick: async () => {
        setIsAnalyzing(true)
        try {
          await onAnalyzeSeries()
        } finally {
          setIsAnalyzing(false)
        }
      }
    })
  }

  if (onFixMatch && sourceId && (show.match_status === 'unresolved' || show.match_status === 'conflicting')) {
    menuItems.push({
      id: 'fix-match',
      label: 'Fix Match',
      icon: Pencil,
      onClick: () => {
        onFixMatch(sourceId, folderPath)
      }
    })
  }

  if (onOptimizationDryRun) {
    menuItems.push({
      id: 'dry-run-optimization',
      label: 'Dry-run optimization',
      icon: HardDrive,
      onClick: () => {
        onOptimizationDryRun()
      }
    })
  }

  if (onRequestOptimization) {
    menuItems.push({
      id: 'request-optimization',
      label: 'Request optimization',
      icon: HardDrive,
      onClick: () => {
        onRequestOptimization()
      }
    })
  }

  if (onTranscodeShow) menuItems.push({ id: 'transcode-show', label: 'Optimize Series', icon: Zap, onClick: onTranscodeShow })

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className={`focus-poster-only cursor-pointer hover-scale relative group outline-hidden ${isMenuOpen ? 'z-50' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="aspect-2/3 bg-muted relative rounded-md shadow-lg shadow-black/30">
        <div className="absolute inset-0 overflow-hidden rounded-md">
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
          {completenessData && completenessData.efficiency_score === null && isLibraryAnalyzing && (
            <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center backdrop-blur-[1px] animate-in fade-in duration-500">
              <RefreshCw className="w-8 h-8 text-primary animate-spin mb-2" />
              <span className="text-[10px] font-bold text-white uppercase tracking-widest shadow-sm">Analyzing</span>
            </div>
          )}
        </div>

        {show.match_status && show.match_status !== 'verified' && (
          <div className="absolute top-2 left-2 z-10 rounded bg-black/70 px-2 py-1 text-xs text-white">
            {show.match_status === 'manual' ? 'Manual match' : show.match_status === 'conflicting' ? 'Conflicting match' : 'Unresolved match'}
          </div>
        )}
        {/* 3-dot menu button */}
        {menuItems.length > 0 && (
          <div className="absolute top-2 right-2 z-30">
            <ActionMenu
              items={menuItems}
              isWorking={isAnalyzing}
              menuPosition="right"
              onOpenChange={setIsMenuOpen}
            />
          </div>
        )}

        {/* Source Badge */}
        {showSourceBadge && sourceType && (
          <div
            className={`absolute bottom-2 left-2 ${providerColors[sourceType] || 'bg-gray-500'} text-white text-xs font-bold px-1.5 py-0.5 rounded shadow-md`}
            title={sourceType.charAt(0).toUpperCase() + sourceType.slice(1)}
          >
            {sourceType.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Title and info below poster */}
      <div className="pt-2 flex gap-2 items-start">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm line-clamp-2 break-words leading-tight" title={show.series_title}>{show.series_title}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {show.season_count} {show.season_count === 1 ? 'Season' : 'Seasons'} • {show.episode_count} {show.episode_count === 1 ? 'Episode' : 'Episodes'}
          </p>
          <MediaMetricsRow
            fileSize={show.total_size}
            storageDebtBytes={show.total_recoverable_bytes}
            efficiencyScore={show.weighted_efficiency}
            evidenceStatus={show.evidence_status}
          />
        </div>

        {completenessData && (
          <div
            className="shrink-0"
            title={
              completenessData.completeness_percentage == null
                ? 'Unmatched: No completeness data available'
                : `${completenessData.owned_episodes} of ${completenessData.total_episodes} episodes`
            }
          >
            {completenessData.completeness_percentage === 100 ? (
              <div className="bg-green-500 text-white text-xs font-bold px-2 py-1 rounded shadow-md flex items-center gap-1">
                <svg
                  className="w-3 h-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                100%
              </div>
            ) : completenessData.completeness_percentage == null ? (
              <div
                className="bg-muted text-muted-foreground px-1.5 py-1 rounded shadow-md border border-border flex items-center justify-center"
                title="Unmatched"
              >
                <Link2Off className="w-3.5 h-3.5" />
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
})
