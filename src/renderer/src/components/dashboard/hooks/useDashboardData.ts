import { useState, useEffect, useCallback } from 'react'
import type { MediaItem, MovieCollection, SeriesCompleteness, ArtistCompleteness, DashboardSummary, MusicAlbum } from '@main/types/database'

export function useDashboardData(activeSourceId: string | null) {
  const [movieUpgrades, setMovieUpgrades] = useState<MediaItem[]>([])
  const [tvUpgrades, setTvUpgrades] = useState<MediaItem[]>([])
  const [musicUpgrades, setMusicUpgrades] = useState<MusicAlbum[]>([])
  const [collections, setCollections] = useState<MovieCollection[]>([])
  const [series, setSeries] = useState<SeriesCompleteness[]>([])
  const [artists, setArtists] = useState<ArtistCompleteness[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Sort/Setting states
  const [upgradeSortBy, setUpgradeSortBy] = useState('quality')
  const [collectionSortBy, setCollectionSortBy] = useState('completeness')
  const [seriesSortBy, setSeriesSortBy] = useState('completeness')
  const [artistSortBy, setArtistSortBy] = useState('completeness')
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const summary = await window.electronAPI.getDashboardSummary(activeSourceId || undefined) as DashboardSummary
      
      setMovieUpgrades(summary.movieUpgrades)
      setTvUpgrades(summary.tvUpgrades)
      setMusicUpgrades(summary.musicUpgrades)
      setCollections(summary.incompleteCollections)
      setSeries(summary.incompleteSeries)
      setArtists(summary.incompleteArtists)
      
      // Update local setting states to reflect DB state
      setUpgradeSortBy(summary.settings.upgradeSort)
      setCollectionSortBy(summary.settings.collectionSort)
      setSeriesSortBy(summary.settings.seriesSort)
      setArtistSortBy(summary.settings.artistSort)
      setIncludeEps(summary.settings.includeEps)
      setIncludeSingles(summary.settings.includeSingles)
    } catch (err) {
      window.electronAPI.log.error('Dashboard', 'Failed to load dashboard summary:', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [activeSourceId])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  useEffect(() => {
    const cleanup = window.electronAPI.onSettingsChanged?.((data) => {
      if (['completeness_include_eps', 'completeness_include_singles', 'dashboard_upgrade_sort', 'dashboard_collection_sort', 'dashboard_series_sort', 'dashboard_artist_sort'].includes(data.key)) {
        loadDashboardData()
      }
    })
    return () => cleanup?.()
  }, [loadDashboardData])

  useEffect(() => {
    const cleanup = window.electronAPI.onScanCompleted?.(() => {
      loadDashboardData()
    })
    return () => cleanup?.()
  }, [loadDashboardData])

  useEffect(() => {
    const cleanup = window.electronAPI.onTaskQueueTaskComplete?.(() => {
      loadDashboardData()
    })
    return () => cleanup?.()
  }, [loadDashboardData])

  useEffect(() => {
    const cleanup = window.electronAPI.onLibraryUpdated?.(() => {
      loadDashboardData()
    })
    return () => cleanup?.()
  }, [loadDashboardData])

  useEffect(() => {
    const handler = () => loadDashboardData()
    window.addEventListener('exclusions-changed', handler)
    return () => window.removeEventListener('exclusions-changed', handler)
  }, [loadDashboardData])

  return {
    movieUpgrades, setMovieUpgrades,
    tvUpgrades, setTvUpgrades,
    musicUpgrades, setMusicUpgrades,
    collections, setCollections,
    series, setSeries,
    artists, setArtists,
    isLoading, error,
    upgradeSortBy, setUpgradeSortBy,
    collectionSortBy, setCollectionSortBy,
    seriesSortBy, setSeriesSortBy,
    artistSortBy, setArtistSortBy,
    loadDashboardData,
    includeEps, includeSingles
  }
}
