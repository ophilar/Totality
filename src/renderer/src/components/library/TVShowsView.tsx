import { useState, useEffect, useMemo, useCallback, memo, useRef } from 'react'
import { RefreshCw, MoreVertical, Pencil, Folder, CircleFadingArrowUp, EyeOff, Trash2, ChevronDown, ChevronUp, Copy, Check, HardDrive, Zap, Tv } from 'lucide-react'
import { MediaGridView } from './MediaGridView'
import { QualityBadges } from './QualityBadges'
import { TvPlaceholder, EpisodePlaceholder } from '../ui/MediaPlaceholders'
import { MissingItemCard } from './MissingItemCard'
import { SlimDownBanner } from './SlimDownBanner'
import { ShowCard } from './tv/ShowCard'
import { ShowListItem } from './tv/ShowListItem'
import { SeasonCard } from './tv/SeasonCard'
import { EpisodeRow } from './tv/EpisodeRow'
import { TVSeasonDetails } from './tv/TVSeasonDetails'
import { TVShowDetails } from './tv/TVShowDetails'
import { MissingSeasonCardWithArtwork } from './tv/MissingSeasonCardWithArtwork'
import { MissingEpisodeRowWithArtwork } from './tv/MissingEpisodeRowWithArtwork'
import { ConversionRecommendation } from './ConversionRecommendation'
import { useMenuClose } from '../../hooks/useMenuClose'
import { useSources } from '../../contexts/SourceContext'
import { providerColors, formatSeasonLabel, getStatusBadge } from './mediaUtils'
import type { MediaItem, TVShow, TVShowSummary, SeasonInfo, TVSeason, SeriesCompletenessData, MissingEpisode } from './types'
import type { ProviderType } from '../../contexts/SourceContext'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

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
  onRescanEpisode,
  onDismissUpgrade,
  onDismissMissingEpisode,
  onDismissMissingSeason,
  totalShowCount,
  totalEpisodeCount,
  showsLoading,
  onLoadMoreShows,
}: {
  shows: TVShowSummary[]
  sortBy: 'title' | 'efficiency' | 'waste' | 'size'
  onSortChange: (sort: 'title' | 'efficiency' | 'waste' | 'size') => void
  slimDown: boolean
  selectedShow: string | null
  selectedSeason: number | null
  selectedShowData: TVShow | null
  selectedShowLoading: boolean
  onSelectShow: (show: string | null) => void
  onSelectSeason: (season: number | null) => void
  onSelectEpisode: (id: number) => void
  filterItem: (item: MediaItem) => boolean
  gridScale: number
  viewType: 'grid' | 'list'
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onMissingItemClick: (item: {
    type: 'episode' | 'season' | 'movie'
    title: string
    year?: number
    airDate?: string
    seasonNumber?: number
    episodeNumber?: number
    posterUrl?: string
    tmdbId?: string
    imdbId?: string
    seriesTitle?: string
  } | null) => void
  showSourceBadge: boolean
  onAnalyzeSeries: (seriesTitle: string) => void
  onFixMatch?: (title: string, sourceId: string, folderPath?: string) => void
  onRescanEpisode?: (episode: MediaItem) => Promise<void>
  onDismissUpgrade?: (item: MediaItem) => void
  onDismissMissingEpisode?: (episode: MissingEpisode, seriesTitle: string, tmdbId?: string) => void
  onDismissMissingSeason?: (seasonNumber: number, seriesTitle: string, tmdbId?: string) => void
  totalShowCount: number
  totalEpisodeCount: number
  showsLoading: boolean
  onLoadMoreShows: () => void
  scrollElement?: HTMLElement | null
}) {
  const [expandedRecommendations, setExpandedRecommendations] = useState<Set<number>>(new Set())

  const toggleRecommendation = useCallback((id: number) => {
    setExpandedRecommendations(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const sortedShows = useMemo(() => {
    const items = [...shows]
    items.sort((a, b) => {
      if (sortBy === 'efficiency' || sortBy === 'waste' || sortBy === 'size') {
        const compA = seriesCompleteness.get(a.series_title)
        const compB = seriesCompleteness.get(b.series_title)

        if (sortBy === 'efficiency') {
          const effA = (compA as any)?.efficiency_score ?? 100
          const effB = (compB as any)?.efficiency_score ?? 100
          if (effA !== effB) return effA - effB
        } else if (sortBy === 'waste') {
          const wasteA = (compA as any)?.storage_debt_bytes ?? 0
          const wasteB = (compB as any)?.storage_debt_bytes ?? 0
          if (wasteA !== wasteB) return wasteB - wasteA
        } else if (sortBy === 'size') {
          const sizeA = (compA as any)?.total_size ?? 0
          const sizeB = (compB as any)?.total_size ?? 0
          if (sizeA !== sizeB) return sizeB - sizeA
        }
      }
      return a.series_title.localeCompare(b.series_title)
    })
    return items
  }, [shows, sortBy, seriesCompleteness])

  // Breadcrumb navigation
  const handleBack = () => {
    if (selectedSeason !== null) {
      onSelectSeason(null)
    } else if (selectedShow !== null) {
      onSelectShow(null)
    }
  }

  const [showDetailMenu, setShowDetailMenu] = useState(false)
  const [showOverviewExpanded, setShowOverviewExpanded] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  const [showOverview, setShowOverview] = useState<string | null>(null)
  const [prevSelectedShow, setPrevSelectedShow] = useState(selectedShow)

  // Adjust state when show selection changes (React 19 recommended pattern instead of useEffect)
  if (selectedShow !== prevSelectedShow) {
    setPrevSelectedShow(selectedShow)
    setShowOverviewExpanded(false)
    setCopiedTitle(false)
    setShowOverview(null)
  }

  const showDetailMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showDetailMenu) return
    const handleClick = (e: MouseEvent) => {
      if (showDetailMenuRef.current && !showDetailMenuRef.current.contains(e.target as Node)) {
        setShowDetailMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showDetailMenu])

  // Fetch show summary from TMDB when a show is selected
  useEffect(() => {
    if (selectedShow && !selectedSeason) {
      const completenessData = seriesCompleteness.get(selectedShow)
      if (completenessData?.tmdb_id) {
        window.electronAPI.tmdbGetTVShowDetails(completenessData.tmdb_id)
          .then(details => { if (details?.overview) setShowOverview(details.overview) })
          .catch(() => { /* ignore */ })
      }
    }
  }, [selectedShow, selectedSeason, seriesCompleteness])

  // IntersectionObserver for infinite scroll
  const showSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showSentinelRef.current || selectedShow) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) onLoadMoreShows() },
      { rootMargin: '400px' }
    )
    observer.observe(showSentinelRef.current)
    return () => observer.disconnect()
  }, [onLoadMoreShows, selectedShow])

  // Map scale to minimum poster width (same as movies)
  const posterMinWidth = useMemo(() => {
    const widthMap: Record<number, number> = {
      1: 120,  // Smallest posters
      2: 140,
      3: 160,
      4: 180,
      5: 200,  // Default
      6: 240,
      7: 300   // Largest posters
    }
    return widthMap[gridScale] || widthMap[5]
  }, [gridScale])

  const { isScanning, scanProgress } = useSources()
  const activeScan = Array.from(scanProgress.values())[0]

  // Show list view (top level - all shows)
  if (!selectedShow) {
    if (shows.length === 0 && !showsLoading) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center animate-in fade-in duration-700">
          {isScanning ? (
            <div className="flex flex-col items-center">
              <div className="relative mb-6">
                <RefreshCw className="w-16 h-16 text-primary animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Tv className="w-6 h-6 text-primary/50" />
                </div>
              </div>
              <p className="text-primary text-xl font-bold tracking-tight">Scan in Progress</p>
              <p className="text-sm text-muted-foreground/70 mt-2 max-w-xs leading-relaxed">
                {activeScan ? (
                  <>
                    Found <span className="text-foreground font-semibold">{totalShowCount}</span> shows so far...
                    <br />
                    Currently <span className="text-primary font-medium">{activeScan.phase}</span>
                    {activeScan.currentItem && <span className="block mt-1 italic text-[10px] truncate max-w-[200px] mx-auto opacity-80">{activeScan.currentItem}</span>}
                  </>
                ) : 'Discovering TV series in your libraries...'}
              </p>
            </div>
          ) : (
            <>
              <TvPlaceholder className="w-20 h-20 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-lg">No TV shows found</p>
              <p className="text-sm text-muted-foreground mt-2">
                Scan a TV library from the sidebar to get started
              </p>
            </>
          )}
        </div>
      )
    }

    const statsBar = (
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-6 text-sm text-muted-foreground">
          <span>{totalShowCount.toLocaleString()} Shows</span>
          <span className="text-muted-foreground/50">•</span>
          <span>{totalEpisodeCount.toLocaleString()} Episodes</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort by:</span>
          <div className="flex gap-1">
            <button
              onClick={() => onSortChange('title')}
              className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'title' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
            >
              Title
            </button>
            <button
              onClick={() => onSortChange('efficiency')}
              className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'efficiency' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
            >
              Efficiency
            </button>
            <button
              onClick={() => onSortChange('waste')}
              className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'waste' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
            >
              Waste
            </button>
            <button
              onClick={() => onSortChange('size')}
              className={`px-2 py-1 rounded text-xs transition-colors ${sortBy === 'size' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`}
            >
              Size
            </button>
          </div>
        </div>
      </div>
    )

    const isSlimDownActive = slimDown || sortBy === 'efficiency' || sortBy === 'waste' || sortBy === 'size'

    return (
      <MediaGridView
        items={sortedShows}
        totalCount={totalShowCount}
        loading={showsLoading}
        onLoadMore={onLoadMoreShows}
        viewType={viewType}
        posterMinWidth={posterMinWidth}
        statsBar={statsBar}
        emptyState={
          <div className="flex flex-col items-center justify-center text-center p-12">
            <TvPlaceholder className="w-24 h-24 text-muted-foreground/40 mb-6" />
            <p className="text-muted-foreground text-xl font-medium">No TV shows found</p>
            <p className="text-sm text-muted-foreground/70 mt-2 max-w-xs">
              Scan a TV library from the sidebar to start analyzing your collection
            </p>
          </div>
        }
        banner={isSlimDownActive ? <SlimDownBanner className="mb-4" /> : undefined}
        renderGridItem={(show) => (
          <div key={show.series_title} data-title={show.series_title}>
            <ShowCard
              show={show}
              onClick={() => onSelectShow(show.series_title)}
              completenessData={seriesCompleteness.get(show.series_title)}
              showSourceBadge={showSourceBadge}
              onAnalyzeSeries={() => onAnalyzeSeries(show.series_title)}
              onFixMatch={onFixMatch ? (sourceId, folderPath) => onFixMatch(show.series_title, sourceId, folderPath) : undefined}
            />
          </div>
        )}
        renderListItem={(show) => (
          <div key={show.series_title} data-title={show.series_title}>
            <ShowListItem
              show={show}
              onClick={() => onSelectShow(show.series_title)}
              completenessData={seriesCompleteness.get(show.series_title)}
              showSourceBadge={showSourceBadge}
              onAnalyzeSeries={async () => { await onAnalyzeSeries(show.series_title) }}
              onFixMatch={onFixMatch ? (sourceId, folderPath) => onFixMatch(show.series_title, sourceId, folderPath) : undefined}
            />
          </div>
        )}
      />
    )
  }

  // Season list view — use selectedShowData (loaded on demand)
  if (selectedShow && selectedSeason === null) {
    return (
      <TVShowDetails
        selectedShow={selectedShow}
        selectedShowData={selectedShowData}
        selectedShowLoading={selectedShowLoading}
        seriesCompleteness={seriesCompleteness}
        onBack={handleBack}
        onAnalyzeSeries={onAnalyzeSeries}
        onFixMatch={onFixMatch}
        onSelectSeason={onSelectSeason}
        onMissingItemClick={onMissingItemClick}
        onDismissMissingSeason={onDismissMissingSeason}
        posterMinWidth={posterMinWidth}
      />
    )
  }

  // Episode list view
  if (selectedShow && selectedSeason !== null && selectedShowData) {
    return (
      <TVSeasonDetails
        selectedShow={selectedShow}
        selectedSeason={selectedSeason}
        selectedShowData={selectedShowData}
        seriesCompleteness={seriesCompleteness}
        filterItem={filterItem}
        onBack={handleBack}
        onSelectEpisode={onSelectEpisode}
        onRescanEpisode={onRescanEpisode}
        onDismissUpgrade={onDismissUpgrade}
        expandedRecommendations={expandedRecommendations}
        onToggleOptimize={toggleRecommendation}
        onMissingItemClick={onMissingItemClick}
        onDismissMissingEpisode={onDismissMissingEpisode}
      />
    )
  }

  return null
}
