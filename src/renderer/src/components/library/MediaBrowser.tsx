
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { MediaDetails } from './MediaDetails'
import { CompletenessPanel } from './CompletenessPanel'
import { MissingItemPopup } from './MissingItemPopup'
import { CollectionModal } from './CollectionModal'
import { MatchFixModal } from './MatchFixModal'
import { WishlistPanel } from '../wishlist/WishlistPanel'
import { MoviesView } from './MoviesView'
import { TVShowsView } from './TVShowsView'
import { MusicView } from './MusicView'
import { WishlistView } from './WishlistView'
import { DuplicatesView } from './DuplicatesView'
import { PinEntryModal } from './PinEntryModal'
import { BrowserHeader } from './browser/BrowserHeader'
import { BrowserFilterBar } from './browser/BrowserFilterBar'
import { BrowserAlphabetNav } from './browser/BrowserAlphabetNav'
import { useSources } from '../../contexts/SourceContext'
import { useWishlist } from '../../contexts/WishlistContext'
import { useToast } from '../../contexts/ToastContext'
import { useLibrary } from '../../contexts/LibraryContext'
import { emitDismissUpgrade } from '../../utils/dismissEvents'
import { usePaginatedData } from '../../hooks/usePaginatedData'

import {
  useThemeAccent,
  usePanelState,
  useLibraryFilters,
  useCollections,
  useMediaActions,
  useAnalysisManager,
  useDismissHandlers,
  useLibraryEventListeners,
  useGlobalSearch,
} from './hooks'

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
} from './types'

export function MediaBrowser({
  onAddSource: _onAddSource,
  onOpenSettings,
  sidebarCollapsed = false,
  onNavigateHome,
  initialTab: _initialTab,
  hideHeader = false,
  showCompletenessPanel: externalShowCompletenessPanel,
  showWishlistPanel: externalShowWishlistPanel,
  showChatPanel: externalShowChatPanel,
  onToggleCompleteness: externalToggleCompleteness,
  onToggleWishlist: externalToggleWishlist,
  onToggleChat: externalToggleChat,
  libraryTab: _libraryTab,
  onLibraryTabChange: _onLibraryTabChange,
  onAutoRefreshChange: _onAutoRefreshChange
}: MediaBrowserProps) {
  const {
    view, setView,
    qualityFilter, setQualityFilter,
    gridScale, setGridScale,
    viewType, setViewType,
    selectedItemId: selectedMediaId, setSelectedMedia: setSelectedMediaId,
    sortBy, setSortBy,
    setActiveSourceId: setContextActiveSourceId,
    selectedShow, setSelectedShow,
    selectedArtist, setSelectedArtist,
    selectedAlbum, setSelectedAlbum,
    searchQuery: _searchQuery,
  } = useLibrary()

  const { sources, activeSourceId, scanProgress, setActiveSource, markLibraryAsNew } = useSources()

  useEffect(() => {
    setContextActiveSourceId(activeSourceId)
  }, [activeSourceId, setContextActiveSourceId])

  const { addToast } = useToast()
  const { count: wishlistCount } = useWishlist()
  const themeAccentColor = useThemeAccent()

  const {
    showCompletenessPanel,
    showWishlistPanel,
    showChatPanel,
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
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [albumSortColumn, setAlbumSortColumn] = useState<'title' | 'artist'>('title')
  const [albumSortDirection, setAlbumSortDirection] = useState<'asc' | 'desc'>('asc')
  const [trackSortColumn, setTrackSortColumn] = useState<'title' | 'album' | 'artist' | 'codec' | 'duration'>('title')
  const [trackSortDirection, setTrackSortDirection] = useState<'asc' | 'desc'>('asc')

  // PAGINATION HOOKS
  const {
    items: movies,
    totalCount: totalMovieCount,
    loading: moviesLoading,
    loadMore: loadMoreMovies,
    refresh: refreshMovies,
    setItems: setMovies
  } = usePaginatedData<MediaItem, any>({
    fetchFn: window.electronAPI.getMediaItems,
    countFn: window.electronAPI.countMediaItems,
    pageSize: 200,
    initialFilters: { type: 'movie', sortBy: 'title', sortOrder: 'asc' },
    activeSourceId
  })

  const {
    items: shows,
    totalCount: totalShowCount,
    loading: showsLoading,
    loadMore: loadMoreShows,
    refresh: refreshShows,
  } = usePaginatedData<TVShowSummary, any>({
    fetchFn: window.electronAPI.getTVShows as any,
    countFn: window.electronAPI.countTVShows,
    pageSize: 200,
    initialFilters: { sortBy: 'title', sortOrder: 'asc' },
    activeSourceId
  })

  const {
    items: musicArtists,
    totalCount: totalArtistCount,
    loading: artistsLoading,
    loadMore: loadMoreArtists,
  } = usePaginatedData<MusicArtist, any>({
    fetchFn: window.electronAPI.musicArtistList as any,
    countFn: window.electronAPI.musicArtistCount,
    pageSize: 50,
    initialFilters: { sortBy: 'name', sortOrder: 'asc' },
    activeSourceId
  })

  const {
    items: musicAlbums,
    totalCount: totalAlbumCount,
    loading: albumsLoading,
    loadMore: loadMoreAlbums,
  } = usePaginatedData<MusicAlbum, any>({
    fetchFn: window.electronAPI.musicAlbumList as any,
    countFn: window.electronAPI.musicAlbumCount,
    pageSize: 200,
    initialFilters: { sortBy: 'title', sortOrder: 'asc' },
    activeSourceId
  })

  const {
    items: allMusicTracks,
    totalCount: totalTrackCount,
    loading: tracksLoading,
    loadMore: loadMoreTracks,
  } = usePaginatedData<MusicTrack, any>({
    fetchFn: window.electronAPI.musicTrackList as any,
    countFn: window.electronAPI.musicTrackCount,
    pageSize: 500,
    initialFilters: { sortBy: 'title', sortOrder: 'asc' },
    activeSourceId
  })

  // Filters
  const [searchInput, setSearchInput] = useState('')
  const {
    tierFilter, setTierFilter,
    alphabetFilter, setAlphabetFilter,
    slimDown, setSlimDown,
  } = useLibraryFilters(searchInput)

  // Search
  const searchInputRef = useRef<HTMLInputElement>(null)
  const {
    showSearchResults, setShowSearchResults,
    searchResultIndex, setSearchResultIndex,
    searchContainerRef,
    globalSearchResults,
    hasSearchResults,
    handleSearchKeyDown,
    handleSearchResultClick,
  } = useGlobalSearch({
    items: movies,
    tvShows: new Map(shows.map(s => [s.series_title, { title: s.series_title, poster_url: s.poster_url, seasons: new Map() }])),
    musicArtists, musicAlbums, allMusicTracks, searchInputRef,
    onNavigateToMovie: (id) => setSelectedMediaId(id, 'movie'),
    onNavigateToTVShow: (title) => setSelectedShow(title),
    onNavigateToEpisode: (id, title) => { if (title) setSelectedShow(title); setSelectedMediaId(id, 'episode') },
    onNavigateToArtist: (a) => { setSelectedArtist(a); setMusicViewMode('albums') },
    onNavigateToAlbum: (a) => { setSelectedAlbum(a); setMusicViewMode('albums') },
    onNavigateToTrack: (id) => { const a = musicAlbums.find(alb => alb.id === id); if (a) setSelectedAlbum(a); setMusicViewMode('albums') }
  })

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
  const selectedShowEpisodesLoading = false
  const albumTracks: MusicTrack[] = []
  const selectedAlbumCompleteness: AlbumCompletenessData | null = null
  const [activeSourceLibraries, setActiveSourceLibraries] = useState<any[]>([])
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)

  const currentTypeLibraries = useMemo(() =>
    activeSourceLibraries.filter(lib => {
      const typeMatch = (view === 'movies' ? lib.type === 'movie' : view === 'tv' ? lib.type === 'show' : lib.type === 'music')
      return typeMatch && (!lib.isProtected || isUnlocked)
    }), [activeSourceLibraries, view, isUnlocked])

  const loadStats = useCallback(async (sourceId?: string) => {
    try {
      const libraryStats = await window.electronAPI.getLibraryStats(sourceId || undefined)
      setStats(libraryStats)
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

  const {
    showCollectionModal, setShowCollectionModal,
    selectedCollection, setSelectedCollection,
    getCollectionForMovie,
    ownedMoviesForSelectedCollection,
  } = useCollections(movies, movieCollections)

  const {
    isAnalyzing, setIsAnalyzing,
    analysisProgress, setAnalysisProgress,
    analysisType, setAnalysisType,
    handleAnalyzeSeries, handleAnalyzeCollections, handleAnalyzeMusic,
    handleAnalyzeSingleSeries, handleCancelAnalysis, checkTmdbApiKey,
  } = useAnalysisManager({ sources, activeSourceId, activeSourceLibraries, loadCompletenessData })

  const loadActiveSourceLibraries = useCallback(async () => {
    if (activeSourceId) {
      const libs = await window.electronAPI.sourcesGetLibrariesWithStatus(activeSourceId)
      setActiveSourceLibraries(libs.filter(l => l.isEnabled))
    }
  }, [activeSourceId])

  const loadEpSingleSettings = useCallback(async () => {
    const [eps, sin] = await Promise.all([
      window.electronAPI.getSetting('completeness_include_eps'),
      window.electronAPI.getSetting('completeness_include_singles'),
    ])
    setIncludeEps(eps !== 'false')
    setIncludeSingles(sin !== 'false')
  }, [])

  const loadMusicCompletenessData = useCallback(async () => {
    const [data] = await Promise.all([window.electronAPI.musicGetAllArtistCompleteness()])
    const map = new Map<string, ArtistCompletenessData>()
    ;(data as any[]).forEach(c => map.set(c.artist_name, c))
    setArtistCompleteness(map)
  }, [])

  const reloadMedia = useCallback(async () => {
    refreshMovies()
    refreshShows()
    if (selectedShow) {
      const eps = await window.electronAPI.seriesGetEpisodes(selectedShow, activeSourceId || undefined)
      setSelectedShowEpisodes(eps as MediaItem[])
    }
  }, [refreshMovies, refreshShows, selectedShow, activeSourceId])

  useLibraryEventListeners({
    activeSourceId, scanProgressSize: scanProgress.size,
    loadMedia: reloadMedia, loadStats, loadCompletenessData,
    loadMusicData: async () => {}, loadMusicCompletenessData,
    loadActiveSourceLibraries, loadEpSingleSettings,
    setIsAnalyzing, setAnalysisType, setAnalysisProgress,
    setTmdbApiKeySet: () => {}, setIsAutoRefreshing,
    setActiveSource, markLibraryAsNew, addToast,
  })

  useEffect(() => {
    loadStats(activeSourceId || undefined)
    loadCompletenessData()
    loadMusicCompletenessData()
    loadActiveSourceLibraries()
    loadEpSingleSettings()
    checkTmdbApiKey()
  }, [activeSourceId, loadStats, loadCompletenessData, loadMusicCompletenessData, loadActiveSourceLibraries, loadEpSingleSettings, checkTmdbApiKey])

  const {
    matchFixModal, setMatchFixModal,
    selectedMissingItem, setSelectedMissingItem,
    handleRescanItem,
  } = useMediaActions({ selectedMediaId, loadMedia: reloadMedia, setDetailRefreshKey })

  const {
    handleDismissUpgrade,
    handleDismissMissingEpisode,
    handleDismissMissingSeason,
    handleDismissCollectionMovie,
    handleDismissMissingAlbum,
    handleDismissMissingItem,
  } = useDismissHandlers({
    setPaginatedMovies: setMovies as any, setSelectedShowEpisodes,
    seriesCompleteness, setSeriesCompleteness,
    selectedCollection, setSelectedCollection, setMovieCollections,
    setArtistCompleteness, selectedMissingItem, setSelectedMissingItem, addToast,
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
    <div className="h-screen flex flex-col">
      {!hideHeader && (
        <BrowserHeader
          view={view} setView={setView}
          hasMovies={(stats?.totalMovies ?? 0) > 0} hasTV={(stats?.totalShows ?? 0) > 0} hasMusic={musicArtists.length > 0}
          wishlistCount={wishlistCount} isAutoRefreshing={isAutoRefreshing}
          tmdbApiKeySet={true} themeAccentColor={themeAccentColor}
          showCompletenessPanel={showCompletenessPanel} setShowCompletenessPanel={setShowCompletenessPanel}
          showWishlistPanel={showWishlistPanel} setShowWishlistPanel={setShowWishlistPanel}
          onOpenSettings={onOpenSettings || (() => {})} onNavigateHome={onNavigateHome}
          searchProps={{
            searchInput, setSearchInput, showSearchResults, setShowSearchResults,
            searchResultIndex, setSearchResultIndex, searchContainerRef, searchInputRef,
            globalSearchResults, hasSearchResults, handleSearchKeyDown, handleSearchResultClick
          }}
        />
      )}

      <main 
        className="fixed top-[88px] bottom-4 transition-[left,right] duration-300 flex flex-col"
        style={{ left: sidebarCollapsed ? '96px' : '288px', right: showCompletenessPanel || showWishlistPanel || showChatPanel ? '352px' : '16px' }}
      >
        <BrowserFilterBar
          view={view} musicViewMode={musicViewMode} setMusicViewMode={setMusicViewMode}
          activeSourceId={activeSourceId} activeLibraryId={activeLibraryId} setActiveLibraryId={setActiveLibraryId}
          currentTypeLibraries={currentTypeLibraries} isUnlocked={isUnlocked} setIsUnlocked={setIsUnlocked}
          setShowPinModal={setShowPinModal}
          tierFilter={tierFilter} setTierFilter={setTierFilter}
          qualityFilter={qualityFilter} setQualityFilter={setQualityFilter}
          slimDown={slimDown} setSlimDown={setSlimDown}
          collectionsOnly={collectionsOnly} setCollectionsOnly={setCollectionsOnly}
          hasCollections={movieCollections.length > 0}
          gridScale={gridScale} setGridScale={setGridScale}
          viewType={viewType} setViewType={setViewType}
          selectedShow={selectedShow}
        />

        <div className="flex-1 relative min-h-0">
          <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto px-4 pb-4 pr-10">
            {view === 'movies' && (
              <MoviesView
                movies={movies} sortBy={sortBy as any} onSortChange={setSortBy} slimDown={slimDown}
                onSelectMovie={(id) => setSelectedMediaId(id)}
                onSelectCollection={(c) => { setSelectedCollection(c); setShowCollectionModal(true) }}
                viewType={viewType} gridScale={gridScale}
                getCollectionForMovie={getCollectionForMovie} movieCollections={movieCollections}
                showSourceBadge={!activeSourceId && sources.length > 1}
                onFixMatch={(mediaItemId, title, year, filePath) => setMatchFixModal({ isOpen: true, type: 'movie', title, year, filePath, mediaItemId })}
                onRescan={handleRescanItem} onDismissUpgrade={handleDismissUpgrade}
                totalMovieCount={totalMovieCount} moviesLoading={moviesLoading} onLoadMoreMovies={loadMoreMovies}
                scrollElement={scrollContainerRef.current}
              />
            )}
            {view === 'tv' && (
              <TVShowsView
                shows={shows} sortBy={sortBy as any} onSortChange={setSortBy} slimDown={slimDown}
                selectedShow={selectedShow} selectedSeason={selectedSeason} selectedShowData={selectedShowData}
                selectedShowLoading={selectedShowEpisodesLoading} onSelectShow={setSelectedShow}
                onSelectSeason={setSelectedSeason} onSelectEpisode={setSelectedMediaId}
                filterItem={() => true} gridScale={gridScale} viewType={viewType}
                seriesCompleteness={seriesCompleteness} onMissingItemClick={setSelectedMissingItem}
                showSourceBadge={!activeSourceId && sources.length > 1}
                onAnalyzeSeries={handleAnalyzeSingleSeries}
                onFixMatch={(title, sId, fp) => setMatchFixModal({ isOpen: true, type: 'series', title, sourceId: sId || undefined, filePath: fp || undefined })}
                onRescanEpisode={async (e) => { if (e.source_id && e.file_path) await handleRescanItem(e.id!, e.source_id, e.library_id || null, e.file_path) }}
                onDismissUpgrade={handleDismissUpgrade} onDismissMissingEpisode={handleDismissMissingEpisode}
                onDismissMissingSeason={handleDismissMissingSeason} totalShowCount={totalShowCount}
                totalEpisodeCount={0} showsLoading={showsLoading} onLoadMoreShows={loadMoreShows}
                scrollElement={scrollContainerRef.current}
              />
            )}
            {view === 'music' && (
              <MusicView
                sortBy={sortBy as any} onSortChange={setSortBy} slimDown={slimDown}
                artists={musicArtists} totalArtistCount={totalArtistCount} artistsLoading={artistsLoading} onLoadMoreArtists={loadMoreArtists}
                albums={musicAlbums} tracks={albumTracks} allTracks={allMusicTracks} totalTrackCount={totalTrackCount}
                tracksLoading={tracksLoading} onLoadMoreTracks={loadMoreTracks} totalAlbumCount={totalAlbumCount}
                albumsLoading={albumsLoading} onLoadMoreAlbums={loadMoreAlbums}
                albumSortColumn={albumSortColumn} albumSortDirection={albumSortDirection}
                onAlbumSortChange={(c, d) => { setAlbumSortColumn(c); setAlbumSortDirection(d) }}
                stats={null} selectedArtist={selectedArtist} selectedAlbum={selectedAlbum}
                artistCompleteness={artistCompleteness} albumCompleteness={selectedAlbumCompleteness} allAlbumCompleteness={allAlbumCompleteness}
                musicViewMode={musicViewMode} trackSortColumn={trackSortColumn} trackSortDirection={trackSortDirection}
                onTrackSortChange={(c, d) => { setTrackSortColumn(c); setTrackSortDirection(d) }}
                onSelectArtist={setSelectedArtist} onSelectAlbum={setSelectedAlbum}
                onBack={() => selectedAlbum ? setSelectedAlbum(null) : setSelectedArtist(null)}
                gridScale={gridScale} viewType={viewType} searchQuery={_searchQuery} qualityFilter={qualityFilter}
                showSourceBadge={!activeSourceId && sources.length > 1}
                onAnalyzeAlbum={async (id) => { await window.electronAPI.musicAnalyzeAlbumTrackCompleteness(id); loadMusicCompletenessData() }}
                onAnalyzeArtist={async (id) => { await window.electronAPI.taskQueueAddTask({ type: 'music-completeness', label: 'Analyze Artist', artistId: id } as any) }}
                onArtistCompletenessUpdated={loadMusicCompletenessData}
                onFixArtistMatch={(id, n) => setMatchFixModal({ isOpen: true, type: 'artist', title: n, artistId: id })}
                onFixAlbumMatch={(id, t, n) => setMatchFixModal({ isOpen: true, type: 'album', title: t, artistName: n, albumId: id })}
                onRescanTrack={async (t) => { if (t.source_id && t.file_path) await handleRescanItem(0, t.source_id, t.library_id || null, t.file_path) }}
                includeEps={includeEps} includeSingles={includeSingles} scrollElement={scrollContainerRef.current}
                onDismissMissingAlbum={handleDismissMissingAlbum}
              />
            )}
            {view === 'wishlist' && <WishlistView />}
            {view === 'duplicates' && <DuplicatesView />}
          </div>
          <BrowserAlphabetNav alphabetFilter={alphabetFilter} scrollToLetter={(l) => setAlphabetFilter(l)} />
        </div>
      </main>

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
    </div>
  )
}
