import { useState, useEffect, useCallback } from 'react'
import type { MediaItem } from '../types'

type TierFilter = 'all' | 'SD' | '720p' | '1080p' | '4K'
type QualityFilter = 'all' | 'low' | 'medium' | 'high'
type EfficiencyFilter = 'all' | 'high' | 'medium' | 'low'

interface UseLibraryFiltersReturn {
  tierFilter: TierFilter
  setTierFilter: (filter: TierFilter) => void
  qualityFilter: QualityFilter
  setQualityFilter: (filter: QualityFilter) => void
  efficiencyFilter: EfficiencyFilter
  setEfficiencyFilter: (filter: EfficiencyFilter) => void
  alphabetFilter: string | null
  setAlphabetFilter: (filter: string | null) => void
  debouncedTierFilter: TierFilter
  debouncedQualityFilter: QualityFilter
  debouncedEfficiencyFilter: EfficiencyFilter
  filterItem: (item: MediaItem) => boolean
}

/**
 * Hook to manage library filter state with debouncing
 *
 * Provides tier (resolution), quality (within tier), and alphabet filters
 * with debounced versions for performance during rapid changes.
 *
 * @param searchQuery Current search query (used in filter logic)
 * @returns Filter state, setters, and filter function
 */
export function useLibraryFilters(searchQuery: string): UseLibraryFiltersReturn {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [efficiencyFilter, setEfficiencyFilter] = useState<EfficiencyFilter>('all')
  const [alphabetFilter, setAlphabetFilter] = useState<string | null>(null)

  // Debounced filter values (faster than search since they're button clicks)
  const [debouncedTierFilter, setDebouncedTierFilter] = useState<TierFilter>('all')
  const [debouncedQualityFilter, setDebouncedQualityFilter] = useState<QualityFilter>('all')
  const [debouncedEfficiencyFilter, setDebouncedEfficiencyFilter] = useState<EfficiencyFilter>('all')

  // Debounce filter changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTierFilter(tierFilter)
      setDebouncedQualityFilter(qualityFilter)
      setDebouncedEfficiencyFilter(efficiencyFilter)
    }, 150) // 150ms debounce for filters

    return () => clearTimeout(timer)
  }, [tierFilter, qualityFilter, efficiencyFilter])

  // Filter function for media items
  const filterItem = useCallback(
    (item: MediaItem): boolean => {
      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const title = item.title.toLowerCase()
        const seriesTitle = (item.series_title || '').toLowerCase()
        if (!title.includes(query) && !seriesTitle.includes(query)) {
          return false
        }
      }

      // Tier filter (use debounced value)
      if (debouncedTierFilter !== 'all' && item.quality_tier !== debouncedTierFilter) return false

      // Quality filter (use debounced value)
      if (debouncedQualityFilter !== 'all') {
        const tierQuality = (item.tier_quality || 'MEDIUM').toLowerCase()
        if (tierQuality !== debouncedQualityFilter) return false
      }

      // Efficiency filter (use debounced value)
      if (debouncedEfficiencyFilter !== 'all') {
        const score = (item as any).efficiency_score ?? 100
        if (debouncedEfficiencyFilter === 'high' && score < 85) return false
        if (debouncedEfficiencyFilter === 'medium' && (score < 60 || score >= 85)) return false
        if (debouncedEfficiencyFilter === 'low' && score >= 60) return false
      }

      return true
    },
    [searchQuery, debouncedTierFilter, debouncedQualityFilter, debouncedEfficiencyFilter]
  )

  return {
    tierFilter,
    setTierFilter,
    qualityFilter,
    setQualityFilter,
    efficiencyFilter,
    setEfficiencyFilter,
    alphabetFilter,
    setAlphabetFilter,
    debouncedTierFilter,
    debouncedQualityFilter,
    debouncedEfficiencyFilter,
    filterItem,
  }
}
