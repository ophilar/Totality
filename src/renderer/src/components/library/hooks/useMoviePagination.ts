import { useState, useCallback, useEffect, useRef } from 'react'
import { LIBRARY_PAGE_SIZE, usePagination } from './usePagination'
import type { MediaItem } from '../types'
import { getSortDirection, type MovieSortBy } from '../sortDefinitions'
import type { OptimizationMetricsSummary } from '@main/types/database'

interface UseMoviePaginationOptions {
  activeSourceId: string | null
  activeLibraryId: string | null
  tierFilter: string
  qualityFilter: string
  searchQuery: string
}

interface UseMoviePaginationReturn {
  paginatedMovies: MediaItem[]
  setPaginatedMovies: React.Dispatch<React.SetStateAction<MediaItem[]>>
  totalMovieCount: number
  moviesLoading: boolean
  movieSortBy: MovieSortBy
  setMovieSortBy: (sort: MovieSortBy) => void
  loadPaginatedMovies: (reset?: boolean, startOffset?: number) => Promise<void>
  loadMoreMovies: () => void
  optimizationSummary: OptimizationMetricsSummary | null
  refreshOptimizationSummary: () => Promise<void>
}

/**
 * Hook to manage server-side paginated movie loading with filters.
 */
export function useMoviePagination({
  activeSourceId,
  activeLibraryId,
  tierFilter,
  qualityFilter,
  searchQuery,
}: UseMoviePaginationOptions): UseMoviePaginationReturn {
  const [movieSortBy, setMovieSortByState] = useState<MovieSortBy>('title')
  const movieSortByRef = useRef<MovieSortBy>('title')
  const [optimizationSummary, setOptimizationSummary] = useState<OptimizationMetricsSummary | null>(null)
  const summaryRequestId = useRef(0)

  const setMovieSortBy = useCallback((sort: MovieSortBy) => {
    movieSortByRef.current = sort
    setMovieSortByState(sort)
  }, [])

  const buildFilters = useCallback(() => {
    const sortBy = movieSortByRef.current
    const filters: Record<string, unknown> = {
      type: 'movie',
      sortBy,
      sortOrder: getSortDirection(sortBy),
    }
    if (activeSourceId) filters.sourceId = activeSourceId
    if (activeLibraryId) filters.libraryId = activeLibraryId
    if (tierFilter !== 'all') filters.qualityTier = tierFilter
    if (qualityFilter !== 'all') filters.tierQuality = qualityFilter.toUpperCase()
    if (searchQuery.trim()) filters.searchQuery = searchQuery.trim()
    return filters
  }, [activeSourceId, activeLibraryId, tierFilter, qualityFilter, searchQuery])

  const refreshOptimizationSummary = useCallback(async () => {
    const requestId = ++summaryRequestId.current
    const filters = buildFilters()
    delete filters.sortBy
    delete filters.sortOrder
    try {
      const summary = await window.electronAPI.getOptimizationMetrics(filters) as OptimizationMetricsSummary
      if (requestId === summaryRequestId.current) setOptimizationSummary(summary)
    } catch (error) {
      console.error('Failed to load movie optimization metrics:', error)
    }
  }, [buildFilters])

  useEffect(() => {
    void refreshOptimizationSummary()
  }, [refreshOptimizationSummary])

  const { items, setItems, totalCount, loading, load, loadMore } = usePagination<MediaItem>({
    pageSize: LIBRARY_PAGE_SIZE,
    fetchItems: (filters) => window.electronAPI.getMediaItems(filters) as Promise<MediaItem[]>,
    fetchCount: (filters) => window.electronAPI.countMediaItems(filters) as Promise<number>,
    buildFilters,
    deps: [activeSourceId, activeLibraryId, tierFilter, qualityFilter, searchQuery],
  })

  return {
    paginatedMovies: items,
    setPaginatedMovies: setItems,
    totalMovieCount: totalCount,
    moviesLoading: loading,
    movieSortBy,
    setMovieSortBy,
    loadPaginatedMovies: load,
    loadMoreMovies: loadMore,
    optimizationSummary,
    refreshOptimizationSummary,
  }
}
