
import { useState, useCallback, useRef, useEffect } from 'react'

interface UsePaginatedDataOptions<T, TFilters> {
  fetchFn: (filters: TFilters) => Promise<T[]>
  countFn: (filters: TFilters) => Promise<number>
  pageSize: number
  initialFilters: TFilters
  activeSourceId?: string | null
}

interface UsePaginatedDataReturn<T, TFilters> {
  items: T[]
  totalCount: number
  loading: boolean
  error: string | null
  loadMore: () => void
  refresh: (newFilters?: Partial<TFilters>) => void
  reset: () => void
  setItems: (items: T[] | ((prev: T[]) => T[])) => void
}

/**
 * Generic hook for handling server-side paginated data.
 * Automates loading, appending, and count tracking.
 */
export function usePaginatedData<T, TFilters>({
  fetchFn,
  countFn,
  pageSize,
  initialFilters,
  activeSourceId,
}: UsePaginatedDataOptions<T, TFilters>): UsePaginatedDataReturn<T, TFilters> {
  const [items, setItems] = useState<T[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const filtersRef = useRef<TFilters>(initialFilters)
  const offsetRef = useRef(0)
  const hasInitialLoadRef = useRef(false)

  const loadPage = useCallback(async (isReset = false) => {
    // Only allow concurrent loads if it's a reset (e.g. filter change)
    if (loading && !isReset) return
    
    setLoading(true)
    setError(null)

    if (isReset) {
      offsetRef.current = 0
    }

    try {
      const currentFilters = { 
        ...filtersRef.current, 
        limit: pageSize, 
        offset: offsetRef.current,
        sourceId: activeSourceId || undefined
      }

      // Fetch count on reset or first load
      if (isReset || !hasInitialLoadRef.current) {
        const count = await countFn(currentFilters)
        setTotalCount(count)
      }

      const newItems = await fetchFn(currentFilters)
      
      setItems(prev => isReset ? newItems : [...prev, ...newItems])
      offsetRef.current += newItems.length
      hasInitialLoadRef.current = true
    } catch (err) {
      window.electronAPI.log.error('usePaginatedData', 'Error loading data:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [fetchFn, countFn, pageSize, activeSourceId, loading])

  const loadMore = useCallback(() => {
    if (items.length < totalCount && !loading) {
      loadPage(false)
    }
  }, [items.length, totalCount, loadPage, loading])

  const refresh = useCallback((newFilters?: Partial<TFilters>) => {
    if (newFilters) {
      filtersRef.current = { ...filtersRef.current, ...newFilters }
    }
    loadPage(true)
  }, [loadPage])

  const reset = useCallback(() => {
    setItems([])
    setTotalCount(0)
    offsetRef.current = 0
    hasInitialLoadRef.current = false
    loadPage(true)
  }, [loadPage])

  // Reload when active source changes
  useEffect(() => {
    loadPage(true)
  }, [activeSourceId])

  return {
    items,
    totalCount,
    loading,
    error,
    loadMore,
    refresh,
    reset,
    setItems
  }
}
