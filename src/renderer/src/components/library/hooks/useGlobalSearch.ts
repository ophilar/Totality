import { useState, useEffect, useMemo, useCallback, useRef, RefObject } from 'react'
import type { MediaItem, MusicArtist, MusicAlbum, MusicTrack, TVShow } from '@/components/library/types'

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
  items: MediaItem[]
  /** TV shows keyed by stable renderer identity; show.title is the display/search title. */
  tvShows: Map<string, TVShow>
  musicArtists: MusicArtist[]
  musicAlbums: MusicAlbum[]
  allMusicTracks: MusicTrack[]
  searchInputRef: RefObject<HTMLInputElement | null>
  onNavigateToMovie: (id: number) => void
  onNavigateToTVShow: (identityKey: string) => void
  onNavigateToEpisode: (id: number, seriesIdentityKey?: string | null, sourceId?: string, libraryId?: string) => void
  onNavigateToArtist: (artist: MusicArtist) => void
  onNavigateToAlbum: (album: MusicAlbum) => void
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

/**
 * Hook to manage global search functionality
 *
 * Provides search across all media types (movies, TV, music) with keyboard
 * navigation support and result selection handling.
 *
 * @param options Search configuration and navigation callbacks
 * @returns Search state and handlers
 */
export function useGlobalSearch({
  items,
  tvShows,
  musicArtists,
  musicAlbums,
  allMusicTracks,
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

  // Global search results for live preview (searches all content types)
  const globalSearchResults = useMemo((): GlobalSearchResults => {
    if (!searchInput.trim() || searchInput.length < 2) {
      return { movies: [], tvShows: [], episodes: [], artists: [], albums: [], tracks: [] }
    }

    const query = searchInput.toLowerCase()
    const maxResults = 5 // Max results per category

    // Search movies
    const movieResults: MovieSearchResult[] = items
      .filter((item) => item.type === 'movie' && item.title.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map((item) => ({
        id: item.id!,
        title: item.title,
        year: item.year,
        poster_url: item.poster_url,
        needs_upgrade: item.needs_upgrade || item.tier_quality === 'LOW',
        type: 'movie' as const,
      }))

    // Search TV shows by display title while retaining the identity key as the result ID.
    const tvResults: TVSearchResult[] = Array.from(tvShows.entries())
      .filter(([, show]) => show.title.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map(([identityKey, show]) => ({
        id: identityKey,
        title: show.title,
        poster_url: show.poster_url,
        type: 'tv' as const,
      }))

    // Search episodes
    const episodeResults: EpisodeSearchResult[] = items
      .filter(
        (item) =>
          item.type === 'episode' &&
          (item.title.toLowerCase().includes(query) ||
            (item.series_title && item.series_title.toLowerCase().includes(query)))
      )
      .slice(0, maxResults)
      .map((item) => ({
        id: item.id!,
        title: item.title,
        series_title: item.series_title,
        series_identity_key: item.series_identity_key,
        source_id: item.source_id,
        library_id: item.library_id,
        season_number: item.season_number,
        episode_number: item.episode_number,
        thumb_url: item.episode_thumb_url || item.season_poster_url || item.poster_url,
        needs_upgrade: item.needs_upgrade || item.tier_quality === 'LOW',
        type: 'episode' as const,
      }))

    // Search music artists
    const artistResults: ArtistSearchResult[] = musicArtists
      .filter((artist) => artist.name.toLowerCase().includes(query))
      .slice(0, maxResults)
      .map((artist) => ({
        id: artist.id!,
        title: artist.name,
        thumb_url: artist.thumb_url,
        type: 'artist' as const,
      }))

    // Search music albums
    const albumResults: AlbumSearchResult[] = musicAlbums
      .filter(
        (album) =>
          album.title.toLowerCase().includes(query) ||
          album.artist_name.toLowerCase().includes(query)
      )
      .slice(0, maxResults)
      .map((album) => ({
        id: album.id!,
        title: album.title,
        subtitle: album.artist_name,
        year: album.year,
        thumb_url: album.thumb_url,
        needs_upgrade: false,
        type: 'album' as const,
      }))

    // Search music tracks (include album info) - only include tracks with album_id
    const trackResults: TrackSearchResult[] = allMusicTracks
      .filter((track) => track.title.toLowerCase().includes(query) && track.album_id != null)
      .slice(0, maxResults)
      .map((track) => {
        const album = musicAlbums.find((a) => a.id === track.album_id)
        return {
          id: track.id!,
          title: track.title,
          album_id: track.album_id!,
          album_title: album?.title,
          artist_name: album?.artist_name,
          thumb_url: album?.thumb_url,
          needs_upgrade: !track.is_lossless && !track.is_hi_res,
          type: 'track' as const,
        }
      })

    return {
      movies: movieResults,
      tvShows: tvResults,
      episodes: episodeResults,
      artists: artistResults,
      albums: albumResults,
      tracks: trackResults,
    }
  }, [searchInput, items, tvShows, musicArtists, musicAlbums, allMusicTracks])

  const hasSearchResults =
    globalSearchResults.movies.length > 0 ||
    globalSearchResults.tvShows.length > 0 ||
    globalSearchResults.episodes.length > 0 ||
    globalSearchResults.artists.length > 0 ||
    globalSearchResults.albums.length > 0 ||
    globalSearchResults.tracks.length > 0

  // Flatten search results for keyboard navigation
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

  // Adjust search result index when search input changes (React 19 recommended pattern instead of useEffect)
  if (searchInput !== prevSearchInput) {
    setPrevSearchInput(searchInput)
    setSearchResultIndex(-1)
  }

  // Handle clicking outside search results to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearchResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle search result selection
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
        const artist = musicArtists.find((a) => a.id === id)
        if (artist) onNavigateToArtist(artist)
      } else if (type === 'album') {
        const album = musicAlbums.find((a) => a.id === id)
        if (album) onNavigateToAlbum(album)
      } else if (type === 'track') {
        if (extra?.album_id) {
          onNavigateToTrack(extra.album_id)
        }
      }
    },
    [musicArtists, musicAlbums, onNavigateToMovie, onNavigateToTVShow, onNavigateToEpisode, onNavigateToArtist, onNavigateToAlbum, onNavigateToTrack]
  )

  // Keyboard navigation for search results
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
