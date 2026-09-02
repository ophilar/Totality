import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary'
import { MediaDetails } from '@/components/library/MediaDetails'
import { CompletenessPanel } from '@/components/library/CompletenessPanel'
import { MissingItemPopup } from '@/components/library/MissingItemPopup'
import { CollectionModal } from '@/components/library/CollectionModal'
import { MatchFixModal } from '@/components/library/MatchFixModal'
import { WishlistPanel } from '@/components/wishlist/WishlistPanel'
import { MoviesView } from '@/components/library/MoviesView'
import { TVShowsView } from '@/components/library/TVShowsView'
import { MusicView } from '@/components/library/MusicView'
import { WishlistView } from '@/components/library/WishlistView'
import { DuplicatesView } from '@/components/library/DuplicatesView'
import { TimelinesView } from '@/components/timelines/TimelinesView'

import { ShowTranscodeModal } from '@/components/library/ShowTranscodeModal'
import { PinEntryModal } from '@/components/library/PinEntryModal'
import { BrowserHeader } from '@/components/library/browser/BrowserHeader'
import { BrowserFilterBar } from '@/components/library/browser/BrowserFilterBar'
import { BrowserAlphabetNav } from '@/components/library/browser/BrowserAlphabetNav'

import { useSources } from '@/contexts/SourceContext'
import { nextSortDirection } from '@/components/library/sortDefinitions'
import { useWishlist } from '@/contexts/WishlistContext'
import { useToast } from '@/contexts/ToastContext'
import { useLibrary } from '@/contexts/LibraryContext'
import { emitDismissUpgrade } from '@/utils/dismissEvents'
import { usePaginatedData } from '@/hooks/usePaginatedData'

import { useThemeAccent } from '@/components/library/hooks/useThemeAccent'
import { usePanelState } from '@/components/library/hooks/usePanelState'
import { useLibraryFilters } from '@/components/library/hooks/useLibraryFilters'
import { useCollections } from '@/components/library/hooks/useCollections'
import { useMediaActions } from '@/components/library/hooks/useMediaActions'
import { useAnalysisManager } from '@/components/library/hooks/useAnalysisManager'
import { useDismissHandlers } from '@/components/library/hooks/useDismissHandlers'
import { useLibraryEventListeners } from '@/components/library/hooks/useLibraryEventListeners'
import { useGlobalSearch } from '@/components/library/hooks/useGlobalSearch'

import {
  MusicArtist,
  MusicAlbum,
  MusicTrack,
  MediaItem,
  TVShow,
  TVShowSummary,
  TVSeason,
  LibraryStats,
  SeriesCompletenessData,
  MovieCollectionData,
  ArtistCompletenessData,
  AlbumCompletenessData,
  MediaBrowserProps,
} from '@/components/library/types'
import type { MediaItemFilters, TVShowFilters, MusicFilters } from '@main/types/database'
import type { MediaLibraryResponse } from '@preload/api/types'

export function MediaBrowser({
  onOpenSettings,
  onNavigateHome,
  hideHeader = false,
  showCompletenessPanel: externalShowCompletenessPanel,
  showWishlistPanel: externalShowWishlistPanel,
  showChatPanel: externalShowChatPanel,
  onToggleCompleteness: externalToggleCompleteness,
  onToggleWishlist: externalToggleWishlist,
  onToggleChat: externalToggleChat,
  onAutoRefreshChange
}: MediaBrowserProps) {
  const {
    view, setView,
    qualityFilter, setQualityFilter,
    gridScale, setGridScale,
    viewType, setViewType,
    selectedItemId: selectedMediaId, setSelectedMedia: setSelectedMediaId,
    sortBy, setSortBy, sortOrder, setSortOrder,
    setActiveSourceId: setContextActiveSourceId,
    selectedShow, setSelectedShow,
    selectedArtist, setSelectedArtist,
    selectedAlbum, setSelectedAlbum,
    searchQuery,
    groupByCollections, setGroupByCollections
  } = useLibrary()

  const { sources, activeSourceId, setActiveSource, markLibraryAsNew } = useSources()

  useEffect(() => {
    queueMicrotask(() => { setContextActiveSourceId(activeSourceId) })
  }, [activeSourceId, setContextActiveSourceId])

  const { addToast } = useToast()
  const { count: wishlistCount } = useWishlist()
  const themeAccentColor = useThemeAccent()

  const {
    showCompletenessPanel,
    showWishlistPanel,
    setShowCompletenessPanel,
    setShowWishlistPanel,
  } = usePanelState({
    externalShowCompletenessPanel,
    externalShowWishlistPanel,
    externalShowChatPanel,
    onToggleCompleteness: externalToggleCompleteness,
    onToggleWishlist: externalToggleWishlist,
    onToggleChat: externalToggleChat,
  })

  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)

  // Sync auto-refresh state to parent
  useEffect(() => {
    onAutoRefreshChange?.(isAutoRefreshing)
  }, [isAutoRefreshing, onAutoRefreshChange])

  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [hasMusic, setHasMusic] = useState(false)
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null)
  const [albumSortColumn, setAlbumSortColumn] = useState<'title' | 'artist'>('title')
  const [albumSortDirection, setAlbumSortDirection] = useState<'asc' | 'desc'>('asc')
  const [trackSortColumn, setTrackSortColumn] = useState<'title' | 'album' | 'artist' | 'codec' | 'duration'>('title')
  const [trackSortDirection, setTrackSortDirection] = useState<'asc' | 'desc'>('asc')

  const [musicViewMode, setMusicViewMode] = useState<'artists' | 'albums' | 'tracks'>('artists')
  const [seriesCompleteness, setSeriesCompleteness] = useState<Map<string, SeriesCompletenessData>>(new Map())
  const [movieCollections, setMovieCollections] = useState<MovieCollectionData[]>([])
  const [artistCompleteness, setArtistCompleteness] = useState<Map<string, ArtistCompletenessData>>(new Map())
  const [allAlbumCompleteness] = useState<Map<number, AlbumCompletenessData>>(new Map())
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)
  const [isUnlocked, setIsUnlocked] = useState(false)
  const [showPinModal, setShowPinModal] = useState(false)
  const [collectionsOnly, setCollectionsOnly] = useState(false)
  const [selectedShowEpisodes, setSelectedShowEpisodes] = useState<MediaItem[]>([])
  const [showTranscodeTarget, setShowTranscodeTarget] = useState<TVShowSummary | null>(null)
  const [selectedShowEpisodesLoading, setSelectedShowEpisodesLoading] = useState(false)
  const [albumTracks, setAlbumTracks] = useState<MusicTrack[]>([])
  const [albumTracksLoading, setAlbumTracksLoading] = useState(false)
  const [selectedAlbumCompleteness, setSelectedAlbumCompleteness] = useState<AlbumCompletenessData | null>(null)
  const [activeSourceLibraries, setActiveSourceLibraries] = useState<Array<MediaLibraryResponse & { isEnabled: boolean; isProtected: boolean; allowExpandedMatching: boolean; lastScanAt: string | null }>>([])
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const handleSortChange = useCallback((nextSort: string) => {
    if (nextSort === sortBy) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    else {
      setSortBy(nextSort)
      setSortOrder(nextSortDirection(sortBy, nextSort, sortOrder))
    }
  }, [setSortBy, setSortOrder, sortBy, sortOrder])

  // PAGINATION HOOKS
  const {
    items: movies,
    totalCount: totalMovieCount,
    loading: moviesLoading,
    loadMore: loadMoreMovies,
    refresh: refreshMovies,
    setItems: setMovies,
    setFilters: setMoviesFilters
  } = usePaginatedData<MediaItem, MediaItemFilters>({
    fetchFn: window.electronAPI.getMediaItems,
    countFn: window.electronAPI.countMediaItems,
    pageSize: 200,
    initialFilters: { type: 'movie', sortBy: 'title', sortOrder: 'asc' },
    activeSourceId,
    enabled: view === 'movies'
  })

  const {
    items: shows,
    totalCount: totalShowCount,
    loading: showsLoading,
    loadMore: loadMoreShows,
    refresh: refreshShows,
    setFilters: setShowsFilters
  } = usePaginatedData<TVShowSummary, TVShowFilters>({
    fetchFn: window.electronAPI.getTVShows,
    countFn: window.electronAPI.countTVShows,
    pageSize: 200,
    initialFilters: { sortBy: 'title', sortOrder: 'asc' },
    activeSourceId,
    enabled: view === 'tv'
  })

  const {
    items: musicArtists,
    totalCount: totalArtistCount,
    loading: artistsLoading,
    loadMore: loadMoreArtists,
    setFilters: setArtistsFilters
  } = usePaginatedData<MusicArtist, MusicFilters>({
    fetchFn: window.electronAPI.musicArtistList,
    countFn: window.electronAPI.musicArtistCount,
    pageSize: 50,
    initialFilters: { sortBy: 'name', sortOrder: 'asc' },
    activeSourceId,
    enabled: view === 'music' && musicViewMode === 'artists'
  })

  const {
    items: musicAlbums,
    totalCount: totalAlbumCount,
    loading: albumsLoading,
    loadMore: loadMoreAlbums,
    setFilters: setAlbumsFilters
  } = usePaginatedData<MusicAlbum, MusicFilters>({
    fetchFn: window.electronAPI.musicAlbumList,
    countFn: window.electronAPI.musicAlbumCount,
    pageSize: 200,
    initialFilters: { sortBy: 'title', sortOrder: 'asc' },
    activeSourceId,
    enabled: view === 'music' && musicViewMode === 'albums'
  })

  const {
    items: allMusicTracks,
    totalCount: totalTrackCount,
    loading: tracksLoading,
    loadMore: loadMoreTracks,
    setFilters: setTracksFilters
  } = usePaginatedData<MusicTrack, MusicFilters>({
    fetchFn: window.electronAPI.musicTrackList,
    countFn: window.electronAPI.musicTrackCount,
    pageSize: 500,
    initialFilters: { sortBy: 'title', sortOrder: 'asc' },
    activeSourceId,
    enabled: view === 'music' && musicViewMode === 'tracks'
  })

  // Filters
  const [searchInput, setSearchInput] = useState('')
  const { tierFilter, setTierFilter, alphabetFilter, setAlphabetFilter, slimDown, setSlimDown } = useLibraryFilters(searchInput)

  useEffect(() => {
    const commonFilters = {
      sortBy: sortBy === 'waste' ? 'storage_debt' : sortBy,
      sortOrder,
      qualityTier: tierFilter !== 'all' ? tierFilter : undefined,
      tierQuality: qualityFilter !== 'all' ? qualityFilter : undefined,
      alphabetFilter: alphabetFilter || undefined,
      searchQuery: searchInput.trim() || undefined,
      libraryId: activeLibraryId || undefined,
      slimDown: slimDown || undefined
    }

    if (view === 'movies') setMoviesFilters({ ...commonFilters, type: 'movie' } as MediaItemFilters)
    else if (view === 'tv') setShowsFilters({ ...commonFilters } as TVShowFilters)
    else if (view === 'music') {
      const musicSortBy = sortBy === 'waste' ? 'storage_debt' : sortBy
      const validArtistSorts = ['name', 'album_count', 'track_count', 'storage_debt', 'efficiency', 'size']
      const artistSort = sortBy === 'title' ? 'name' : (validArtistSorts.includes(musicSortBy) ? musicSortBy : 'name')
      const albumOrTrackSort = sortBy === 'title' ? 'title' : musicSortBy
      if (musicViewMode === 'artists') setArtistsFilters({ ...commonFilters, sortBy: artistSort } as MusicFilters)
      else if (musicViewMode === 'albums') setAlbumsFilters({ ...commonFilters, sortBy: albumOrTrackSort } as MusicFilters)
      else if (musicViewMode === 'tracks') setTracksFilters({ ...commonFilters, sortBy: albumOrTrackSort } as MusicFilters)
    }
  }, [view, musicViewMode, sortBy, sortOrder, tierFilter, qualityFilter, alphabetFilter, searchInput, activeLibraryId, slimDown, setMoviesFilters, setShowsFilters, setArtistsFilters, setAlbumsFilters, setTracksFilters])

  // Search
  const searchInputRef = useRef<HTMLInputElement>(null)
  const {
    showSearchResults, setShowSearchResults, searchResultIndex, setSearchResultIndex,
    searchContainerRef, globalSearchResults, hasSearchResults, handleSearchKeyDown, handleSearchResultClick,
  } = useGlobalSearch({
    items: movies,
    tvShows: new Map(shows.map(s => [s.series_title, { title: s.series_title, poster_url: s.poster_url, seasons: new Map() }])),
    musicArtists, musicAlbums, allMusicTracks, searchInputRef,
    onNavigateToMovie: (id) => setSelectedMediaId(id, 'movie'),
    onNavigateToTVShow: (title) => setSelectedShow(title),
    onNavigateToEpisode: (id, title) => { if (title) setSelectedShow(title); setSelectedMediaId(id, 'episode') },
    onNavigateToArtist: (a) => { setSelectedArtist(a); setMusicViewMode('albums'); setView('music') },
    onNavigateToAlbum: (a) => { setSelectedArtist(musicArtists.find(art => art.id === a.artist_id) || null); setSelectedAlbum(a); setMusicViewMode('albums'); setView('music') },
    onNavigateToTrack: (id) => { 
      const track = allMusicTracks.find(t => t.id === id);
      if (track) {
        const album = musicAlbums.find(alb => alb.id === track.album_id);
        if (album) {
          setSelectedArtist(musicArtists.find(art => art.id === album.artist_id) || null);
          setSelectedAlbum(album);
          setMusicViewMode('albums');
          setView('music');
        }
      }
    }
  })

  // Load episodes/tracks
  useEffect(() => {
    if (selectedShow) {
      queueMicrotask(() => { setSelectedShowEpisodesLoading(true) })
      window.electronAPI.seriesGetEpisodes(selectedShow, activeSourceId || undefined)
        .then(eps => { setSelectedShowEpisodes(eps as MediaItem[]); setSelectedShowEpisodesLoading(false) })
        .catch(() => setSelectedShowEpisodesLoading(false))
    } else queueMicrotask(() => { setSelectedShowEpisodes([]) })
  }, [selectedShow, activeSourceId])

  useEffect(() => {
    if (selectedAlbum) {
      queueMicrotask(() => { setAlbumTracksLoading(true) })
      Promise.all([
        window.electronAPI.musicGetTracksByAlbum(selectedAlbum.id!),
        window.electronAPI.musicGetAlbumCompleteness(selectedAlbum.id!)
      ]).then(([tracks, completeness]) => {
        setAlbumTracks(tracks as MusicTrack[])
        setSelectedAlbumCompleteness(completeness as AlbumCompletenessData)
        setAlbumTracksLoading(false)
      }).catch(() => setAlbumTracksLoading(false))
    } else queueMicrotask(() => { setAlbumTracks([]); setSelectedAlbumCompleteness(null) })
  }, [selectedAlbum])

  const currentTypeLibraries = useMemo(() =>
    activeSourceLibraries.filter(lib => {
      const typeMatch = (view === 'movies' ? lib.type === 'movie' : view === 'tv' ? lib.type === 'show' : lib.type === 'music')
      return typeMatch && (!lib.isProtected || isUnlocked)
    }), [activeSourceLibraries, view, isUnlocked])

  const loadStats = useCallback(async (sourceId?: string) => {
    try {
      const [libraryStats, artistCount] = await Promise.all([
        window.electronAPI.getLibraryStats(sourceId || undefined),
        window.electronAPI.musicArtistCount({ sourceId: sourceId || undefined }),
      ])
      setStats(libraryStats)
      setHasMusic(artistCount > 0)
    } catch { /* ignore */ }
  }, [])

  const loadCompletenessData = useCallback(async () => {
    try {
      const [seriesData, collectionsData] = await Promise.all([
        window.electronAPI.seriesGetAll(activeSourceId || undefined),
        window.electronAPI.collectionsGetAll(activeSourceId || undefined),
      ])
      setMovieCollections((collectionsData as MovieCollectionData[]).filter(c => c.total_movies > 1))
      const sMap = new Map<string, SeriesCompletenessData>()
      ;(seriesData as SeriesCompletenessData[]).forEach(s => sMap.set(s.series_title, s))
      setSeriesCompleteness(sMap)
    } catch { /* ignore */ }
  }, [activeSourceId])

  const { showCollectionModal, setShowCollectionModal, selectedCollection, setSelectedCollection, getCollectionForMovie, ownedMoviesForSelectedCollection } = useCollections(movies, movieCollections)

  const {
    isAnalyzing, setIsAnalyzing, analysisProgress, setAnalysisProgress, analysisType, setAnalysisType,
    handleAnalyzeSeries, handleAnalyzeCollections, handleAnalyzeMusic, handleAnalyzeAll, handleAnalyzeSingleSeries, handleCancelAnalysis, checkTmdbApiKey,
  } = useAnalysisManager({ sources, activeSourceId, activeSourceLibraries, loadCompletenessData })

  const loadActiveSourceLibraries = useCallback(async () => {
    if (activeSourceId) {
      const libs = await window.electronAPI.sourcesGetLibrariesWithStatus(activeSourceId)
      setActiveSourceLibraries(libs.filter(l => l.isEnabled))
    }
  }, [activeSourceId])

  const loadEpSingleSettings = useCallback(async () => {
    const [eps, sin] = await Promise.all([window.electronAPI.getSetting('completeness_include_eps'), window.electronAPI.getSetting('completeness_include_singles')])
    setIncludeEps(eps !== 'false'); setIncludeSingles(sin !== 'false')
  }, [])

  const loadMusicCompletenessData = useCallback(async () => {
    const res = await window.electronAPI.musicGetAllArtistCompleteness()
    const { artists } = res as { stats: unknown; artists: ArtistCompletenessData[] }
    const map = new Map<string, ArtistCompletenessData>()
    artists.forEach(c => map.set(c.artist_name, c))
    setArtistCompleteness(map)
  }, [])

  const reloadMedia = useCallback(async () => {
    refreshMovies(); refreshShows()
    if (selectedShow) {
      const eps = await window.electronAPI.seriesGetEpisodes(selectedShow, activeSourceId || undefined)
      setSelectedShowEpisodes(eps as MediaItem[])
    }
  }, [refreshMovies, refreshShows, selectedShow, activeSourceId])

  useLibraryEventListeners({
    activeSourceId, loadMedia: reloadMedia, loadStats, loadCompletenessData, loadMusicData: async () => {}, loadMusicCompletenessData,
    loadActiveSourceLibraries, loadEpSingleSettings, setIsAnalyzing, setAnalysisType, setAnalysisProgress,
    setTmdbApiKeySet: () => {}, setIsAutoRefreshing, setActiveSource, markLibraryAsNew, addToast,
  })

  useEffect(() => {
    queueMicrotask(() => { void loadStats(activeSourceId || undefined); void loadCompletenessData(); void loadMusicCompletenessData(); void loadActiveSourceLibraries(); void loadEpSingleSettings(); void checkTmdbApiKey() })
  }, [activeSourceId, loadStats, loadCompletenessData, loadMusicCompletenessData, loadActiveSourceLibraries, loadEpSingleSettings, checkTmdbApiKey])

  const { matchFixModal, setMatchFixModal, selectedMissingItem, setSelectedMissingItem, handleRescanItem } = useMediaActions({ selectedMediaId, loadMedia: reloadMedia, setDetailRefreshKey })

  const { handleDismissUpgrade, handleDismissMissingEpisode, handleDismissMissingSeason, handleDismissCollectionMovie, handleDismissMissingAlbum, handleDismissMissingItem } = useDismissHandlers({
    setPaginatedMovies: setMovies, setSelectedShowEpisodes, seriesCompleteness, setSeriesCompleteness,
    selectedCollection, setSelectedCollection, setMovieCollections, setArtistCompleteness, selectedMissingItem, setSelectedMissingItem, addToast,
  })

  const selectedShowData = useMemo((): TVShow | null => {
    if (!selectedShow || selectedShowEpisodes.length === 0) return null
    const seasons = new Map<number, TVSeason>()
    selectedShowEpisodes.forEach(e => {
      const sn = e.season_number || 0
      if (!seasons.has(sn)) seasons.set(sn, { seasonNumber: sn, episodes: [], posterUrl: e.season_poster_url || undefined })
      seasons.get(sn)!.episodes.push(e)
    })
    return { title: selectedShow, poster_url: selectedShowEpisodes[0]?.poster_url || undefined, seasons }
  }, [selectedShow, selectedShowEpisodes])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {!hideHeader && (
        <BrowserHeader
          view={view} setView={setView} hasMovies={(stats?.totalMovies ?? 0) > 0} hasTV={(stats?.totalShows ?? 0) > 0} hasMusic={hasMusic}
          wishlistCount={wishlistCount} isAutoRefreshing={isAutoRefreshing} tmdbApiKeySet={true} themeAccentColor={themeAccentColor}
          showCompletenessPanel={showCompletenessPanel} setShowCompletenessPanel={setShowCompletenessPanel}
          showWishlistPanel={showWishlistPanel} setShowWishlistPanel={setShowWishlistPanel}
          onOpenSettings={onOpenSettings || (() => {})} onNavigateHome={onNavigateHome}
          searchProps={{ searchInput, setSearchInput, showSearchResults, setShowSearchResults, searchResultIndex, setSearchResultIndex, searchContainerRef, searchInputRef, globalSearchResults, hasSearchResults, handleSearchKeyDown, handleSearchResultClick }}
        />
      )}

      <div className="flex-1 flex flex-col min-h-0 pb-4">
        <BrowserFilterBar
          view={view} musicViewMode={musicViewMode} setMusicViewMode={setMusicViewMode}
          activeSourceId={activeSourceId} activeLibraryId={activeLibraryId} setActiveLibraryId={setActiveLibraryId}
          currentTypeLibraries={currentTypeLibraries} isUnlocked={isUnlocked} setIsUnlocked={setIsUnlocked}
          setShowPinModal={setShowPinModal} tierFilter={tierFilter} setTierFilter={setTierFilter}
          qualityFilter={qualityFilter} setQualityFilter={setQualityFilter} slimDown={slimDown} setSlimDown={setSlimDown}
          collectionsOnly={collectionsOnly} setCollectionsOnly={setCollectionsOnly}
          groupByCollections={groupByCollections} setGroupByCollections={setGroupByCollections}
          hasCollections={movieCollections.length > 0}
          gridScale={gridScale} setGridScale={setGridScale} viewType={viewType} setViewType={setViewType} selectedShow={selectedShow}
        />

        <div className="flex-1 relative min-h-0">
          <div className={`absolute inset-0 px-4 pb-4 ${view === 'timelines' ? 'pr-4' : 'pr-10'}`}>
            {view === 'movies' && (
              <SectionErrorBoundary title="Movies">
                <MoviesView
                  movies={movies} sortBy={sortBy as 'title' | 'year' | 'size' | 'efficiency' | 'waste'} sortOrder={sortOrder} onSortChange={handleSortChange} slimDown={slimDown}
                  onSelectMovie={(id) => setSelectedMediaId(id)}
                  onSelectCollection={(c) => { setSelectedCollection(c); setShowCollectionModal(true) }}
                  viewType={viewType} gridScale={gridScale}
                  groupByCollections={groupByCollections}
                  collectionsOnly={collectionsOnly}
                  getCollectionForMovie={getCollectionForMovie} movieCollections={movieCollections}
                  showSourceBadge={!activeSourceId && sources.length > 1}
                  onFixMatch={(mediaItemId, title, year, filePath) => setMatchFixModal({ isOpen: true, type: 'movie', title, year, filePath, mediaItemId })}
                  onRescan={handleRescanItem} onDismissUpgrade={handleDismissUpgrade}
                  totalMovieCount={totalMovieCount} moviesLoading={moviesLoading} onLoadMoreMovies={loadMoreMovies}
                  isAnalyzing={isAnalyzing}
                />
              </SectionErrorBoundary>
            )}
            {view === 'tv' && (
              <SectionErrorBoundary title="TV Shows">
                <TVShowsView
                  shows={shows} sortBy={sortBy} sortOrder={sortOrder} onSortChange={handleSortChange} slimDown={slimDown}
                  selectedShow={selectedShow} selectedShowData={selectedShowData}
                  selectedShowLoading={selectedShowEpisodesLoading} onSelectShow={setSelectedShow}
                  onSelectEpisode={setSelectedMediaId}
                  filterItem={() => true} gridScale={gridScale} viewType={viewType}
                  seriesCompleteness={seriesCompleteness} onMissingItemClick={setSelectedMissingItem}
                  showSourceBadge={!activeSourceId && sources.length > 1}
                  onAnalyzeSeries={handleAnalyzeSingleSeries}
                  onTranscodeShow={(show) => setShowTranscodeTarget(show)}
                  onFixMatch={(title: string, sId: string, fp?: string) => setMatchFixModal({ isOpen: true, type: 'series', title, sourceId: sId || undefined, filePath: fp || undefined })}
                  onRescanEpisode={async (e) => { if (e.source_id && e.file_path) await handleRescanItem(e.id!, e.source_id, e.library_id || null, e.file_path) }}
                  onDismissUpgrade={handleDismissUpgrade} onDismissMissingEpisode={handleDismissMissingEpisode}

                  onDismissMissingSeason={handleDismissMissingSeason} totalShowCount={totalShowCount}
                  totalEpisodeCount={0} showsLoading={showsLoading} onLoadMoreShows={loadMoreShows}
                  isAnalyzing={isAnalyzing}
                />
              </SectionErrorBoundary>
            )}
            {view === 'music' && (
              <SectionErrorBoundary title="Music">
                <MusicView
                  sortBy={sortBy as 'title' | 'size' | 'efficiency' | 'waste'} sortOrder={sortOrder} onSortChange={handleSortChange} slimDown={slimDown}
                  artists={musicArtists} totalArtistCount={totalArtistCount} artistsLoading={artistsLoading} onLoadMoreArtists={loadMoreArtists}
                  albums={musicAlbums} tracks={albumTracks} allTracks={allMusicTracks} totalTrackCount={totalTrackCount}
                  tracksLoading={tracksLoading} albumTracksLoading={albumTracksLoading} onLoadMoreTracks={loadMoreTracks} totalAlbumCount={totalAlbumCount}
                  albumsLoading={albumsLoading} onLoadMoreAlbums={loadMoreAlbums}
                  onAlbumSortChange={(c, d) => { setAlbumSortColumn(c); setAlbumSortDirection(d) }}
                  albumSortColumn={albumSortColumn}
                  albumSortDirection={albumSortDirection}
                  stats={null} selectedArtist={selectedArtist} selectedAlbum={selectedAlbum}

                  artistCompleteness={artistCompleteness} albumCompleteness={selectedAlbumCompleteness} allAlbumCompleteness={allAlbumCompleteness}
                  musicViewMode={musicViewMode} trackSortColumn={trackSortColumn} trackSortDirection={trackSortDirection}
                  onTrackSortChange={(c, d) => { setTrackSortColumn(c); setTrackSortDirection(d) }}
                  onSelectArtist={setSelectedArtist} onSelectAlbum={setSelectedAlbum}
                  onBack={() => selectedAlbum ? setSelectedAlbum(null) : setSelectedArtist(null)}
                  gridScale={gridScale} viewType={viewType} searchQuery={searchQuery} qualityFilter={qualityFilter}
                  showSourceBadge={!activeSourceId && sources.length > 1}
                  onAnalyzeAlbum={async (id) => { await window.electronAPI.musicAnalyzeAlbumTrackCompleteness(id); loadMusicCompletenessData() }}
                  onAnalyzeArtist={async (id) => { await window.electronAPI.taskQueueAddTask({ type: 'music-completeness', label: 'Analyze Artist', artistId: id }) }}
                  onArtistCompletenessUpdated={loadMusicCompletenessData}
                  onFixArtistMatch={(id, n) => setMatchFixModal({ isOpen: true, type: 'artist', title: n, artistId: id })}
                  onFixAlbumMatch={(id, t, n) => setMatchFixModal({ isOpen: true, type: 'album', title: t, artistName: n, albumId: id })}
                  onRescanTrack={async (t) => { if (t.source_id && t.file_path) await handleRescanItem(0, t.source_id, t.library_id || null, t.file_path) }}
                  includeEps={includeEps} includeSingles={includeSingles}
                  onDismissMissingAlbum={handleDismissMissingAlbum}
                />
              </SectionErrorBoundary>
            )}
            {view === 'wishlist' && (
              <SectionErrorBoundary title="Wishlist">
                <WishlistView />
              </SectionErrorBoundary>
            )}
            {view === 'duplicates' && (
              <SectionErrorBoundary title="Duplicates">
                <DuplicatesView />
              </SectionErrorBoundary>
            )}
            {view === 'timelines' && (
              <SectionErrorBoundary title="Franchise Timelines">
                <TimelinesView />
              </SectionErrorBoundary>
            )}
          </div>
          {view !== 'timelines' && (
            <BrowserAlphabetNav alphabetFilter={alphabetFilter} scrollToLetter={(l) => setAlphabetFilter(l)} />
          )}
        </div>
      </div>

      <PinEntryModal isOpen={showPinModal} onClose={() => setShowPinModal(false)} onSuccess={() => setIsUnlocked(true)} />
      {selectedMediaId && (
        <MediaDetails
          key={`${selectedMediaId}-${detailRefreshKey}`}
          mediaId={selectedMediaId}
          onClose={() => setSelectedMediaId(null)}
          onRescan={handleRescanItem}
          onFixMatch={(mediaItemId, title, year, filePath) => setMatchFixModal({ isOpen: true, type: 'movie', title, year, filePath, mediaItemId })}
          onDismissUpgrade={(mediaId, title) => {
            const item = movies.find(m => m.id === mediaId) || selectedShowEpisodes.find(e => e.id === mediaId)
            if (item) handleDismissUpgrade(item)
            else window.electronAPI.addExclusion('media_upgrade', mediaId, undefined, undefined, title)
            emitDismissUpgrade({ mediaId })
          }}
        />
      )}
      <CompletenessPanel
        isOpen={showCompletenessPanel}
        onClose={() => setShowCompletenessPanel(false)}
        seriesStats={null}
        collectionStats={null}
        musicStats={null}
        hasTV={(stats?.totalShows ?? 0) > 0}
        hasMovies={(stats?.totalMovies ?? 0) > 0}
        hasMusic={musicArtists.length > 0}
        onAnalyzeSeries={handleAnalyzeSeries}
        onAnalyzeCollections={handleAnalyzeCollections}
        onAnalyzeMusic={handleAnalyzeMusic}
        onAnalyzeAll={() => handleAnalyzeAll((stats?.totalShows ?? 0) > 0, (stats?.totalMovies ?? 0) > 0, musicArtists.length > 0)}
        onCancel={handleCancelAnalysis}
        isAnalyzing={isAnalyzing}
        analysisProgress={analysisProgress}
        analysisType={analysisType}
        onDataRefresh={loadCompletenessData}
        libraries={activeSourceLibraries}
      />
      <WishlistPanel isOpen={showWishlistPanel} onClose={() => setShowWishlistPanel(false)} />

      {showCollectionModal && selectedCollection && <CollectionModal collection={selectedCollection} ownedMovies={ownedMoviesForSelectedCollection} onClose={() => setShowCollectionModal(false)} onMovieClick={setSelectedMediaId} onDismissCollectionMovie={handleDismissCollectionMovie} />}
      {selectedMissingItem && <MissingItemPopup {...selectedMissingItem} onClose={() => setSelectedMissingItem(null)} onDismiss={handleDismissMissingItem} />}
      {matchFixModal && (
        <MatchFixModal
          isOpen={matchFixModal.isOpen}
          type={matchFixModal.type}
          currentTitle={matchFixModal.title}
          currentYear={matchFixModal.year}
          filePath={matchFixModal.filePath}
          artistName={matchFixModal.artistName}
          sourceId={matchFixModal.sourceId}
          mediaItemId={matchFixModal.mediaItemId}
          artistId={matchFixModal.artistId}
          albumId={matchFixModal.albumId}
          onClose={() => setMatchFixModal(null)}
          onMatchFixed={reloadMedia}
        />
      )}
      {showTranscodeTarget && <ShowTranscodeModal show={showTranscodeTarget} onClose={() => setShowTranscodeTarget(null)} />}
    </div>
  )
}
