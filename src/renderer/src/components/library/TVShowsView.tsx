import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { RefreshCw, Tv } from 'lucide-react'
import { SlimDownBanner } from './SlimDownBanner'
import { ShowCard } from './tv/ShowCard'
import { ShowListItem } from './tv/ShowListItem'
import { TVSeasonDetails } from './tv/TVSeasonDetails'
import { TVShowDetails } from './tv/TVShowDetails'
import { useSources } from '../../contexts/SourceContext'
import { MediaGridView } from './MediaGridView'
import { TvPlaceholder } from '../ui/MediaPlaceholders'
import type { MediaItem, TVShow, TVShowSummary, SeriesCompletenessData, MissingEpisode } from './types'

export function TVShowsView({
  shows,
  sortBy,
  onSortChange,
  slimDown,
  selectedShow,
  selectedSeason,
  selectedShowData,
  selectedShowLoading,
  onSelectShow,
  onSelectSeason,
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
  onLoadMoreShows
}: {
  shows: TVShowSummary[]
  sortBy: string
  onSortChange: (sort: string) => void
  slimDown: boolean
  selectedShow: string | null
  selectedSeason: number | null
  selectedShowData: TVShow | null
  selectedShowLoading: boolean
  onSelectShow: (seriesTitle: string | null) => void
  onSelectSeason: (season: number | null) => void
  onSelectEpisode: (id: number) => void
  filterItem: (item: MediaItem) => boolean
  gridScale: number
  viewType: 'grid' | 'list'
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onMissingItemClick: (item: any) => void
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
  scrollElement?: HTMLElement | null
}) {
  const [expandedRecommendations, setExpandedRecommendations] = useState<Set<number>>(new Set())
  const { scanProgress } = useSources()
  const activeScan = Array.from(scanProgress.values())[0]

  const posterMinWidth = useMemo(() => 120 + gridScale * 15, [gridScale])

  const handleBack = useCallback(() => {
    if (selectedSeason !== null) onSelectSeason(null)
    else onSelectShow(null)
  }, [selectedSeason, onSelectSeason, onSelectShow])

  const toggleRecommendation = useCallback((id: number) => {
    setExpandedRecommendations(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const showSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showSentinelRef.current || showsLoading || shows.length >= totalShowCount) return
    const observer = new IntersectionObserver(entries => {
      if (observer && entries[0].isIntersecting) onLoadMoreShows()
    }, { rootMargin: '400px' })
    observer.observe(showSentinelRef.current)
    return () => observer.disconnect()
  }, [shows.length, totalShowCount, showsLoading, onLoadMoreShows])

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
          {['title', 'efficiency', 'waste'].map(s => (
            <button key={s} onClick={() => onSortChange(s)} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize ${sortBy === s ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{s}</button>
          ))}
        </div>
      </div>
    )

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {slimDown && <SlimDownBanner className="mb-4" />}
        <MediaGridView
          items={shows} totalCount={totalShowCount} viewType={viewType} loading={showsLoading} onLoadMore={onLoadMoreShows} posterMinWidth={posterMinWidth} banner={listHeader}
          emptyState={<div className="flex flex-col items-center justify-center py-20 opacity-40"><TvPlaceholder className="w-24 h-24 mb-6" /><p className="text-lg font-medium">No TV shows found</p></div>}
          renderGridItem={(show) => (
            <ShowCard
              key={show.series_title} show={show} onClick={() => onSelectShow(show.series_title)}
              completenessData={seriesCompleteness.get(show.series_title)} showSourceBadge={showSourceBadge}
              onAnalyzeSeries={() => onAnalyzeSeries(show.series_title)}
              onFixMatch={onFixMatch ? (sId, fp) => onFixMatch(show.series_title, sId, fp) : undefined}
            />
          )}
          renderListItem={(show) => (
            <ShowListItem
              key={show.series_title} show={show} onClick={() => onSelectShow(show.series_title)}
              completenessData={seriesCompleteness.get(show.series_title)} showSourceBadge={showSourceBadge}
              onAnalyzeSeries={async () => onAnalyzeSeries(show.series_title)}
              onFixMatch={onFixMatch ? (sId, fp) => onFixMatch(show.series_title, sId, fp) : undefined}
            />
          )}
        />
        <div ref={showSentinelRef} className="h-4 w-full" />
      </div>
    )
  }

  if (selectedShow && selectedSeason === null) {
    return <TVShowDetails selectedShow={selectedShow} selectedShowData={selectedShowData} selectedShowLoading={selectedShowLoading} seriesCompleteness={seriesCompleteness} onBack={handleBack} onAnalyzeSeries={onAnalyzeSeries} onFixMatch={onFixMatch ? (title, sId, fp) => onFixMatch(title, sId, fp) : undefined} onSelectSeason={onSelectSeason} onMissingItemClick={onMissingItemClick} onDismissMissingSeason={onDismissMissingSeason} posterMinWidth={posterMinWidth} />
  }


  if (selectedShow && selectedSeason !== null && selectedShowData) {
    return <TVSeasonDetails selectedShow={selectedShow} selectedSeason={selectedSeason} selectedShowData={selectedShowData} seriesCompleteness={seriesCompleteness} filterItem={filterItem} onBack={handleBack} onSelectEpisode={onSelectEpisode} onRescanEpisode={onRescanEpisode} onDismissUpgrade={onDismissUpgrade} expandedRecommendations={expandedRecommendations} onToggleOptimize={toggleRecommendation} onMissingItemClick={onMissingItemClick} onDismissMissingEpisode={onDismissMissingEpisode} />
  }

  return null
}
