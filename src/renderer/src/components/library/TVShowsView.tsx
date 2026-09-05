import { useState, useMemo, useCallback, useRef } from 'react'
import { RefreshCw, Tv, HardDrive, Zap, X } from 'lucide-react'
import { ShowCard } from '@/components/library/tv/ShowCard'
import { ShowListItem } from '@/components/library/tv/ShowListItem'
import { TVShowDetails } from '@/components/library/tv/TVShowDetails'
import { getSortLabel, getSortOptions } from '@/components/library/sortDefinitions'
import { useSources } from '@/contexts/SourceContext'
import { MediaGridView } from '@/components/library/MediaGridView'
import { TvPlaceholder } from '@/components/ui/MediaPlaceholders'
import { LibraryEmptyState } from '@/components/library/browser/LibraryEmptyState'
import { calculatePosterWidth } from '@/components/library/mediaUtils'
import type { MediaItem, TVShow, TVShowSummary, SeriesCompletenessData, MissingEpisode, MissingItemPopupData } from '@/components/library/types'

const formatMB = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return '0 MB'
  const mb = Math.round(bytes / (1024 * 1024))
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB (${mb.toLocaleString()} MB)`
  }
  return `${mb.toLocaleString()} MB`
}

export function TVShowsView({
  shows,
  sortBy,
  sortOrder,
  onSortChange,
  slimDown: _slimDown,
  selectedShow,
  selectedShowData,
  selectedShowLoading,
  onSelectShow,
  onSelectEpisode,
  filterItem,
  gridScale,
  viewType,
  seriesCompleteness,
  onMissingItemClick,
  showSourceBadge,
  onAnalyzeSeries,
  onFixMatch,
  onDismissUpgrade,
  onRescanEpisode,
  onDismissMissingEpisode,
  onDismissMissingSeason,
  totalShowCount,
  showsLoading,
  onLoadMoreShows,
  isAnalyzing = false,
  onOptimizationDryRun,
  onRequestOptimization, onTranscodeShow
}: {
  shows: TVShowSummary[]
  sortBy: string
  sortOrder: 'asc' | 'desc'
  onSortChange: (sort: string) => void
  slimDown: boolean
  selectedShow: string | null
  selectedShowData: TVShow | null
  selectedShowLoading: boolean
  onSelectShow: (seriesTitle: string | null) => void
  onSelectEpisode: (id: number) => void
  filterItem: (item: MediaItem) => boolean
  gridScale: number
  viewType: 'grid' | 'list'
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onMissingItemClick: (item: MissingItemPopupData) => void
  showSourceBadge: boolean
  onAnalyzeSeries: (seriesTitle: string) => void
  onFixMatch?: (title: string, sourceId: string, folderPath?: string) => void
  onDismissUpgrade: (item: MediaItem) => void
  onRescanEpisode?: (episode: MediaItem) => Promise<void>
  onDismissMissingEpisode?: (episode: MissingEpisode, seriesTitle: string, tmdbId?: string) => void
  onDismissMissingSeason?: (seasonNumber: number, seriesTitle: string, tmdbId?: string) => void
  totalShowCount: number
  totalEpisodeCount?: number
  showsLoading: boolean
  onLoadMoreShows: () => void
  isAnalyzing?: boolean
  onOptimizationDryRun?: (show: TVShowSummary) => void
  onRequestOptimization?: (show: TVShowSummary) => void
  onTranscodeShow?: (show: TVShowSummary) => void
}) {
  const [expandedRecommendations, setExpandedRecommendations] = useState<Set<number>>(new Set())
  const [dryRunReport, setDryRunReport] = useState<{ show: TVShowSummary; report: Awaited<ReturnType<typeof window.electronAPI.optimizationDryRun>> } | null>(null)
  const detailScrollRef = useRef<HTMLDivElement>(null)
  const { isScanning, scanProgress } = useSources()
  const activeScan = Array.from(scanProgress.values())[0]

  const posterMinWidth = useMemo(() => calculatePosterWidth(gridScale), [gridScale])

  const handleBack = useCallback(() => onSelectShow(null), [onSelectShow])

  const toggleRecommendation = useCallback((id: number) => {
    setExpandedRecommendations(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleOptimizationDryRun = useCallback(async (show: TVShowSummary) => {
    if (onOptimizationDryRun) return onOptimizationDryRun(show)
    const report = await window.electronAPI.optimizationDryRun(show.series_title, show.source_id)
    setDryRunReport({ show, report })
  }, [onOptimizationDryRun])

  const handleOptimizationRequest = useCallback((show: TVShowSummary) => {
    if (onRequestOptimization) return onRequestOptimization(show)
    window.alert(`Opt-in Arr configuration is required before requesting optimization for ${show.series_title}.`)
  }, [onRequestOptimization])

  if (!selectedShow) {
    const listHeader = (
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Tv className="w-6 h-6 text-primary" /> TV Shows
            <span className="text-sm font-normal text-muted-foreground ml-2">{totalShowCount} shows</span>
          </h2>
          {activeScan && (
            <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium animate-pulse">
              <RefreshCw className="w-3 h-3 animate-spin" /> Scan: {activeScan.phase} ({Math.round(activeScan.percentage)}%)
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 bg-muted/50 p-1 rounded-lg">
          {getSortOptions('tv').map(s => (
              <button key={s.key} onClick={() => onSortChange(s.key)} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${sortBy === s.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{s.label}{sortBy === s.key ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}</button>
          ))}
        </div>
      </div>
    )

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <MediaGridView
          items={shows} totalCount={totalShowCount} viewType={viewType} loading={showsLoading} onLoadMore={onLoadMoreShows} posterMinWidth={posterMinWidth} banner={listHeader}
          scrollKey="shows"
          emptyState={
            <LibraryEmptyState
              isScanning={isScanning}
              scanProgress={activeScan ? { phase: activeScan.phase, currentItem: activeScan.currentItem } : undefined}
              totalCount={totalShowCount}
              icon={TvPlaceholder}
              title="No TV shows found"
              description="Scan a TV show library from the sidebar to start analyzing your collection"
            />
          }
          renderGridItem={(show) => (
            <ShowCard
              key={show.series_title} show={show} onClick={() => onSelectShow(show.series_title)}
              completenessData={seriesCompleteness.get(show.series_title)} showSourceBadge={showSourceBadge}
              onAnalyzeSeries={() => onAnalyzeSeries(show.series_title)}
              onOptimizationDryRun={() => { void handleOptimizationDryRun(show) }}
              onRequestOptimization={() => handleOptimizationRequest(show)}
              onTranscodeShow={onTranscodeShow ? () => onTranscodeShow(show) : undefined}
              onFixMatch={onFixMatch ? (sId, fp) => onFixMatch(show.series_title, sId, fp) : undefined}
              isLibraryAnalyzing={!!activeScan || isAnalyzing}
            />
          )}
          renderListItem={(show) => (
            <ShowListItem
              key={show.series_title} show={show} onClick={() => onSelectShow(show.series_title)}
              completenessData={seriesCompleteness.get(show.series_title)} showSourceBadge={showSourceBadge}
              onAnalyzeSeries={async () => onAnalyzeSeries(show.series_title)}
              onOptimizationDryRun={() => { void handleOptimizationDryRun(show) }}
              onRequestOptimization={() => handleOptimizationRequest(show)}
              onFixMatch={onFixMatch ? (sId, fp) => onFixMatch(show.series_title, sId, fp) : undefined}
              onTranscodeShow={onTranscodeShow ? () => onTranscodeShow(show) : undefined}
            />
          )}
          listHeader={
            <div className="mx-2 mb-2 flex items-center gap-4 rounded-md border-b border-border/50 bg-muted/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="w-16 shrink-0">Poster</span>
              <button className="flex-1 text-left hover:text-foreground" onClick={() => onSortChange('title')} aria-label="Sort TV shows by title">{getSortLabel('tv', 'title')}</button>
              <button className="w-32 text-left hover:text-foreground" onClick={() => onSortChange('recoverable')} aria-label="Sort TV shows by recoverable bytes">{getSortLabel('tv', 'recoverable')}</button>
              <button className="w-32 text-left hover:text-foreground" onClick={() => onSortChange('weighted_efficiency')} aria-label="Sort TV shows by weighted efficiency">{getSortLabel('tv', 'weighted_efficiency')}</button>
              <span className="w-8 shrink-0" />
            </div>
          }
        />
        {dryRunReport && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-bold truncate max-w-xs">{dryRunReport.show.series_title}</h3>
                </div>
                <button
                  onClick={() => setDryRunReport(null)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="p-3 bg-muted/20 rounded-xl border border-border/30">
                  <span className="text-xs text-muted-foreground block">Total Library Size</span>
                  <span className="text-base font-bold">{formatMB(dryRunReport.report.totalBytes || dryRunReport.show.total_size)}</span>
                </div>
                <div className="p-3 bg-muted/20 rounded-xl border border-border/30">
                  <span className="text-xs text-muted-foreground block">Estimated Recoverable</span>
                  <span className="text-base font-bold text-emerald-400">
                    {formatMB(dryRunReport.report.totalCombinedSavingsBytes || dryRunReport.report.recoverableBytes)}
                    {dryRunReport.report.percentageSavings > 0 && ` (${dryRunReport.report.percentageSavings.toFixed(1)}%)`}
                  </span>
                </div>
                <div className="p-3 bg-muted/20 rounded-xl border border-border/30">
                  <span className="text-xs text-muted-foreground block">Audio Track Pruning</span>
                  <span className="font-semibold">{formatMB(dryRunReport.report.recoverableBytes)}</span>
                </div>
                <div className="p-3 bg-muted/20 rounded-xl border border-border/30">
                  <span className="text-xs text-muted-foreground block">Video Transcode Debt</span>
                  <span className="font-semibold">{formatMB(dryRunReport.report.videoDebtBytes)}</span>
                </div>
                <div className="p-3 bg-muted/20 rounded-xl border border-border/30">
                  <span className="text-xs text-muted-foreground block">Episode Coverage</span>
                  <span className="font-semibold">
                    {dryRunReport.report.scoredEpisodes} / {dryRunReport.report.totalEpisodes} scored
                    {dryRunReport.report.unscoredEpisodes > 0 && ` (${dryRunReport.report.unscoredEpisodes} unscored)`}
                  </span>
                </div>
                <div className="p-3 bg-muted/20 rounded-xl border border-border/30">
                  <span className="text-xs text-muted-foreground block">Weighted Efficiency</span>
                  <span className="font-semibold">
                    {dryRunReport.report.weightedEfficiency != null ? `${Math.round(dryRunReport.report.weightedEfficiency)}%` : (dryRunReport.show.weighted_efficiency != null ? `${Math.round(dryRunReport.show.weighted_efficiency)}%` : 'N/A')}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-primary/5 rounded-xl border border-primary/20 text-xs text-muted-foreground flex items-center justify-between">
                <span>Recommendation:</span>
                <span className="font-bold text-foreground capitalize">{dryRunReport.report.action || 'No action needed'}</span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setDryRunReport(null)}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-sm font-semibold transition-all cursor-pointer"
                >
                  Close
                </button>
                {onTranscodeShow && (
                  <button
                    onClick={() => {
                      const s = dryRunReport.show
                      setDryRunReport(null)
                      onTranscodeShow(s)
                    }}
                    className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded-xl text-sm font-bold transition-all shadow-md shadow-primary/20 cursor-pointer"
                  >
                    <Zap className="w-4 h-4 fill-current" />
                    Optimize Series...
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (selectedShow) {
    return (
      <div ref={detailScrollRef} className="h-full overflow-y-auto">
        <TVShowDetails key={`${selectedShow}:${seriesCompleteness.get(selectedShow)?.tmdb_id ?? ''}`} scrollParentRef={detailScrollRef} selectedShow={selectedShow} selectedShowData={selectedShowData} selectedShowLoading={selectedShowLoading} seriesCompleteness={seriesCompleteness} onBack={handleBack} onAnalyzeSeries={onAnalyzeSeries} onFixMatch={onFixMatch ? (title, sId, fp) => onFixMatch(title, sId, fp) : undefined} filterItem={filterItem} onSelectEpisode={onSelectEpisode} onRescanEpisode={onRescanEpisode} onDismissUpgrade={onDismissUpgrade} expandedRecommendations={expandedRecommendations} onToggleOptimize={toggleRecommendation} onMissingItemClick={onMissingItemClick} onDismissMissingSeason={onDismissMissingSeason} onDismissMissingEpisode={onDismissMissingEpisode} onTranscodeShow={onTranscodeShow} />
      </div>
    )
  }

  return null
}
