import { useState, useEffect, useMemo, useCallback, useRef, RefObject } from 'react'

interface MovieSearchResult {
  id: number
  title: string
  year?: number | null
  poster_url?: string | null
  needs_upgrade: boolean
  type: 'movie'
}

interface TVSearchResult {
  id: string
  title: string
  poster_url?: string | null
  type: 'tv'
}

interface EpisodeSearchResult {
  id: number
  title: string
  series_title?: string | null
  series_identity_key?: string | null
  source_id?: string
  library_id?: string
  season_number?: number | null
  episode_number?: number | null
  thumb_url?: string | null
  needs_upgrade: boolean
  type: 'episode'
}

interface ArtistSearchResult {
  id: number
  title: string
  thumb_url?: string | null
  type: 'artist'
}

interface AlbumSearchResult {
  id: number
  title: string
  subtitle: string
  year?: number | null
  thumb_url?: string | null
  needs_upgrade: boolean
  type: 'album'
}

interface TrackSearchResult {
  id: number
  title: string
  album_id: number
  album_title?: string
  artist_name?: string
  thumb_url?: string | null
  needs_upgrade: boolean
  type: 'track'
}

interface SearchResultExtra {
  series_identity_key?: string | null
  source_id?: string
  library_id?: string
  album_id?: number
}

export interface GlobalSearchResults {
  movies: MovieSearchResult[]
  tvShows: TVSearchResult[]
  episodes: EpisodeSearchResult[]
  artists: ArtistSearchResult[]
  albums: AlbumSearchResult[]
  tracks: TrackSearchResult[]
}

export interface FlattenedResult {
  type: 'movie' | 'tv' | 'episode' | 'artist' | 'album' | 'track'
  id: number | string
  extra?: SearchResultExtra
}

interface UseGlobalSearchOptions {
  searchInputRef: RefObject<HTMLInputElement | null>
  onNavigateToMovie: (id: number) => void
  onNavigateToTVShow: (identityKey: string) => void
  onNavigateToEpisode: (id: number, seriesIdentityKey?: string | null, sourceId?: string, libraryId?: string) => void
  onNavigateToArtist: (artistId: number) => void
  onNavigateToAlbum: (albumId: number) => void
  onNavigateToTrack: (albumId: number) => void
}

export interface UseGlobalSearchReturn {
  searchInput: string
  setSearchInput: (value: string) => void
  showSearchResults: boolean
  setShowSearchResults: (show: boolean) => void
  searchResultIndex: number
  setSearchResultIndex: (index: number) => void
  searchContainerRef: RefObject<HTMLDivElement | null>
  globalSearchResults: GlobalSearchResults
  hasSearchResults: boolean
  flattenedResults: FlattenedResult[]
  handleSearchKeyDown: (e: React.KeyboardEvent) => void
  handleSearchResultClick: (
    type: 'movie' | 'tv' | 'episode' | 'artist' | 'album' | 'track',
    id: number | string,
    extra?: SearchResultExtra
  ) => void
}

export function useGlobalSearch({
  searchInputRef,
  onNavigateToMovie,
  onNavigateToTVShow,
  onNavigateToEpisode,
  onNavigateToArtist,
  onNavigateToAlbum,
  onNavigateToTrack,
}: UseGlobalSearchOptions): UseGlobalSearchReturn {
  const [searchInput, setSearchInput] = useState('')
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [searchResultIndex, setSearchResultIndex] = useState(-1)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchResults>({
    movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: []
  })

  useEffect(() => {
    if (!searchInput.trim() || searchInput.length < 2) {
      setGlobalSearchResults({ movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] })
      return
    }

    const timer = setTimeout(() => {
      window.electronAPI.searchGlobal(searchInput)
        .then(results => setGlobalSearchResults(results))
        .catch(err => console.error('Global search failed:', err))
    }, 250)

    return () => clearTimeout(timer)
  }, [searchInput])

  const hasSearchResults =
    globalSearchResults.movies.length > 0 ||
    globalSearchResults.tvShows.length > 0 ||
    globalSearchResults.episodes.length > 0 ||
    globalSearchResults.artists.length > 0 ||
    globalSearchResults.albums.length > 0 ||
    globalSearchResults.tracks.length > 0

  const flattenedResults = useMemo(() => {
    const results: FlattenedResult[] = []
    globalSearchResults.movies.forEach((m) => results.push({ type: 'movie', id: m.id }))
    globalSearchResults.tvShows.forEach((s) => results.push({ type: 'tv', id: s.id }))
    globalSearchResults.episodes.forEach((e) =>
      results.push({
        type: 'episode',
        id: e.id,
        extra: {
          series_identity_key: e.series_identity_key,
          source_id: e.source_id,
          library_id: e.library_id,
        },
      })
    )
    globalSearchResults.artists.forEach((a) => results.push({ type: 'artist', id: a.id }))
    globalSearchResults.albums.forEach((a) => results.push({ type: 'album', id: a.id }))
    globalSearchResults.tracks.forEach((t) =>
      results.push({ type: 'track', id: t.id, extra: { album_id: t.album_id } })
    )
    return results
  }, [globalSearchResults])

  const [prevSearchInput, setPrevSearchInput] = useState(searchInput)

  if (searchInput !== prevSearchInput) {
    setPrevSearchInput(searchInput)
    setSearchResultIndex(-1)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearchResultClick = useCallback(
    (
      type: 'movie' | 'tv' | 'episode' | 'artist' | 'album' | 'track',
      id: number | string,
      extra?: SearchResultExtra
    ) => {
      setShowSearchResults(false)
      setSearchInput('')

      if (type === 'movie') {
        onNavigateToMovie(id as number)
      } else if (type === 'tv') {
        onNavigateToTVShow(id as string)
      } else if (type === 'episode') {
        onNavigateToEpisode(id as number, extra?.series_identity_key, extra?.source_id, extra?.library_id)
      } else if (type === 'artist') {
        onNavigateToArtist(id as number)
      } else if (type === 'album') {
        onNavigateToAlbum(id as number)
      } else if (type === 'track') {
        if (extra?.album_id) {
          onNavigateToTrack(extra.album_id)
        }
      }
    },
    [onNavigateToMovie, onNavigateToTVShow, onNavigateToEpisode, onNavigateToArtist, onNavigateToAlbum, onNavigateToTrack]
  )

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSearchResults || !hasSearchResults) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSearchResultIndex((prev) => (prev < flattenedResults.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSearchResultIndex((prev) => (prev > 0 ? prev - 1 : flattenedResults.length - 1))
          break
        case 'Enter':
          e.preventDefault()
          if (searchResultIndex >= 0 && searchResultIndex < flattenedResults.length) {
            const result = flattenedResults[searchResultIndex]
            handleSearchResultClick(result.type, result.id, result.extra)
          }
          break
        case 'Escape':
          e.preventDefault()
          setShowSearchResults(false)
          setSearchResultIndex(-1)
          searchInputRef.current?.blur()
          break
      }
    },
    [showSearchResults, hasSearchResults, flattenedResults, searchResultIndex, handleSearchResultClick, searchInputRef]
  )

  return {
    searchInput,
    setSearchInput,
    showSearchResults,
    setShowSearchResults,
    searchResultIndex,
    setSearchResultIndex,
    searchContainerRef,
    globalSearchResults,
    hasSearchResults,
    flattenedResults,
    handleSearchKeyDown,
    handleSearchResultClick,
  }
}
