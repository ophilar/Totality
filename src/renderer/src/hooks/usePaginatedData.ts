
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
  setTotalCount: (count: number) => void
  loading: boolean
  error: string | null
  loadMore: () => void
  refresh: (newFilters?: Partial<TFilters>) => void
  setFilters: (newFilters: Partial<TFilters>) => void
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
  const loadingRef = useRef(false)

  const loadPage = useCallback(async (isReset = false) => {
    // Only allow concurrent loads if it's a reset (e.g. filter change)
    if (loadingRef.current && !isReset) return
    
    loadingRef.current = true
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
      loadingRef.current = false
      setLoading(false)
    }
  }, [fetchFn, countFn, pageSize, activeSourceId])

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

  const setFilters = useCallback((newFilters: Partial<TFilters>) => {
    filtersRef.current = { ...filtersRef.current, ...newFilters }
    loadPage(true)
  }, [loadPage])

  const reset = useCallback(() => {
    setItems([])
    setTotalCount(0)
    offsetRef.current = 0
    hasInitialLoadRef.current = false
    loadPage(true)
  }, [loadPage])

  const externalSetItems = useCallback((newItems: T[] | ((prev: T[]) => T[])) => {
    setItems(prev => {
      const result = typeof newItems === 'function' ? newItems(prev) : newItems
      offsetRef.current = result.length
      hasInitialLoadRef.current = true
      return result
    })
  }, [])

  // Reload when active source changes
  useEffect(() => {
    // BOLT: If items were pre-loaded via bootstrap, don't trigger initial load
    if (hasInitialLoadRef.current) {
      loadPage(true)
    } else if (offsetRef.current === 0) {
      loadPage(true)
    }
  }, [activeSourceId])

  // Subscribe to library update events
  useEffect(() => {
    const unsubscribe = window.electronAPI.onLibraryUpdated?.((event) => {
      // If event has a sourceId, only refresh if it matches our active source
      // If activeSourceId is null (All Sources), we always refresh
      if (!event.sourceId || !activeSourceId || event.sourceId === activeSourceId) {
        loadPage(true)
      }
    })
    return () => unsubscribe?.()
  }, [activeSourceId, loadPage])

  return {
    items,
    totalCount,
    setTotalCount,
    loading,
    error,
    loadMore,
    refresh,
    setFilters,
    reset,
    setItems: externalSetItems
  }
}
