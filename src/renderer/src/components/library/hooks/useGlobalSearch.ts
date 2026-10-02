import { useState, useEffect, useMemo, useCallback, useRef, RefObject } from 'react'
import type { GlobalSearchResults } from '@shared/globalSearch'
export type { GlobalSearchResults } from '@shared/globalSearch'

const EMPTY_SEARCH_RESULTS: GlobalSearchResults = { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }

interface SearchResultExtra {
  series_identity_key?: string | null
  source_id?: string | null
  library_id?: string | null
  album_id?: number
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
  const visibleSearchResults = useMemo(() => searchInput.trim().length >= 2 ? globalSearchResults : EMPTY_SEARCH_RESULTS, [searchInput, globalSearchResults])

  useEffect(() => {
    if (!searchInput.trim() || searchInput.length < 2) {
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
    visibleSearchResults.movies.length > 0 ||
    visibleSearchResults.tvShows.length > 0 ||
    visibleSearchResults.episodes.length > 0 ||
    visibleSearchResults.artists.length > 0 ||
    visibleSearchResults.albums.length > 0 ||
    visibleSearchResults.tracks.length > 0

  const flattenedResults = useMemo(() => {
    const results: FlattenedResult[] = []
    visibleSearchResults.movies.forEach((m) => results.push({ type: 'movie', id: m.id }))
    visibleSearchResults.tvShows.forEach((s) => results.push({ type: 'tv', id: s.id }))
    visibleSearchResults.episodes.forEach((e) =>
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
    visibleSearchResults.artists.forEach((a) => results.push({ type: 'artist', id: a.id }))
    visibleSearchResults.albums.forEach((a) => results.push({ type: 'album', id: a.id }))
    visibleSearchResults.tracks.forEach((t) =>
      results.push({ type: 'track', id: t.id, extra: { album_id: t.album_id } })
    )
    return results
  }, [visibleSearchResults])

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
        onNavigateToEpisode(id as number, extra?.series_identity_key, extra?.source_id ?? undefined, extra?.library_id ?? undefined)
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
    globalSearchResults: visibleSearchResults,
    hasSearchResults,
    flattenedResults,
    handleSearchKeyDown,
    handleSearchResultClick,
  }
}
