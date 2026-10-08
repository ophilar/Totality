import { useState, useCallback, useRef } from 'react'
import { usePagination } from './usePagination'
import type { MediaItem, TVShowSummary } from '../types'
import { getTVShowIdentity } from '../tv/showIdentity'

export type TVShowSortBy = 'title' | 'play_count' | 'last_watched_at'

interface UseTVShowPaginationOptions {
  activeSourceId: string | null
  activeLibraryId: string | null
  searchQuery: string
}

interface UseTVShowPaginationReturn {
  paginatedShows: TVShowSummary[]
  setPaginatedShows: React.Dispatch<React.SetStateAction<TVShowSummary[]>>
  totalShowCount: number
  totalEpisodeCount: number
  showsLoading: boolean
  tvSortBy: TVShowSortBy
  setTvSortBy: (sort: TVShowSortBy) => void
  selectedShowEpisodes: MediaItem[]
  setSelectedShowEpisodes: React.Dispatch<React.SetStateAction<MediaItem[]>>
  selectedShowEpisodesLoading: boolean
  loadPaginatedShows: (reset?: boolean, startOffset?: number) => Promise<void>
  loadMoreShows: () => void
  loadSelectedShowEpisodes: (showTitleOrSummary: string | TVShowSummary) => Promise<void>
}

/**
 * Hook to manage server-side paginated TV show loading with on-demand episode loading.
 */
export function useTVShowPagination({
  activeSourceId,
  activeLibraryId,
  searchQuery,
}: UseTVShowPaginationOptions): UseTVShowPaginationReturn {
  const [totalEpisodeCount, setTotalEpisodeCount] = useState(0)
  const [tvSortBy, setTvSortByState] = useState<TVShowSortBy>('title')
  const tvSortByRef = useRef<TVShowSortBy>('title')
  const setTvSortBy = useCallback((sort: TVShowSortBy) => {
    tvSortByRef.current = sort
    setTvSortByState(sort)
  }, [])
  const [selectedShowEpisodes, setSelectedShowEpisodes] = useState<MediaItem[]>([])
  const [selectedShowEpisodesLoading, setSelectedShowEpisodesLoading] = useState(false)

  const { items, setItems, totalCount, loading, load, loadMore } = usePagination<TVShowSummary>({
    pageSize: 10000,
    fetchItems: async (filters) => {
      const [shows, , episodeCount] = await Promise.all([
        window.electronAPI.getTVShows(filters),
        // Count is handled by usePagination via fetchCount
        Promise.resolve(0),
        window.electronAPI.countTVEpisodes(filters),
      ])
      setTotalEpisodeCount(episodeCount as number)
      return shows as TVShowSummary[]
    },
    fetchCount: (filters) => window.electronAPI.countTVShows(filters) as Promise<number>,
    buildFilters: () => {
      const sortBy = tvSortByRef.current
      const sortOrder = (sortBy === 'play_count' || sortBy === 'last_watched_at') ? 'desc' : 'asc'
      const filters: Record<string, unknown> = { sortBy, sortOrder }
      if (activeSourceId) filters.sourceId = activeSourceId
      if (activeLibraryId) filters.libraryId = activeLibraryId
      if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()
      return filters
    },
    deps: [activeSourceId, activeLibraryId, searchQuery],
  })

  const loadSelectedShowEpisodes = useCallback(async (showTitleOrSummary: string | TVShowSummary) => {
    setSelectedShowEpisodesLoading(true)
    try {
      let summary: TVShowSummary | undefined
      if (typeof showTitleOrSummary === 'object' && showTitleOrSummary !== null) {
        summary = showTitleOrSummary
      } else {
        summary = items.find((s: TVShowSummary) => s.series_identity_key === showTitleOrSummary || s.series_title === showTitleOrSummary)
      }

      let episodes: unknown[]
      if (summary?.series_identity_key) {
        const { seriesIdentityKey, sourceId, libraryId } = getTVShowIdentity(summary)
        episodes = await window.electronAPI.seriesGetEpisodesByIdentity(
          summary.series_title,
          sourceId,
          seriesIdentityKey,
          libraryId
        )
      } else if (
        typeof showTitleOrSummary === 'string' &&
        (showTitleOrSummary.startsWith('tmdb:') || showTitleOrSummary.startsWith('tvdb:') || showTitleOrSummary.startsWith('unresolved:'))
      ) {
        episodes = await window.electronAPI.seriesGetEpisodesByIdentity(
          '',
          activeSourceId || '',
          showTitleOrSummary,
          activeLibraryId || ''
        )
      } else {
        throw new Error(
          `Cannot load episodes without a canonical series identity key (received: "${typeof showTitleOrSummary === 'object' ? showTitleOrSummary?.series_title : showTitleOrSummary}"). Title-based lookups are not permitted.`
        )
      }
      setSelectedShowEpisodes(episodes as MediaItem[])
    } catch (err) {
      console.error('Error loading episodes for show:', err)
      setSelectedShowEpisodes([])
    } finally {
      setSelectedShowEpisodesLoading(false)
    }
  }, [activeSourceId, items])

  return {
    paginatedShows: items,
    setPaginatedShows: setItems,
    totalShowCount: totalCount,
    totalEpisodeCount,
    showsLoading: loading,
    tvSortBy, setTvSortBy,
    selectedShowEpisodes, setSelectedShowEpisodes, selectedShowEpisodesLoading,
    loadPaginatedShows: load,
    loadMoreShows: loadMore,
    loadSelectedShowEpisodes,
  }
}
