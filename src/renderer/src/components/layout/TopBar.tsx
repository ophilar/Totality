/**
 * TopBar - Shared top navigation bar across the application
 *
 * Contains logo, search, library tabs, and panel toggles.
 */

import { useState, useEffect, useRef } from 'react'
import { Search, X, Home, Film, Tv, Music, Library, Star, Settings, RefreshCw, Disc3, User, Bot, ArrowLeft, ArrowRight, ListOrdered } from 'lucide-react'

import { useSources } from '@/contexts/SourceContext'
import { useWishlist } from '@/contexts/WishlistContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { ActivityPanel } from '@/components/ui/ActivityPanel'
import logoImage from '@/assets/totality_header_logo.png'
import type { MediaViewType } from '@/components/library/types'
import type { GlobalSearchResults } from '@shared/globalSearch'

import { usePanel } from '@/contexts/PanelContext'

interface TopBarProps {
  currentView: 'dashboard' | 'library'
  libraryTab: MediaViewType
  onNavigateHome: () => void
  onNavigateToLibrary: (tab: MediaViewType) => void
  onOpenSettings: () => void
  isAutoRefreshing?: boolean
  hasMovies?: boolean
  hasTV?: boolean
  hasMusic?: boolean
  onBack?: () => void
  canGoBack?: boolean
  onForward?: () => void
  canGoForward?: boolean
}

export function TopBar({
  currentView,
  libraryTab,
  onNavigateHome,
  onNavigateToLibrary,
  onOpenSettings,
  isAutoRefreshing = false,
  hasMovies = false,
  hasTV = false,
  hasMusic = false,
  onBack,
  canGoBack = false,
  onForward,
  canGoForward = false,
}: TopBarProps) {
  const {
    showCompletenessPanel,
    showWishlistPanel,
    showChatPanel,
    toggleCompleteness: onToggleCompleteness,
    toggleWishlist: onToggleWishlist,
    toggleChat: onToggleChat,
  } = usePanel()
  const { sources } = useSources()
  const { count: wishlistCount } = useWishlist()
  const { navigateTo } = useNavigation()

  // Theme accent color for alerts
  const [themeAccentColor, setThemeAccentColor] = useState('')
  useEffect(() => {
    const updateAccentColor = () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      setThemeAccentColor(accent ? `hsl(${accent})` : '')
    }
    updateAccentColor()
    const observer = new MutationObserver(updateAccentColor)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Check TMDB API key status
  const [tmdbApiKeySet, setTmdbApiKeySet] = useState(false)
  useEffect(() => {
    window.electronAPI.getSetting('tmdb_api_key').then(value => {
      setTmdbApiKeySet(!!value)
    })
    const unsubscribe = window.electronAPI.onSettingsChanged(({ key, hasValue }) => {
      if (key === 'tmdb_api_key') setTmdbApiKeySet(hasValue)
    })
    return unsubscribe
  }, [])

  const showEmptyState = sources.length === 0

  // Search state
  const [searchInput, setSearchInput] = useState('')
  const [searchState, setSearchState] = useState<{ query: string; results: GlobalSearchResults } | null>(null)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [searchResultIndex, setSearchResultIndex] = useState(-1)
  const [searchStatus, setSearchStatus] = useState<'idle' | 'waiting' | 'searching' | 'error'>('idle')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchGenerationRef = useRef(0)
  const query = searchInput.trim()
  const searchResults = searchState?.query === query ? searchState.results : null

  useEffect(() => {
    const generation = ++searchGenerationRef.current
    if (query.length < 2) {
      setSearchStatus('idle')
      setSearchError(null)
      return
    }

    setSearchStatus('waiting')
    setSearchError(null)
    const timer = setTimeout(() => {
      setSearchStatus('searching')
      void window.electronAPI.mediaSearch(query).then(results => {
        if (generation !== searchGenerationRef.current) return
        setSearchState({ query, results })
        setSearchStatus('idle')
      }).catch(error => {
        if (generation !== searchGenerationRef.current) return
        setSearchError(error instanceof Error ? error.message : String(error))
        setSearchStatus('error')
      })
    }, 250)
    return () => {
      clearTimeout(timer)
      if (generation === searchGenerationRef.current) searchGenerationRef.current++
    }
  }, [query, retryGeneration])

  // Handle search input change with debounce
  const handleSearchInputChange = (value: string) => {
    setSearchInput(value)
    setShowSearchResults(true)
    setSearchResultIndex(-1)

  }

  // Check if we have any results
  const hasResults = searchResults && (
    searchResults.movies.length > 0 ||
    searchResults.tvShows.length > 0 ||
    searchResults.episodes.length > 0 ||
    searchResults.artists.length > 0 ||
    searchResults.albums.length > 0 ||
    searchResults.tracks.length > 0
  )

  // Flatten results for keyboard navigation
  const flattenedResults = searchResults ? [
    ...searchResults.movies.map(m => ({ type: 'movie' as const, id: m.id })),
    ...searchResults.tvShows.map(s => ({ type: 'tv' as const, id: s.id, title: s.title })),
    ...searchResults.episodes.map(e => ({ type: 'episode' as const, id: e.id, series_title: e.series_title, season_number: e.season_number })),
    ...searchResults.artists.map(a => ({ type: 'artist' as const, id: a.id, name: a.title })),
    ...searchResults.albums.map(a => ({ type: 'album' as const, id: a.id })),
    ...searchResults.tracks.map(t => ({ type: 'track' as const, id: t.id, album_id: t.album_id })),
  ] : []

  // Handle result selection
  const handleResultClick = (type: 'movie' | 'tv' | 'episode' | 'artist' | 'album' | 'track', id: number | string, extra?: { series_title?: string | null; season_number?: number | null; album_id?: number; title?: string; name?: string }) => {
    setShowSearchResults(false)
    setSearchInput('')

    // Navigate to appropriate library tab and item
    if (type === 'movie') {
      onNavigateToLibrary('movies')
      navigateTo({ type: 'movie', id: Number(id) })
    } else if (type === 'tv') {
      onNavigateToLibrary('tv')
      navigateTo({ type: 'tv', id: extra?.title || String(id) })
    } else if (type === 'episode') {
      onNavigateToLibrary('tv')
      navigateTo({ type: 'episode', id: Number(id), seriesTitle: extra?.series_title ?? undefined, seasonNumber: extra?.season_number ?? undefined })
    } else if (type === 'artist') {
      onNavigateToLibrary('music')
      navigateTo({ type: 'artist', id: Number(id), artistName: extra?.name })
    } else if (type === 'album') {
      onNavigateToLibrary('music')
      navigateTo({ type: 'album', id: Number(id) })
    } else if (type === 'track') {
      onNavigateToLibrary('music')
      navigateTo({ type: 'track', id: Number(id), albumId: extra?.album_id })
    }
  }

  // Keyboard navigation
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showSearchResults || !hasResults) {
      if (e.key === 'Escape') {
        setShowSearchResults(false)
        searchInputRef.current?.blur()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSearchResultIndex(prev => prev < flattenedResults.length - 1 ? prev + 1 : 0)
        break
      case 'ArrowUp':
        e.preventDefault()
        setSearchResultIndex(prev => prev > 0 ? prev - 1 : flattenedResults.length - 1)
        break
      case 'Enter':
        e.preventDefault()
        if (searchResultIndex >= 0 && searchResultIndex < flattenedResults.length) {
          const result = flattenedResults[searchResultIndex]
          handleResultClick(result.type, result.id, result as { series_title?: string; album_id?: number; title?: string })
        }
        break
      case 'Escape':
        e.preventDefault()
        setShowSearchResults(false)
        setSearchResultIndex(-1)
        searchInputRef.current?.blur()
        break
    }
  }

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isDashboard = currentView === 'dashboard'

  // Get actual theme from document (to escape TopBar's forced dark mode)


  return (
    <header
      id="top-bar"
      className="fixed top-4 left-4 right-4 z-100 bg-black text-white rounded-2xl shadow-xl px-4 py-3"
      role="banner"
      aria-label="Main navigation"
    >
      <div className="flex items-center gap-4">
        {/* Left Section: Logo + Search */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Logo */}
          <img src={logoImage} alt="Totality" className="h-10 shrink-0" />

          {/* Search */}
          <div ref={searchContainerRef} className="relative shrink min-w-24 max-w-80 w-56 focus-within:w-80 transition-all duration-300 ease-out">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/50 z-10" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search all libraries..."
              value={searchInput}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              onFocus={() => setShowSearchResults(true)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-10 pr-8 py-2 bg-white/10 border border-white/15 rounded-full text-sm text-white placeholder:text-white/40 focus:outline-hidden focus:ring-2 focus:ring-white/30 focus:border-white/25 transition-all duration-300"
              aria-label="Search all libraries"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSearchResults && query.length >= 2}
              aria-controls={searchStatus === 'idle' && hasResults ? 'topbar-search-listbox' : undefined}
              aria-haspopup="listbox"
              aria-activedescendant={searchResultIndex >= 0 ? `topbar-search-option-${searchResultIndex}` : undefined}
              aria-busy={searchStatus === 'waiting' || searchStatus === 'searching'}
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput('')
                  setSearchState(null)
                  setSearchStatus('idle')
                  setSearchError(null)
                  searchGenerationRef.current++
                  setShowSearchResults(false)
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/50 hover:text-white z-10"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            {/* Search Results Dropdown */}
            {showSearchResults && query.length >= 2 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-lg shadow-2xl z-9999 max-h-[400px] overflow-y-auto overflow-x-hidden">
                {searchStatus === 'waiting' && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center" role="status">Waiting to search…</div>
                )}

                {searchStatus === 'searching' && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center" role="status">Searching library…</div>
                )}

                {searchStatus === 'error' && (
                  <div className="px-3 py-4 text-sm text-center" role="alert">
                    <p className="text-destructive">Search failed: {searchError}</p>
                    <button type="button" className="mt-2 text-primary hover:underline" onClick={() => setRetryGeneration(value => value + 1)}>Retry search</button>
                  </div>
                )}

                {searchStatus === 'idle' && !hasResults && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center" role="status" aria-live="polite">No results found</div>
                )}

                {searchStatus === 'idle' && hasResults && searchResults && (
                  <div id="topbar-search-listbox" role="listbox" aria-label="Search results">
                    {/* Movies */}
                    {searchResults.movies.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Film className="w-3 h-3" />
                          Movies
                        </div>
                        {searchResults.movies.map((movie, idx) => {
                          const flatIndex = idx
                          return (
                            <button
                              key={`movie-${movie.id}`}
                              id={`topbar-search-option-${flatIndex}`}
                              role="option"
                              aria-selected={searchResultIndex === flatIndex}
                              onClick={() => handleResultClick('movie', movie.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-8 h-12 bg-muted rounded overflow-hidden shrink-0">
                                {movie.poster_url ? (
                                  <img src={movie.poster_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Film className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{movie.title}</div>
                                {movie.year && <div className="text-xs text-muted-foreground">{movie.year}</div>}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* TV Shows */}
                    {searchResults.tvShows.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Tv className="w-3 h-3" />
                          TV Shows
                        </div>
                        {searchResults.tvShows.map((show, idx) => {
                          const flatIndex = searchResults.movies.length + idx
                          return (
                            <button
                              key={`tv-${show.id}`}
                              id={`topbar-search-option-${flatIndex}`}
                              role="option"
                              aria-selected={searchResultIndex === flatIndex}
                              onClick={() => handleResultClick('tv', show.id, { title: show.title })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-8 h-12 bg-muted rounded overflow-hidden shrink-0">
                                {show.poster_url ? (
                                  <img src={show.poster_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Tv className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-medium truncate">{show.title}</div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Episodes */}
                    {searchResults.episodes.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Tv className="w-3 h-3" />
                          Episodes
                        </div>
                        {searchResults.episodes.map((episode, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + idx
                          return (
                            <button
                              key={`episode-${episode.id}`}
                              id={`topbar-search-option-${flatIndex}`}
                              role="option"
                              aria-selected={searchResultIndex === flatIndex}
                              onClick={() => handleResultClick('episode', episode.id, { series_title: episode.series_title, season_number: episode.season_number })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-8 h-12 bg-muted rounded overflow-hidden shrink-0">
                                {episode.thumb_url ? (
                                  <img src={episode.thumb_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Tv className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{episode.title}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {episode.series_title} · S{episode.season_number}E{episode.episode_number}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Artists */}
                    {searchResults.artists.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <User className="w-3 h-3" />
                          Artists
                        </div>
                        {searchResults.artists.map((artist, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + searchResults.episodes.length + idx
                          return (
                            <button
                              key={`artist-${artist.id}`}
                              id={`topbar-search-option-${flatIndex}`}
                              role="option"
                              aria-selected={searchResultIndex === flatIndex}
                              onClick={() => handleResultClick('artist', artist.id, { name: artist.title })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-10 h-10 bg-muted rounded-full overflow-hidden shrink-0">
                                {artist.thumb_url ? (
                                  <img src={artist.thumb_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <User className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-medium truncate">{artist.title}</div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Albums */}
                    {searchResults.albums.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Disc3 className="w-3 h-3" />
                          Albums
                        </div>
                        {searchResults.albums.map((album, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + searchResults.episodes.length + searchResults.artists.length + idx
                          return (
                            <button
                              key={`album-${album.id}`}
                              id={`topbar-search-option-${flatIndex}`}
                              role="option"
                              aria-selected={searchResultIndex === flatIndex}
                              onClick={() => handleResultClick('album', album.id)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-10 h-10 bg-muted rounded overflow-hidden shrink-0">
                                {album.thumb_url ? (
                                  <img src={album.thumb_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Disc3 className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{album.title}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {album.subtitle}{album.year && ` · ${album.year}`}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    {/* Tracks */}
                    {searchResults.tracks.length > 0 && (
                      <div>
                        <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                          <Music className="w-3 h-3" />
                          Tracks
                        </div>
                        {searchResults.tracks.map((track, idx) => {
                          const flatIndex = searchResults.movies.length + searchResults.tvShows.length + searchResults.episodes.length + searchResults.artists.length + searchResults.albums.length + idx
                          return (
                            <button
                              key={`track-${track.id}`}
                              id={`topbar-search-option-${flatIndex}`}
                              role="option"
                              aria-selected={searchResultIndex === flatIndex}
                              onClick={() => handleResultClick('track', track.id, { album_id: track.album_id })}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${
                                searchResultIndex === flatIndex ? 'bg-primary/20' : 'hover:bg-muted/50'
                              }`}
                            >
                              <div className="w-10 h-10 bg-muted rounded overflow-hidden shrink-0">
                                {track.thumb_url ? (
                                  <img src={track.thumb_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Music className="w-4 h-4 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{track.title}</div>
                                {track.artist_name && (
                                  <div className="text-xs text-muted-foreground truncate">{track.artist_name}</div>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Back Button */}
          <button
            onClick={canGoBack && onBack ? onBack : undefined}
            disabled={!canGoBack}
            className={`p-1.5 rounded-md transition-colors shrink-0 ${
              canGoBack
                ? 'text-white hover:bg-white/10 cursor-pointer'
                : 'text-neutral-600 cursor-default'
            }`}
            title="Go back (Alt+Left)"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Forward Button */}
          <button
            onClick={canGoForward && onForward ? onForward : undefined}
            disabled={!canGoForward}
            className={`p-1.5 rounded-md transition-colors shrink-0 ${
              canGoForward
                ? 'text-white hover:bg-white/10 cursor-pointer'
                : 'text-neutral-600 cursor-default'
            }`}
            title="Go forward (Alt+Right)"
          >
            <ArrowRight className="w-5 h-5" />
          </button>

        </div>

        {/* Library Buttons - Centered */}
        {!showEmptyState && (
          <nav className="shrink-0" aria-label="Primary navigation">
            <div className="flex gap-1">
              {/* Home Button */}
              <button
                onClick={onNavigateHome}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors focus:outline-hidden flex items-center gap-2 ${
                  isDashboard
                    ? 'bg-white text-black'
                    : 'text-white hover:bg-white/10'
                }`}
                aria-current={isDashboard ? 'page' : undefined}
                aria-label="Dashboard"
              >
                <Home className="w-4 h-4" />
              </button>

              {/* Divider - only show if any library buttons will render */}
              {(hasMovies || hasTV || hasMusic) && (
                <div className="w-px bg-white/20 mx-1" />
              )}

              {/* Movies Button - only render if movies library exists */}
              {hasMovies && (
                <button
                  onClick={() => onNavigateToLibrary('movies')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-hidden flex items-center gap-2 ${
                    !isDashboard && libraryTab === 'movies'
                      ? 'bg-white text-black'
                      : 'text-white hover:bg-white/10'
                  }`}
                  aria-current={!isDashboard && libraryTab === 'movies' ? 'page' : undefined}
                >
                  <Film className="w-4 h-4" />
                  <span>Movies</span>
                </button>
              )}

              {/* TV Shows Button - only render if TV library exists */}
              {hasTV && (
                <button
                  onClick={() => onNavigateToLibrary('tv')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-hidden flex items-center gap-2 ${
                    !isDashboard && libraryTab === 'tv'
                      ? 'bg-white text-black'
                      : 'text-white hover:bg-white/10'
                  }`}
                  aria-current={!isDashboard && libraryTab === 'tv' ? 'page' : undefined}
                >
                  <Tv className="w-4 h-4" />
                  <span>TV Shows</span>
                </button>
              )}

              {/* Music Button - only render if music library exists */}
              {hasMusic && (
                <button
                  onClick={() => onNavigateToLibrary('music')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-hidden flex items-center gap-2 ${
                    !isDashboard && libraryTab === 'music'
                      ? 'bg-white text-black'
                      : 'text-white hover:bg-white/10'
                  }`}
                  aria-current={!isDashboard && libraryTab === 'music' ? 'page' : undefined}
                >
                  <Music className="w-4 h-4" />
                  <span>Music</span>
                </button>
              )}

              {/* Timelines Button */}
              <button
                onClick={() => onNavigateToLibrary('timelines')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-hidden flex items-center gap-2 ${
                  !isDashboard && libraryTab === 'timelines'
                    ? 'bg-white text-black'
                    : 'text-white hover:bg-white/10'
                }`}
                aria-current={!isDashboard && libraryTab === 'timelines' ? 'page' : undefined}
              >
                <ListOrdered className="w-4 h-4" />
                <span>Timelines</span>
              </button>

              {/* Auto-refresh indicator */}

              {isAutoRefreshing && (
                <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-white/50" title="Checking for new content...">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Syncing</span>
                </div>
              )}
            </div>
          </nav>
        )}

        {/* Right Section: Panel Toggles & Settings */}
        <div className="flex items-center justify-end flex-1 gap-2">
          {/* Completeness Panel Toggle */}
          <button
            onClick={onToggleCompleteness}
            className={`relative p-2 rounded-md transition-colors ${
              showCompletenessPanel
                ? 'bg-white text-black'
                : 'text-white hover:bg-white/10'
            }`}
            title={!tmdbApiKeySet ? "TMDB API key needed for completeness" : "Collection Completeness"}
            aria-label="Toggle completeness panel"
            aria-pressed={showCompletenessPanel}
          >
            <Library className="w-5 h-5" />
            {!tmdbApiKeySet && (
              <span
                className="absolute top-1 right-1 w-2 h-2 rounded-full"
                style={{ backgroundColor: themeAccentColor }}
              />
            )}
          </button>

          {/* Wishlist Panel Toggle */}
          <button
            onClick={onToggleWishlist}
            className={`relative p-2 rounded-md transition-colors ${
              showWishlistPanel
                ? 'bg-white text-black'
                : 'text-white hover:bg-white/10'
            }`}
            title="Wishlist (W)"
            aria-label="Toggle wishlist panel"
            aria-pressed={showWishlistPanel}
          >
            <Star className="w-5 h-5" />
            {wishlistCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-white text-black text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {wishlistCount > 99 ? '99+' : wishlistCount}
              </span>
            )}
          </button>

          {/* AI Chat Toggle */}
          <button
            onClick={onToggleChat}
            className={`p-2 rounded-md transition-colors ${
              showChatPanel
                ? 'bg-white text-black'
                : 'text-white hover:bg-white/10'
            }`}
            title="AI Assistant"
            aria-label="Toggle AI chat"
            aria-pressed={showChatPanel}
          >
            <Bot className="w-5 h-5" />
          </button>

          {/* Activity Panel */}
          <ActivityPanel />

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-md transition-colors text-white hover:bg-white/10"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  )
}
