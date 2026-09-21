import { useState, useMemo, useCallback, useRef } from 'react'
import { RefreshCw, Tv } from 'lucide-react'
import { ShowCard } from '@/components/library/tv/ShowCard'
import { ShowListItem } from '@/components/library/tv/ShowListItem'
import { TVShowDetails } from '@/components/library/tv/TVShowDetails'
import { getTVShowIdentityKey } from '@/components/library/tv/showIdentity'
import { getSortLabel, getSortOptions } from '@/components/library/sortDefinitions'
import { useSources } from '@/contexts/SourceContext'
import { MediaGridView } from '@/components/library/MediaGridView'
import { TvPlaceholder } from '@/components/ui/MediaPlaceholders'
import { LibraryEmptyState } from '@/components/library/browser/LibraryEmptyState'
import { calculatePosterWidth } from '@/components/library/mediaUtils'
import type { MediaItem, TVShow, TVShowSummary, SeriesCompletenessData, MissingEpisode, MissingItemPopupData } from '@/components/library/types'

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
  onTranscodeShow
}: {
  shows: TVShowSummary[]
  sortBy: string
  sortOrder: 'asc' | 'desc'
  onSortChange: (sort: string) => void
  slimDown: boolean
  selectedShow: TVShowSummary | null
  selectedShowData: TVShow | null
  selectedShowLoading: boolean
  onSelectShow: (show: TVShowSummary | null) => void
  onSelectEpisode: (id: number) => void
  filterItem: (item: MediaItem) => boolean
  gridScale: number
  viewType: 'grid' | 'list'
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onMissingItemClick: (item: MissingItemPopupData) => void
  showSourceBadge: boolean
  onAnalyzeSeries: (show: TVShowSummary) => Promise<void> | void
  onFixMatch?: (show: TVShowSummary, folderPath?: string) => void
  onDismissUpgrade: (item: MediaItem) => void
  onRescanEpisode?: (episode: MediaItem) => Promise<void>
  onDismissMissingEpisode?: (episode: MissingEpisode, seriesTitle: string, tmdbId: string | undefined, seriesMapKey: string) => void
  onDismissMissingSeason?: (seasonNumber: number, seriesTitle: string, tmdbId: string | undefined, seriesMapKey: string) => void
  totalShowCount: number
  totalEpisodeCount?: number
  showsLoading: boolean
  onLoadMoreShows: () => void
  isAnalyzing?: boolean
  onTranscodeShow?: (show: TVShowSummary) => void
}) {
  const [expandedRecommendations, setExpandedRecommendations] = useState<Set<number>>(new Set())
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
              key={getTVShowIdentityKey(show)} show={show} onClick={() => onSelectShow(show)}
              completenessData={seriesCompleteness.get(getTVShowIdentityKey(show))} showSourceBadge={showSourceBadge}
              onAnalyzeSeries={() => onAnalyzeSeries(show)}
              onTranscodeShow={onTranscodeShow ? () => onTranscodeShow(show) : undefined}
              onFixMatch={onFixMatch ? (_sId, fp) => onFixMatch(show, fp) : undefined}
              isLibraryAnalyzing={!!activeScan || isAnalyzing}
            />
          )}
          renderListItem={(show) => (
            <ShowListItem
              key={getTVShowIdentityKey(show)} show={show} onClick={() => onSelectShow(show)}
              completenessData={seriesCompleteness.get(getTVShowIdentityKey(show))} showSourceBadge={showSourceBadge}
              onAnalyzeSeries={async () => { await onAnalyzeSeries(show) }}
              onFixMatch={onFixMatch ? (_sId, fp) => onFixMatch(show, fp) : undefined}
              onTranscodeShow={onTranscodeShow ? () => onTranscodeShow(show) : undefined}
            />
          )}
          listHeader={
            <div className="mx-2 mb-2 flex items-center gap-4 rounded-md border-b border-border/50 bg-muted/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span className="w-16 shrink-0">Poster</span>
              <button className="flex-1 text-left hover:text-foreground" onClick={() => onSortChange('title')} aria-label="Sort TV shows by title">{getSortLabel('tv', 'title')}</button>
              <button className="w-32 text-left hover:text-foreground" onClick={() => onSortChange('recoverable')} aria-label="Sort TV shows by total debt">{getSortLabel('tv', 'recoverable')}</button>
              <button className="w-32 text-left hover:text-foreground" onClick={() => onSortChange('weighted_efficiency')} aria-label="Sort TV shows by weighted efficiency">{getSortLabel('tv', 'weighted_efficiency')}</button>
              <span className="w-8 shrink-0" />
            </div>
          }
        />
      </div>
    )
  }

  if (selectedShow) {
    const completenessData = seriesCompleteness.get(getTVShowIdentityKey(selectedShow))
    return (
      <div ref={detailScrollRef} className="h-full overflow-y-auto">
        <TVShowDetails
          key={getTVShowIdentityKey(selectedShow)}
          scrollParentRef={detailScrollRef}
          selectedShow={selectedShow}
          selectedShowData={selectedShowData}
          selectedShowLoading={selectedShowLoading}
          completenessData={completenessData}
          onBack={handleBack}
          onAnalyzeSeries={onAnalyzeSeries}
          onFixMatch={onFixMatch}
          filterItem={filterItem}
          onSelectEpisode={onSelectEpisode}
          onRescanEpisode={onRescanEpisode}
          onDismissUpgrade={onDismissUpgrade}
          expandedRecommendations={expandedRecommendations}
          onToggleOptimize={toggleRecommendation}
          onMissingItemClick={onMissingItemClick}
          onDismissMissingSeason={onDismissMissingSeason}
          onDismissMissingEpisode={onDismissMissingEpisode}
          onTranscodeShow={onTranscodeShow}
        />
      </div>
    )
  }

  return null
}
